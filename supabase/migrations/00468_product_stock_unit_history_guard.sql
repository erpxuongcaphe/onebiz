-- Product edits must obey the same stock-unit rule as the UOM editor.
-- Never reinterpret posted stock by changing its unit label.
begin;
create or replace function public.guard_product_stock_unit_00468()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if lower(trim(new.unit)) is distinct from lower(trim(old.unit))
     and (
       exists (select 1 from public.stock_movements where product_id = old.id)
       or exists (select 1 from public.branch_stock where product_id = old.id and quantity <> 0)
       or exists (select 1 from public.purchase_order_items where product_id = old.id)
       or exists (select 1 from public.invoice_items where product_id = old.id)
       or exists (select 1 from public.bom_items where material_id = old.id)
     ) then
    raise exception using errcode = '55000', message = 'PRODUCT_STOCK_UNIT_LOCKED_BY_HISTORY';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_product_stock_unit_00468() from public, anon, authenticated;
create trigger guard_product_stock_unit_00468
before update of unit on public.products
for each row execute function public.guard_product_stock_unit_00468();
commit;
