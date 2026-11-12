-- Preserve independent invoice/order/inventory alternatives. Resolve the F&B
-- view alternative for each invoice rather than assuming every branch agrees.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create function public._staff_my_fnb_order_view(p_branch uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select case when auth.uid() is null then false
  when p_branch is null then public._staff_permission_any_branch(auth.uid(),'pos_fnb.view_orders')
  else public._staff_permission_at_scope(auth.uid(),'pos_fnb.view_orders',p_branch) end
$$;
revoke all on function public._staff_my_fnb_order_view(uuid) from public,anon;
grant execute on function public._staff_my_fnb_order_view(uuid) to authenticated;
do $migration$
declare item record; source text; patched text; anchor text;
begin
 source:=pg_get_functiondef('public._staff_fnb_invoice_inventory_alternative(uuid,uuid)'::regprocedure);
 anchor:='public.user_has_permission(p_actor,''pos_fnb.view_orders'')';
 patched:=replace(source,anchor,'public._staff_my_fnb_order_view(p_branch)');
 if patched=source then raise exception 'STAFF_FNB_INVOICE_VIEW_HELPER_CHANGED';end if;
 execute patched;
 for item in select * from (values
  ('public.fnb_invoice_option_items_20261023(public.invoices)','($1).branch_id'),
  ('public.get_fnb_invoice_choice_catalog_20261023(uuid)','null::uuid'),
  ('public.get_fnb_invoice_filter_options_20261023(uuid)','null::uuid'),
  ('public.get_fnb_invoice_item_details_20261023(uuid[])','null::uuid'),
  ('public.get_fnb_invoice_item_notes_20261023(uuid)','null::uuid')
 ) as entries(signature,scope) loop
  source:=pg_get_functiondef(item.signature::regprocedure);
  anchor:='public.user_has_permission(actor,''pos_fnb.view_orders'')';
  if (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 then
   raise exception 'STAFF_FNB_INVOICE_VIEW_CONSUMER_CHANGED: %',item.signature;
  end if;
  patched:=replace(source,anchor,format('public._staff_my_fnb_order_view(%s)',item.scope));
  execute patched;
 end loop;
end $migration$;
commit;
