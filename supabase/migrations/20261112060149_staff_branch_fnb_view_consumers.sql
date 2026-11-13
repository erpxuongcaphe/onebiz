-- Prospectively resolve order-view checks against the business document's
-- persisted branch. This does not yet expose branch-level view controls.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
declare item record; target oid; source text; patched text; n integer; scope text;
begin
 for item in select * from (values
  ('fnb_kitchen_return_lines','p_branch_id'),
  ('fnb_kitchen_return_summary','p_branch_id'),
  ('fnb_update_kitchen_item_status_v2','item'),
  ('fnb_update_kitchen_order_status_v2','order'),
  ('fnb_request_cancel_00455','k.branch_id'),
  ('_create_sales_return_auth_impl_00244','invoice'),
  ('_create_sales_return_auth_impl_00244_pre_00381','invoice')
 ) as entries(name,scope) loop
  select count(*),min(p.oid::bigint)::oid into n,target from pg_proc p
   where p.pronamespace='public'::regnamespace and p.proname=item.name;
  if n<>1 then raise exception 'STAFF_FNB_VIEW_CONSUMER_AMBIGUOUS: %',item.name;end if;
  scope:=case item.scope
   when 'item' then '(select ko.branch_id from public.kitchen_order_items ki join public.kitchen_orders ko on ko.id=ki.kitchen_order_id where ki.id=p_item_id and ko.tenant_id=v_tenant_id)'
   when 'order' then '(select ko.branch_id from public.kitchen_orders ko where ko.id=p_order_id and ko.tenant_id=v_tenant_id)'
   when 'invoice' then '(select i.branch_id from public.invoices i where i.id=p_invoice_id and i.tenant_id=public.get_user_tenant_id())'
   else item.scope end;
  source:=pg_get_functiondef(target);
  patched:=regexp_replace(source,'user_has_permission\(([^,]+),\s*''pos_fnb\.view_orders''\)',
   '_staff_permission_at_scope(\1,''pos_fnb.view_orders'','||scope||')','g');
  if patched=source then raise exception 'STAFF_FNB_VIEW_CONSUMER_CHANGED: %',item.name;end if;
  execute patched;
 end loop;
end $migration$;
commit;
