-- OneBiz ERP - RBAC guards for security definer RPCs

-- Guard: ensure a default warehouse exists
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
  if not public.has_permission('inventory.warehouse.create') and not public.has_permission('inventory.stock.adjust') then
    raise exception 'Permission denied';
  end if;

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

-- Guard: apply stock movement
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
  if not public.has_permission('inventory.stock.adjust') then
    raise exception 'Permission denied';
  end if;

  t_id := public.current_tenant_id();
  if t_id is null then
    raise exception 'No tenant for current user';
  end if;

  if p_quantity = 0 then
    raise exception 'Quantity must not be zero';
  end if;

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

  insert into public.inventory_stock (tenant_id, product_id, warehouse_id, quantity)
  values (t_id, p_product_id, p_warehouse_id, p_quantity)
  on conflict (tenant_id, product_id, warehouse_id)
  do update set quantity = public.inventory_stock.quantity + excluded.quantity,
                updated_at = now();

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

-- Guard: hard delete product
create or replace function public.inventory_delete_product(p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t_id uuid;
  has_sales_ref boolean;
begin
  if not public.has_permission('inventory.product.delete.hard') then
    raise exception 'Permission denied';
  end if;

  t_id := public.current_tenant_id();
  if t_id is null then
    raise exception 'No tenant for current user';
  end if;

  if not exists (
    select 1 from public.inventory_products where id = p_product_id and tenant_id = t_id
  ) then
    raise exception 'Product not found in tenant';
  end if;

  select exists(
    select 1
    from public.sales_order_items soi
    join public.sales_orders so on so.id = soi.order_id
    where soi.product_id = p_product_id
      and so.tenant_id = t_id
  ) into has_sales_ref;

  if has_sales_ref then
    raise exception 'Product is referenced by sales orders';
  end if;

  delete from public.inventory_products
  where id = p_product_id
    and tenant_id = t_id;
end;
$$;
