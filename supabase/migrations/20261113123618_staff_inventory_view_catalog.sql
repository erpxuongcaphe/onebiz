-- Enable editing inventory viewing by branch only after the scoped readers,
-- document policies and the separate POS stock projection are in place.
-- This does not create or change any user's permissions.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
declare missing text;
begin
 if to_regprocedure('public._staff_my_inventory_view(uuid)') is null
  or to_regprocedure('public._staff_inventory_row_visible(uuid)') is null
  or to_regprocedure('public._staff_inventory_movement_visible(uuid)') is null
  or to_regprocedure('public._staff_stock_readable_branches()') is null
  or to_regprocedure('public.get_pos_stock_snapshot_scoped(uuid,uuid[])') is null then
  raise exception 'STAFF_INVENTORY_VIEW_READERS_OR_POS_MISSING';
 end if;
 select string_agg(x.tbl||'.'||x.pol,', ' order by x.tbl,x.pol) into missing
 from (values ('branch_stock','staff_inventory_branch_stock_read'),
  ('product_lots','staff_inventory_lot_scope'),
  ('stock_movements','staff_movement_direct_scope'),
  ('inventory_checks','staff_inventory_document_read'),
  ('inventory_check_items','inventory_check_items_scope_00477'),
  ('purchase_orders','staff_inventory_document_read'),
  ('purchase_order_items','staff_inventory_document_read'),
  ('disposal_exports','staff_inventory_document_read'),
  ('disposal_export_items','staff_inventory_document_read'),
  ('internal_exports','staff_inventory_document_read'),
  ('internal_export_items','staff_inventory_document_read'),
  ('input_invoices','staff_inventory_document_read'),
  ('supplier_returns','staff_inventory_document_read'),
  ('supplier_return_items','staff_inventory_document_read')) x(tbl,pol)
 where not exists(select 1 from pg_policies p where p.schemaname='public'
  and p.tablename=x.tbl and p.policyname=x.pol and p.cmd='SELECT' and p.permissive='RESTRICTIVE');
 if missing is not null then raise exception 'STAFF_INVENTORY_VIEW_POLICIES_MISSING: %',missing; end if;
 select string_agg(x.name,', ' order by x.name) into missing
 from (values ('products_scoped'),('stock_movements_scoped')) x(name)
 where not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname=x.name and c.relkind='v'
   and 'security_barrier=true'=any(coalesce(c.reloptions,'{}'::text[]))
   and position('_staff_' in pg_get_viewdef(c.oid))>0);
 if missing is not null then raise exception 'STAFF_INVENTORY_VIEW_PROJECTIONS_MISSING: %',missing; end if;
end
$migration$;
insert into public.staff_branch_permission_catalog(permission_code,enforcement_version)
values ('inventory.view',1);
commit;
