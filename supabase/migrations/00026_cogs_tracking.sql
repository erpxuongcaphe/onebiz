-- ============================================================
-- 00026 — COGS Tracking cho Production Orders
-- ============================================================
-- Sprint KHO-2 (Data Integrity). Mục tiêu:
--   1. Thêm `unit_cost` vào `production_order_materials` để snapshot
--      giá vốn NVL tại thời điểm tiêu hao (không đổi khi giá NVL thay đổi
--      về sau — đúng chuẩn kế toán).
--   2. Thêm `cogs_amount` vào `production_orders` — tổng giá vốn SX,
--      dùng cho báo cáo P&L / dashboard.
--   3. Patch `consume_production_materials` để:
--      - Snapshot `products.cost_price` → `pom.unit_cost` nếu còn NULL.
--      - Aggregate `sum(unit_cost × qty)` → `production_orders.cogs_amount`.
-- ============================================================

-- 1. Add columns (idempotent)
alter table public.production_order_materials
  add column if not exists unit_cost numeric(15,4);

alter table public.production_orders
  add column if not exists cogs_amount numeric(15,2) not null default 0;

comment on column public.production_order_materials.unit_cost is
  'Giá vốn/đơn vị NVL tại thời điểm tiêu hao (snapshot từ products.cost_price). NULL nếu chưa tiêu hao.';

comment on column public.production_orders.cogs_amount is
  'Tổng giá vốn NVL của lệnh SX (sum unit_cost × actual_qty). Cập nhật khi consume_production_materials chạy.';

-- 2. Rewrite consume_production_materials — snapshot cost + aggregate COGS
create or replace function public.consume_production_materials(
  p_production_order_id uuid
) returns void
language plpgsql
security definer
as $$
declare
  v_order record;
  r record;
  v_unit_cost numeric(15,4);
  v_total_cogs numeric(15,2) := 0;
begin
  select * into v_order from public.production_orders where id = p_production_order_id;
  if not found then
    raise exception 'Production order not found';
  end if;

  -- STATUS GUARD: only allow consumption in valid states
  if v_order.status not in ('pending', 'material_check', 'in_production') then
    raise exception 'Cannot consume materials: order status is "%", expected pending/material_check/in_production', v_order.status;
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
    -- Snapshot unit_cost từ products.cost_price NẾU chưa set
    if r.existing_unit_cost is null then
      select cost_price into v_unit_cost
      from public.products
      where id = r.product_id;
      v_unit_cost := coalesce(v_unit_cost, 0);

      update public.production_order_materials
      set unit_cost = v_unit_cost
      where id = r.pom_id;
    else
      v_unit_cost := r.existing_unit_cost;
    end if;

    -- Cộng dồn vào total COGS
    v_total_cogs := v_total_cogs + (v_unit_cost * r.qty);

    -- Atomic stock decrement (như cũ)
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

  -- Cập nhật cogs_amount cho đơn SX
  update public.production_orders
  set cogs_amount = v_total_cogs,
      updated_at = now()
  where id = p_production_order_id;
end;
$$;
