-- ============================================================
-- 00047 — Production: stock-check guard + revert materials RPC
-- ============================================================
--
-- Sprint SX-1 — fix 2 P0 audit phát hiện cho module sản xuất:
--
-- P0#1: Hủy lệnh KHÔNG rollback NVL.
--   Nếu user cancel sau khi đã consume (status >= material_check), tồn
--   kho NVL đã trừ nhưng không tự đảo lại → mất NVL. Lệnh cancel hiện
--   chỉ flip `production_orders.status = 'cancelled'`.
--
-- P0#5: consume_production_materials KHÔNG check stock đủ.
--   Dialog "Tiếp tục hoàn thành" cho user override khi shortage. RPC
--   blindly trừ → branch_stock có thể âm khi user override.
--
-- Fix:
--   1. Override consume_production_materials với stock guard:
--      raise exception nếu branch_stock < qty consume.
--   2. Tạo RPC mới `revert_production_materials(order_id)`:
--      - Verify order in cancellable status (planned/material_check/
--        in_production — KHÔNG cho hoàn lại completed vì lot đã tạo).
--      - Đảo stock_movements: tạo type='in' với cùng reference cho mỗi
--        material đã consume.
--      - Restore products.stock + branch_stock.
--      - Reset production_order_materials.actual_qty = NULL,
--        production_orders.cogs_amount = 0.
--      - Set status = 'cancelled' atomic.
-- ============================================================

-- ============================================================
-- 1. consume_production_materials: thêm stock guard
-- ============================================================
create or replace function public.consume_production_materials(
  p_production_order_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  r record;
  v_unit_cost numeric(15,4);
  v_total_cogs numeric(15,2) := 0;
  v_current_stock numeric(15,2);
begin
  select * into v_order from public.production_orders where id = p_production_order_id;
  if not found then
    raise exception 'Production order not found';
  end if;

  if v_order.status not in ('pending', 'planned', 'material_check', 'in_production', 'quality_check') then
    raise exception 'Cannot consume materials: order status is "%", expected planned/material_check/in_production/quality_check', v_order.status;
  end if;

  for r in
    select
      pom.id as pom_id,
      pom.product_id,
      coalesce(pom.actual_qty, pom.planned_qty) as qty,
      pom.unit,
      pom.unit_cost as existing_unit_cost
    from public.production_order_materials pom
    where pom.production_order_id = p_production_order_id
  loop
    -- STOCK GUARD (Sprint SX-1): chặn consume khi branch_stock không đủ.
    -- Trước đây dialog UI "Tiếp tục hoàn thành" override warning shortage
    -- → RPC blindly trừ → âm kho. Giờ DB enforce hard.
    select coalesce(quantity, 0) into v_current_stock
      from public.branch_stock
     where product_id = r.product_id
       and branch_id = v_order.branch_id
       and variant_id is null;

    if v_current_stock is null or v_current_stock < r.qty then
      raise exception
        'Không đủ tồn kho NVL để sản xuất: cần %, hiện có %. SP: %',
        r.qty, coalesce(v_current_stock, 0), r.product_id;
    end if;

    -- Snapshot unit_cost từ products.cost_price NẾU chưa set
    if r.existing_unit_cost is null then
      select cost_price into v_unit_cost
      from public.products
      where id = r.product_id;
      v_unit_cost := coalesce(v_unit_cost, 0);

      update public.production_order_materials
      set unit_cost = v_unit_cost,
          actual_qty = r.qty
      where id = r.pom_id;
    else
      v_unit_cost := r.existing_unit_cost;
      update public.production_order_materials
      set actual_qty = r.qty
      where id = r.pom_id;
    end if;

    v_total_cogs := v_total_cogs + (v_unit_cost * r.qty);

    -- Atomic stock decrement
    update public.products
    set stock = stock - r.qty
    where id = r.product_id;

    update public.branch_stock
    set quantity = quantity - r.qty, updated_at = now()
    where product_id = r.product_id and branch_id = v_order.branch_id
      and variant_id is null;

    insert into public.stock_movements (
      tenant_id, branch_id, product_id, type, quantity,
      reference_type, reference_id, note, created_by
    ) values (
      v_order.tenant_id, v_order.branch_id, r.product_id, 'out', r.qty,
      'production_order', p_production_order_id,
      'SX: ' || v_order.code, v_order.created_by
    );
  end loop;

  update public.production_orders
  set cogs_amount = v_total_cogs,
      updated_at = now()
  where id = p_production_order_id;
end;
$$;

-- ============================================================
-- 2. revert_production_materials: đảo NVL + cancel atomic
-- ============================================================
create or replace function public.revert_production_materials(
  p_production_order_id uuid,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  r record;
  v_reverted_qty numeric(15,2) := 0;
  v_reverted_cogs numeric(15,2) := 0;
begin
  select * into v_order from public.production_orders
   where id = p_production_order_id
   for update;

  if not found then
    raise exception 'Production order not found';
  end if;

  -- Cho phép revert ở các status đã consume nhưng CHƯA tạo lot:
  -- planned/material_check/in_production/quality_check.
  -- KHÔNG cho revert completed vì lot đã tạo + thành phẩm đã vào kho —
  -- cần luồng riêng (xuất hủy lot + đảo kho thành phẩm).
  if v_order.status not in ('planned', 'material_check', 'in_production', 'quality_check') then
    raise exception 'Không thể hoàn NVL ở trạng thái "%"', v_order.status;
  end if;

  for r in
    select
      pom.id as pom_id,
      pom.product_id,
      pom.actual_qty,
      pom.unit_cost
    from public.production_order_materials pom
    where pom.production_order_id = p_production_order_id
      and pom.actual_qty is not null
      and pom.actual_qty > 0
  loop
    -- Đảo branch_stock + products.stock
    update public.products
    set stock = stock + r.actual_qty
    where id = r.product_id;

    update public.branch_stock
    set quantity = quantity + r.actual_qty, updated_at = now()
    where product_id = r.product_id
      and branch_id = v_order.branch_id
      and variant_id is null;

    -- Insert stock_movement đảo (type='in', cùng reference để link)
    insert into public.stock_movements (
      tenant_id, branch_id, product_id, type, quantity,
      reference_type, reference_id, note, created_by
    ) values (
      v_order.tenant_id, v_order.branch_id, r.product_id, 'in', r.actual_qty,
      'production_order', p_production_order_id,
      'HUỶ SX: ' || v_order.code || coalesce(' — ' || p_reason, ''),
      v_order.created_by
    );

    v_reverted_qty := v_reverted_qty + r.actual_qty;
    v_reverted_cogs := v_reverted_cogs + (coalesce(r.unit_cost, 0) * r.actual_qty);

    -- Reset actual_qty (chừa unit_cost để audit nếu cần)
    update public.production_order_materials
    set actual_qty = null
    where id = r.pom_id;
  end loop;

  -- Set status = cancelled + reset cogs
  update public.production_orders
  set status = 'cancelled',
      cogs_amount = 0,
      note = case
        when p_reason is null or p_reason = '' then note
        else coalesce(note, '') || E'\n[HUỶ] ' || p_reason
      end,
      updated_at = now()
  where id = p_production_order_id;

  return jsonb_build_object(
    'order_id', p_production_order_id,
    'reverted_materials_qty', v_reverted_qty,
    'reverted_cogs', v_reverted_cogs
  );
end;
$$;

grant execute on function public.revert_production_materials(uuid, text)
  to authenticated, service_role;
