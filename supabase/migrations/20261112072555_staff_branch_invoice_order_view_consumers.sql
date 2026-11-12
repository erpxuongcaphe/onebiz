-- Prospectively scope the independent invoice and order view alternatives
-- in shared F&B invoice readers; neither code is exposed for branch editing yet.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create function public._staff_my_document_view(p_code text,p_branch uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select case when auth.uid() is null or p_code not in ('orders.view','invoices.view') then false
  when p_branch is null then public._staff_permission_any_branch(auth.uid(),p_code)
  else public._staff_permission_at_scope(auth.uid(),p_code,p_branch) end
$$;
revoke all on function public._staff_my_document_view(text,uuid) from public,anon;
grant execute on function public._staff_my_document_view(text,uuid) to authenticated;
do $migration$
declare item record; source text; patched text; anchor text; code text;
begin
 source:=pg_get_functiondef('public._staff_fnb_invoice_inventory_alternative(uuid,uuid)'::regprocedure);
 foreach code in array array['orders.view','invoices.view'] loop
  anchor:=format('public.user_has_permission(p_actor,%L)',code);
  patched:=replace(source,anchor,format('public._staff_my_document_view(%L,p_branch)',code));
  if patched=source then raise exception 'STAFF_DOCUMENT_VIEW_HELPER_CHANGED: %',code;end if;
  source:=patched;
 end loop;
 execute source;
 for item in select * from (values
  ('public.fnb_invoice_option_items_20261023(public.invoices)','($1).branch_id'),
  ('public.get_fnb_invoice_choice_catalog_20261023(uuid)','null::uuid'),
  ('public.get_fnb_invoice_filter_options_20261023(uuid)','null::uuid'),
  ('public.get_fnb_invoice_item_details_20261023(uuid[])','null::uuid'),
  ('public.get_fnb_invoice_item_notes_20261023(uuid)','null::uuid')
 ) as entries(signature,scope) loop
  source:=pg_get_functiondef(item.signature::regprocedure);
  foreach code in array array['orders.view','invoices.view'] loop
   anchor:=format('public.user_has_permission(actor,%L)',code);
   if (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 then
    raise exception 'STAFF_DOCUMENT_VIEW_CONSUMER_CHANGED: %, %',item.signature,code;
   end if;
   source:=replace(source,anchor,format('public._staff_my_document_view(%L,%s)',code,item.scope));
  end loop;
  execute source;
 end loop;
end $migration$;
commit;
