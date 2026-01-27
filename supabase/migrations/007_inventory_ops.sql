-- OneBiz ERP - Inventory ops (RPC functions + RLS write policies)

-- ============================================================
-- RLS: allow tenant members to write inventory data (MVP)
-- Later tighten using RBAC claims.
-- ============================================================

-- Categories
drop policy if exists "inventory_categories: insert within tenant" on public.inventory_categories;
create policy "inventory_categories: insert within tenant"
on public.inventory_categories
for insert
with check (tenant_id = public.current_tenant_id());

drop policy if exists "inventory_categories: update within tenant" on public.inventory_categories;
create policy "inventory_categories: update within tenant"
on public.inventory_categories
for update
using (tenant_id = public.current_tenant_id())
with check (tenant_id = public.current_tenant_id());

drop policy if exists "inventory_categories: delete within tenant" on public.inventory_categories;
create policy "inventory_categories: delete within tenant"
on public.inventory_categories
for delete
using (tenant_id = public.current_tenant_id());

-- Products
drop policy if exists "inventory_products: insert within tenant" on public.inventory_products;
create policy "inventory_products: insert within tenant"
on public.inventory_products
for insert
with check (tenant_id = public.current_tenant_id());

drop policy if exists "inventory_products: update within tenant" on public.inventory_products;
create policy "inventory_products: update within tenant"
on public.inventory_products
for update
using (tenant_id = public.current_tenant_id())
with check (tenant_id = public.current_tenant_id());

drop policy if exists "inventory_products: delete within tenant" on public.inventory_products;
create policy "inventory_products: delete within tenant"
on public.inventory_products
for delete
using (tenant_id = public.current_tenant_id());

-- Warehouses
drop policy if exists "inventory_warehouses: insert within tenant" on public.inventory_warehouses;
create policy "inventory_warehouses: insert within tenant"
on public.inventory_warehouses
for insert
with check (tenant_id = public.current_tenant_id());

drop policy if exists "inventory_warehouses: update within tenant" on public.inventory_warehouses;
create policy "inventory_warehouses: update within tenant"
on public.inventory_warehouses
for update
using (tenant_id = public.current_tenant_id())
with check (tenant_id = public.current_tenant_id());

drop policy if exists "inventory_warehouses: delete within tenant" on public.inventory_warehouses;
create policy "inventory_warehouses: delete within tenant"
on public.inventory_warehouses
for delete
using (tenant_id = public.current_tenant_id());

-- Stock
drop policy if exists "inventory_stock: upsert within tenant" on public.inventory_stock;
create policy "inventory_stock: upsert within tenant"
on public.inventory_stock
for insert
with check (tenant_id = public.current_tenant_id());

drop policy if exists "inventory_stock: update within tenant" on public.inventory_stock;
create policy "inventory_stock: update within tenant"
on public.inventory_stock
for update
using (tenant_id = public.current_tenant_id())
with check (tenant_id = public.current_tenant_id());

-- Stock movements
drop policy if exists "inventory_stock_movements: insert within tenant" on public.inventory_stock_movements;
create policy "inventory_stock_movements: insert within tenant"
on public.inventory_stock_movements
for insert
with check (tenant_id = public.current_tenant_id());


-- ============================================================
-- RPC: ensure a default warehouse exists
-- ============================================================
create or replace function public.inventory_ensure_default_warehouse()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  t_id uuid;
  w_id uuid;
begin
  t_id := public.current_tenant_id();
  if t_id is null then
    raise exception 'No tenant for current user';
  end if;

  select id into w_id
  from public.inventory_warehouses
  where tenant_id = t_id
  order by created_at asc
  limit 1;

  if w_id is not null then
    return w_id;
  end if;

  insert into public.inventory_warehouses (tenant_id, name, code, address)
  values (t_id, 'Kho mac dinh', 'KHO-DEFAULT', null)
  returning id into w_id;

  return w_id;
end;
$$;


-- ============================================================
-- RPC: apply stock movement (single transaction)
-- quantity: positive for inbound, negative for outbound
-- ============================================================
create or replace function public.inventory_apply_stock_movement(
  p_product_id uuid,
  p_warehouse_id uuid,
  p_movement_type text,
  p_quantity numeric,
  p_reference_type text default null,
  p_reference_id uuid default null,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t_id uuid;
begin
  t_id := public.current_tenant_id();
  if t_id is null then
    raise exception 'No tenant for current user';
  end if;

  -- Basic validation
  if p_quantity = 0 then
    raise exception 'Quantity must not be zero';
  end if;

  -- Ensure references belong to tenant
  if not exists (
    select 1 from public.inventory_products where id = p_product_id and tenant_id = t_id
  ) then
    raise exception 'Product not found in tenant';
  end if;

  if not exists (
    select 1 from public.inventory_warehouses where id = p_warehouse_id and tenant_id = t_id
  ) then
    raise exception 'Warehouse not found in tenant';
  end if;

  -- Upsert stock row
  insert into public.inventory_stock (tenant_id, product_id, warehouse_id, quantity)
  values (t_id, p_product_id, p_warehouse_id, p_quantity)
  on conflict (tenant_id, product_id, warehouse_id)
  do update set quantity = public.inventory_stock.quantity + excluded.quantity,
                updated_at = now();

  -- Insert movement
  insert into public.inventory_stock_movements (
    tenant_id,
    product_id,
    warehouse_id,
    movement_type,
    quantity,
    reference_type,
    reference_id,
    notes,
    created_by
  )
  values (
    t_id,
    p_product_id,
    p_warehouse_id,
    p_movement_type,
    p_quantity,
    p_reference_type,
    p_reference_id,
    p_notes,
    auth.uid()
  );
end;
$$;
