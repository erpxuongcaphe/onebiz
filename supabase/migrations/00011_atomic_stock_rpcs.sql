-- ============================================================
-- OneBiz ERP — Atomic Stock RPCs
--
-- Fixes race condition in stock updates: replaces read-compute-write
-- pattern with SQL-level atomic increments.
--
-- Two helper RPCs used by applyManualStockMovement, applyStockDecrement,
-- and any future mutation that needs to adjust stock.
-- ============================================================

-- 1. increment_product_stock: atomic `stock = stock + delta`
create or replace function public.increment_product_stock(
  p_product_id uuid,
  p_delta numeric
) returns void
language plpgsql
security definer
as $$
begin
  update public.products
  set stock = coalesce(stock, 0) + p_delta
  where id = p_product_id;

  if not found then
    raise exception 'Product % not found', p_product_id;
  end if;
end;
$$;

-- 2. upsert_branch_stock: atomic upsert with NULL variant_id handling
--    Uses partial unique index workaround for NULL variant_id:
--    tries UPDATE first, falls back to INSERT if no row exists.
create or replace function public.upsert_branch_stock(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_product_id uuid,
  p_delta numeric
) returns void
language plpgsql
security definer
as $$
declare
  v_rows int;
begin
  -- Try atomic UPDATE first (handles NULL variant_id correctly)
  update public.branch_stock
  set quantity = coalesce(quantity, 0) + p_delta,
      updated_at = now()
  where branch_id = p_branch_id
    and product_id = p_product_id
    and variant_id is null;

  get diagnostics v_rows = row_count;

  -- If no row matched, INSERT a new one
  if v_rows = 0 then
    insert into public.branch_stock (tenant_id, branch_id, product_id, variant_id, quantity, reserved)
    values (p_tenant_id, p_branch_id, p_product_id, null, p_delta, 0)
    on conflict do nothing;  -- safety net for concurrent inserts

    -- If the ON CONFLICT swallowed our insert (another concurrent call inserted
    -- between our UPDATE and INSERT), retry the UPDATE
    if not found then
      update public.branch_stock
      set quantity = coalesce(quantity, 0) + p_delta,
          updated_at = now()
      where branch_id = p_branch_id
        and product_id = p_product_id
        and variant_id is null;
    end if;
  end if;
end;
$$;

-- 3. Fix consume_production_materials: add status guard
create or replace function public.consume_production_materials(
  p_production_order_id uuid
) returns void
language plpgsql
security definer
as $$
declare
  v_order record;
  r record;
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
      pom.product_id,
      coalesce(pom.actual_qty, pom.planned_qty) as qty,
      pom.unit
    from public.production_order_materials pom
    where pom.production_order_id = p_production_order_id
  loop
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
end;
$$;

-- 4. Fix complete_production_order: add status guard + NULL variant_id fix
create or replace function public.complete_production_order(
  p_production_order_id uuid,
  p_completed_qty numeric,
  p_lot_number text default null,
  p_manufactured_date date default current_date,
  p_expiry_date date default null
) returns uuid
language plpgsql
security definer
as $$
declare
  v_order record;
  v_lot_id uuid;
  v_lot_number text;
  v_rows int;
begin
  select * into v_order from public.production_orders where id = p_production_order_id;
  if not found then
    raise exception 'Production order not found';
  end if;

  -- STATUS GUARD: only allow completion from quality_check or in_production
  if v_order.status not in ('quality_check', 'in_production') then
    raise exception 'Cannot complete: order status is "%", expected quality_check/in_production', v_order.status;
  end if;

  v_lot_number := coalesce(p_lot_number, 'LOT-' || to_char(now(), 'YYYYMMDD') || '-' || substr(uuid_generate_v4()::text, 1, 4));

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

  -- Create lot
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

  -- Atomic stock increment
  update public.products
  set stock = stock + p_completed_qty
  where id = v_order.product_id;

  -- branch_stock upsert: handle NULL variant_id correctly
  update public.branch_stock
  set quantity = quantity + p_completed_qty, updated_at = now()
  where branch_id = v_order.branch_id
    and product_id = v_order.product_id
    and variant_id is not distinct from v_order.variant_id;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    insert into public.branch_stock (tenant_id, branch_id, product_id, variant_id, quantity)
    values (v_order.tenant_id, v_order.branch_id, v_order.product_id, v_order.variant_id, p_completed_qty);
  end if;

  -- Log stock movement IN
  insert into public.stock_movements (
    tenant_id, branch_id, product_id, type, quantity,
    reference_type, reference_id, note, created_by
  ) values (
    v_order.tenant_id, v_order.branch_id, v_order.product_id, 'in', p_completed_qty,
    'production_order', p_production_order_id,
    'SX hoan thanh: ' || v_order.code || ' | Lot: ' || v_lot_number, v_order.created_by
  );

  -- Update production order — ATOMIC status flip
  update public.production_orders
  set completed_qty = p_completed_qty,
      lot_number = v_lot_number,
      status = 'completed',
      actual_end = now(),
      updated_at = now()
  where id = p_production_order_id
    and status in ('quality_check', 'in_production');

  return v_lot_id;
end;
$$;
