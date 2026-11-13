-- Purchasing work requires access to its own branch's purchase, supplier
-- return and input-invoice documents, independently of general inventory view.
-- The action right never expands the user's assigned-branch boundary.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create function public._staff_purchase_action_branches()
returns uuid[] language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(b.id),'{}'::uuid[]) from public.branches b
  where b.tenant_id=public.get_user_tenant_id()
   and public.user_has_branch_access(auth.uid(),b.id)
   and public._staff_permission_at_scope(auth.uid(),'inventory.create_po',b.id)
$$;
create function public._staff_purchase_document_view(p_branch uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(public._staff_my_inventory_view(p_branch),false) or case
  when p_branch is null then cardinality(public._staff_purchase_action_branches())>0
  else coalesce(public.user_has_branch_access(auth.uid(),p_branch),false)
   and public._staff_permission_at_scope(auth.uid(),'inventory.create_po',p_branch) end
$$;
revoke all on function public._staff_purchase_action_branches(),public._staff_purchase_document_view(uuid) from public,anon;
grant execute on function public._staff_purchase_action_branches(),public._staff_purchase_document_view(uuid) to authenticated;
do $migration$
declare item record;source text;entry_anchor text;row_anchor text;
begin
 for item in select * from (values
  ('public.get_purchase_order_list_workspace(integer,integer,text,text,text,timestamptz,timestamptz,numeric,numeric,uuid)','po','purchase_orders'),
  ('public.get_supplier_return_list_workspace(integer,integer,text,text,text,timestamptz,timestamptz,numeric,numeric,uuid)','sr','supplier_returns'),
  ('public.get_input_invoice_list_workspace(integer,integer,text,text,text,timestamptz,timestamptz,numeric,numeric,uuid)','ii','input_invoices')
 ) as docs(signature,row_alias,header_table) loop
  source:=pg_get_functiondef(item.signature::regprocedure);
  entry_anchor:='public._staff_my_inventory_view(p_branch_id)';
  row_anchor:=format('public._staff_my_inventory_view(%s.branch_id)',item.row_alias);
  if position(entry_anchor in source)=0 or position(row_anchor in source)=0 then
   raise exception 'STAFF_PURCHASE_DOCUMENT_READER_CHANGED: %',item.signature;end if;
  source:=replace(replace(source,entry_anchor,'public._staff_purchase_document_view(p_branch_id)'),row_anchor,
   format('(%1$s or coalesce(%2$s.branch_id=any((select public._staff_purchase_action_branches())::uuid[]),false))',row_anchor,item.row_alias));
  execute source;
  execute format('alter policy staff_inventory_document_read on public.%I using ((select public._staff_lot_has_no_view_exception()) or coalesce(branch_id=any((select public._staff_inventory_document_readable_branches())::uuid[]),false) or coalesce(branch_id=any((select public._staff_purchase_action_branches())::uuid[]),false))',item.header_table);
 end loop;
end $migration$;
commit;
