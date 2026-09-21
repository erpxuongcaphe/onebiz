-- 00389 - Stockable semi-finished items prepared inside an F&B branch.
--
-- Existing rows keep exactly the same role. The opt-in flag is false by
-- default, so Retail and current F&B menu data are not reclassified.

alter table public.products
  add column if not exists is_fnb_stock_item boolean not null default false;

alter table public.products
  drop constraint if exists products_fnb_stock_item_shape_check;

alter table public.products
  add constraint products_fnb_stock_item_shape_check
  check (
    not is_fnb_stock_item
    or (
      product_type = 'sku'
      and channel = 'retail'
      and allow_sale = false
    )
  );

-- inventory_role was introduced as a generated column in 00164. PostgreSQL
-- does not support replacing a generated expression in place, so recreate it.
drop index if exists public.idx_products_inventory_role;

alter table public.products
  drop column if exists inventory_role;

alter table public.products
  add column inventory_role text
  generated always as (
    case
      when is_fnb_stock_item then 'fnb_stock_item'
      when product_type = 'nvl' then 'raw_material'
      when product_type = 'sku' and channel = 'fnb' then 'fnb_menu_item'
      when product_type = 'sku' then 'retail_stock_item'
      else 'raw_material'
    end
  ) stored;

create index idx_products_inventory_role
  on public.products (tenant_id, inventory_role);

comment on column public.products.is_fnb_stock_item is
  'Opt-in for a stockable semi-finished item prepared at an F&B branch. Stored as a hidden SKU, produced into branch stock, and consumable by F&B menu BOMs.';

comment on column public.products.inventory_role is
  'Explicit stock role: raw_material | retail_stock_item | fnb_menu_item | fnb_stock_item. Existing products are unchanged; fnb_stock_item requires is_fnb_stock_item=true.';

notify pgrst, 'reload schema';

do $$
begin
  if exists (
    select 1
    from public.products
    where is_fnb_stock_item
      and inventory_role <> 'fnb_stock_item'
  ) then
    raise exception '00389 failed: prepared F&B stock role was not generated';
  end if;
end
$$;
