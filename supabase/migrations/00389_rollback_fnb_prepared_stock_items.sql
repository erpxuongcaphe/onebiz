-- Rollback 00389. Refuse to erase the role while prepared-stock rows exist.
do $$
begin
  if exists (select 1 from public.products where is_fnb_stock_item) then
    raise exception 'Cannot rollback 00389 while F&B prepared stock items exist';
  end if;
end
$$;

drop index if exists public.idx_products_inventory_role;

alter table public.products
  drop column if exists inventory_role;

alter table public.products
  add column inventory_role text
  generated always as (
    case
      when product_type = 'nvl' then 'raw_material'
      when product_type = 'sku' and channel = 'fnb' then 'fnb_menu_item'
      when product_type = 'sku' then 'retail_stock_item'
      else 'raw_material'
    end
  ) stored;

create index idx_products_inventory_role
  on public.products (tenant_id, inventory_role);

alter table public.products
  drop constraint if exists products_fnb_stock_item_shape_check;

alter table public.products
  drop column if exists is_fnb_stock_item;

notify pgrst, 'reload schema';
