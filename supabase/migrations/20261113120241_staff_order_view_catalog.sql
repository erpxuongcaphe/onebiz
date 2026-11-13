-- Enable branch-specific order viewing only after its protected readers exist.
-- This changes the available editor choices; it does not alter any assignment.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
declare missing text;
begin
 if to_regprocedure('public._staff_my_document_view(text,uuid)') is null
  or to_regprocedure('public._staff_invoice_header_read(uuid,uuid,text)') is null
  or to_regprocedure('public._staff_invoice_item_read(uuid,uuid,text)') is null then
  raise exception 'STAFF_ORDER_VIEW_READERS_MISSING';
 end if;
 select string_agg(x.tbl||'.'||x.pol,', ' order by x.tbl,x.pol) into missing
 from (values ('invoices','staff_invoice_header_view_scope'),
  ('invoice_items','staff_invoice_item_view_scope'),
  ('sales_orders','staff_legacy_order_branch_view'),
  ('sales_order_items','staff_legacy_order_item_branch_view'),
  ('sales_orders','staff_own_legacy_order_read'),
  ('sales_order_items','staff_own_legacy_order_item_read')) x(tbl,pol)
 where not exists(select 1 from pg_policies p where p.schemaname='public'
  and p.tablename=x.tbl and p.policyname=x.pol and p.cmd='SELECT');
 if missing is not null then raise exception 'STAFF_ORDER_VIEW_POLICIES_MISSING: %',missing;end if;
end
$migration$;
insert into public.staff_branch_permission_catalog(permission_code,enforcement_version)
values ('orders.view',1);
commit;
