-- OneBiz ERP - Inventory hard delete helpers

-- Safely delete a product within current tenant.
-- Prevent deletion if referenced by sales order items.

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

grant execute on function public.inventory_delete_product(uuid) to authenticated;
