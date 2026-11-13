-- Resolve branch visibility once per statement rather than evaluating the
-- user's effective inventory permission once for every document and line.
-- Parent table RLS remains authoritative for child rows.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create function public._staff_inventory_document_readable_branches()
returns uuid[] language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(b.id),'{}'::uuid[]) from public.branches b
  where b.tenant_id=public.get_user_tenant_id() and public._staff_inventory_row_visible(b.id)
$$;
revoke all on function public._staff_inventory_document_readable_branches() from public,anon;
grant execute on function public._staff_inventory_document_readable_branches() to authenticated;
do $migration$
declare item record;
begin
 for item in select * from (values
  ('disposal_exports','disposal_export_items','disposal_id'),
  ('input_invoices',null,null),
  ('internal_exports','internal_export_items','export_id'),
  ('inventory_checks',null,null),
  ('purchase_orders','purchase_order_items','purchase_order_id'),
  ('supplier_returns','supplier_return_items','return_id')
 ) as documents(header_table,item_table,parent_key) loop
  execute format('alter policy staff_inventory_document_read on public.%I using ((select public._staff_lot_has_no_view_exception()) or coalesce(branch_id=any((select public._staff_inventory_document_readable_branches())::uuid[]),false))',item.header_table);
  if item.item_table is not null then
   execute format('alter policy staff_inventory_document_read on public.%1$I using (exists(select 1 from public.%2$I h where h.id=%1$I.%3$I))',item.item_table,item.header_table,item.parent_key);
  end if;
 end loop;
end $migration$;
commit;
