-- A transfer operator may read a transfer touching an assigned branch where
-- the transfer action is granted. Independent inventory-view access remains.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create function public._staff_transfer_action_branches()
returns uuid[] language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(b.id),'{}'::uuid[]) from public.branches b
 where b.tenant_id=public.get_user_tenant_id()
  and public.user_has_branch_access(auth.uid(),b.id)
  and public._staff_permission_at_scope(auth.uid(),'inventory.transfer',b.id)
$$;
create function public._staff_transfer_document_view(p_branch uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(public._staff_my_inventory_view(p_branch),false) or case
  when p_branch is null then cardinality(public._staff_transfer_action_branches())>0
  else coalesce(p_branch=any(public._staff_transfer_action_branches()),false) end
$$;
revoke all on function public._staff_transfer_action_branches(),public._staff_transfer_document_view(uuid) from public,anon;
grant execute on function public._staff_transfer_action_branches(),public._staff_transfer_document_view(uuid) to authenticated;
alter policy transaction_branch_read_00567 on public.stock_transfers using (
 (public.can_read_branch_document_00567(tenant_id,from_branch_id) and
   (public._staff_inventory_row_visible(from_branch_id) or coalesce(from_branch_id=any((select public._staff_transfer_action_branches())::uuid[]),false)))
 or (public.can_read_branch_document_00567(tenant_id,to_branch_id) and
   (public._staff_inventory_row_visible(to_branch_id) or coalesce(to_branch_id=any((select public._staff_transfer_action_branches())::uuid[]),false)))
);
do $migration$
declare source text; entry_anchor text := 'public._staff_my_inventory_view(p_branch_id)'; side text; anchor text;
begin
 source:=pg_get_functiondef('public.get_stock_transfer_list_workspace(integer,integer,text,text,text[],timestamptz,timestamptz,uuid,uuid,uuid,integer,integer,uuid)'::regprocedure);
 if position(entry_anchor in source)=0 then raise exception 'STAFF_TRANSFER_DOCUMENT_READER_CHANGED';end if;
 source:=replace(source,entry_anchor,'public._staff_transfer_document_view(p_branch_id)');
 foreach side in array array['from_branch_id','to_branch_id'] loop
  anchor:=format('public._staff_my_inventory_view(t.%s)',side);
  if position(anchor in source)=0 then raise exception 'STAFF_TRANSFER_DOCUMENT_SIDE_CHANGED: %',side;end if;
  source:=replace(source,anchor,format('(%1$s or coalesce(t.%2$s=any((select public._staff_transfer_action_branches())::uuid[]),false))',anchor,side));
 end loop;
 execute source;
end $migration$;
commit;
