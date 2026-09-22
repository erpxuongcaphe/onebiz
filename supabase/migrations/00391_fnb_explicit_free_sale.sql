-- 00391: Explicitly allow a direct-sale FnB SKU to be sold at 0d.
--
-- A zero price used to mean "setup draft" everywhere. Keep that behavior for
-- all existing data and make free FnB items an opt-in flag instead.

begin;

alter table public.products
  add column if not exists allow_free_sale boolean not null default false;

alter table public.products
  drop constraint if exists products_allow_free_sale_fnb_only_00391;

alter table public.products
  add constraint products_allow_free_sale_fnb_only_00391
  check (
    allow_free_sale = false
    or (
      product_type = 'sku'
      and channel = 'fnb'
      and allow_sale = true
      and coalesce(is_fnb_stock_item, false) = false
    )
  ) not valid;

alter table public.products
  validate constraint products_allow_free_sale_fnb_only_00391;

comment on column public.products.allow_free_sale is
  '00391: Explicit opt-in for a direct-sale FnB SKU at 0d. Existing zero-price drafts remain unavailable on POS.';

commit;

notify pgrst, 'reload schema';
