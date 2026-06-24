-- ============================================================
-- 00150 — Fix lỗi "Hoàn thành lệnh sản xuất": created_by NULL
-- ============================================================
-- CEO 24/06/2026: bấm "Hoàn thành" lệnh SX báo lỗi (toast giấu message).
-- Lỗi thật: null value in column "created_by" of relation "stock_movements"
-- violates not-null constraint.
--
-- GỐC RỄ: service createProductionOrder KHÔNG set created_by → mọi
-- production_orders có created_by=NULL. Khi consume_production_materials
-- (00047) + complete_production_order (00069) ghi stock_movements với
-- created_by = v_order.created_by (NULL) → vi phạm NOT NULL → "Hoàn thành" vỡ.
--
-- FIX:
--   1. Backfill production_orders.created_by NULL → chủ tenant (role owner).
--   2. Gia cố 2 RPC: dùng v_actor = coalesce(order.created_by, owner) cho
--      stock_movements → không bao giờ vỡ vì null nữa (kể cả lệnh nhập sai).
-- (Service đã được vá song song để set created_by cho lệnh mới.)
--
-- KHÔNG đổi logic trừ NVL / cộng tồn / WAC — chỉ thay nguồn created_by.
-- ============================================================

-- ────────────────────────────────────────────────────────────────
-- 1. Backfill created_by cho lệnh SX cũ (NULL → owner của tenant)
-- ────────────────────────────────────────────────────────────────
update public.production_orders po
set created_by = (
  select pr.id from public.profiles pr
  where pr.tenant_id = po.tenant_id and pr.role = 'owner'
  order by pr.created_at
  limit 1
)
where po.created_by is null
  and exists (
    select 1 from public.profiles pr2
    where pr2.tenant_id = po.tenant_id and pr2.role = 'owner'
  );

-- ────────────────────────────────────────────────────────────────
-- 2. consume_production_materials — v_actor fallback (giữ nguyên 00047 + guard)
-- ────────────────────────────────────────────────────────────────
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
  v_actor uuid;
begin
  select * into v_order from public.production_orders where id = p_production_order_id;
  if not found then
    raise exception 'Production order not found';
  end if;

  if v_order.status not in ('pending', 'planned', 'material_check', 'in_production', 'quality_check') then
    raise exception 'Cannot consume materials: order status is "%", expected planned/material_check/in_production/quality_check', v_order.status;
  end if;

  -- 00150: người ghi sổ — ưu tiên người tạo lệnh, fallback chủ tenant (chống NULL)
  v_actor := coalesce(
    v_order.created_by,
    (select id from public.profiles
      where tenant_id = v_order.tenant_id and role = 'owner'
      order by created_at limit 1)
  );
  if v_actor is null then
    raise exception 'Không xác định được người thực hiện (created_by null & không có owner)';
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
      'SX: ' || v_order.code, v_actor
    );
  end loop;

  update public.production_orders
  set cogs_amount = v_total_cogs,
      updated_at = now()
  where id = p_production_order_id;
end;
$$;

-- ────────────────────────────────────────────────────────────────
-- 3. complete_production_order — v_actor fallback (giữ nguyên 00069 + WAC)
-- ────────────────────────────────────────────────────────────────
create or replace function public.complete_production_order(
  p_production_order_id uuid,
  p_completed_qty numeric,
  p_lot_number text default null,
  p_manufactured_date date default current_date,
  p_expiry_date date default null
) returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_order record;
  v_lot_id uuid;
  v_lot_number text;
  v_unit_cogs numeric(15, 4);
  v_wac_result jsonb;
  v_actor uuid;
begin
  select * into v_order from public.production_orders
  where id = p_production_order_id;
  if not found then
    raise exception 'Production order not found';
  end if;

  -- 00150: người ghi sổ — fallback chủ tenant (chống NULL stock_movements.created_by)
  v_actor := coalesce(
    v_order.created_by,
    (select id from public.profiles
      where tenant_id = v_order.tenant_id and role = 'owner'
      order by created_at limit 1)
  );
  if v_actor is null then
    raise exception 'Không xác định được người thực hiện (created_by null & không có owner)';
  end if;

  -- Generate lot number nếu không có
  v_lot_number := coalesce(
    p_lot_number,
    'LOT-' || to_char(now(), 'YYYYMMDD') || '-' || substr(uuid_generate_v4()::text, 1, 4)
  );

  -- Auto-calculate expiry nếu SP có shelf_life_days
  if p_expiry_date is null then
    select
      case
        when shelf_life_unit = 'day' then p_manufactured_date + shelf_life_days
        when shelf_life_unit = 'month' then p_manufactured_date + (shelf_life_days || ' months')::interval
        when shelf_life_unit = 'year' then p_manufactured_date + (shelf_life_days || ' years')::interval
        else null
      end
    into p_expiry_date
    from public.products
    where id = v_order.product_id and shelf_life_days is not null;
  end if;

  -- Tạo lot
  insert into public.product_lots (
    tenant_id, product_id, variant_id, lot_number,
    source_type, production_order_id,
    manufactured_date, expiry_date, received_date,
    initial_qty, current_qty, branch_id, status
  ) values (
    v_order.tenant_id, v_order.product_id, v_order.variant_id, v_lot_number,
    'production', p_production_order_id,
    p_manufactured_date, p_expiry_date, current_date,
    p_completed_qty, p_completed_qty, v_order.branch_id, 'active'
  ) returning id into v_lot_id;

  -- GAP #2 FIX (00069): Apply WAC cho SKU thành phẩm TRƯỚC khi increment stock
  if v_order.cogs_amount is not null
     and v_order.cogs_amount > 0
     and p_completed_qty > 0 then
    v_unit_cogs := round(v_order.cogs_amount / p_completed_qty, 4);

    v_wac_result := public.apply_weighted_avg_cost(
      v_order.product_id,
      p_completed_qty,
      v_unit_cogs,
      'production_complete',
      'production_order',
      p_production_order_id
    );
  end if;

  -- Nhập kho thành phẩm
  update public.products
  set stock = stock + p_completed_qty
  where id = v_order.product_id;

  insert into public.branch_stock (tenant_id, branch_id, product_id, variant_id, quantity)
  values (v_order.tenant_id, v_order.branch_id, v_order.product_id, v_order.variant_id, p_completed_qty)
  on conflict (branch_id, product_id, variant_id)
  do update set quantity = branch_stock.quantity + p_completed_qty, updated_at = now();

  -- Log stock movement IN (00150: created_by = v_actor)
  insert into public.stock_movements (
    tenant_id, branch_id, product_id, type, quantity,
    reference_type, reference_id, note, created_by
  ) values (
    v_order.tenant_id, v_order.branch_id, v_order.product_id, 'in', p_completed_qty,
    'production_order', p_production_order_id,
    'SX hoàn thành: ' || v_order.code || ' | Lot: ' || v_lot_number,
    v_actor
  );

  -- Update production order
  update public.production_orders
  set completed_qty = p_completed_qty,
      lot_number = v_lot_number,
      status = 'completed',
      actual_end = now(),
      updated_at = now()
  where id = p_production_order_id;

  return v_lot_id;
end;
$$;

grant execute on function public.consume_production_materials(uuid) to authenticated;
grant execute on function public.complete_production_order(uuid, numeric, text, date, date) to authenticated;

notify pgrst, 'reload schema';
