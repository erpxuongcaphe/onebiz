-- Legacy orders remain directly readable by authenticated clients. Apply the
-- same branch exceptions as order-source invoice headers, while keeping the
-- independent own-order restriction and existing tenant/branch policies.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
declare name text;
begin
 foreach name in array array['sales_orders','sales_order_items'] loop
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname=name and c.relrowsecurity) then
   raise exception 'STAFF_LEGACY_ORDER_RLS_MISSING: %',name;
  end if;
 end loop;
end $migration$;

create policy staff_legacy_order_branch_view on public.sales_orders as restrictive
 for select to authenticated using (
  ((select public._staff_invoice_header_exception_flags()) & 3)=0
  or coalesce((branch_id::text||':order')=any((select public._staff_invoice_header_allowed_scopes())::text[]),false)
 );
create policy staff_legacy_order_item_branch_view on public.sales_order_items as restrictive
 for select to authenticated using (
  ((select public._staff_invoice_header_exception_flags()) & 3)=0
  or exists(select 1 from public.sales_orders o where o.id=sales_order_items.order_id)
 );
commit;
