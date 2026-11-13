-- Stocktake actions require their own branch's documents, independently of
-- general inventory viewing.  Cost visibility remains a separate permission.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
set local search_path=public;

create function public._staff_stocktake_action_branches()
returns uuid[] language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(b.id),'{}'::uuid[]) from public.branches b
  where b.tenant_id=public.get_user_tenant_id()
   and public.user_has_branch_access(auth.uid(),b.id)
   and (public._staff_permission_at_scope(auth.uid(),'inventory.check',b.id)
     or public._staff_permission_at_scope(auth.uid(),'inventory.edit_check',b.id)
     or public._staff_permission_at_scope(auth.uid(),'inventory.cancel_check',b.id))
$$;
create function public._staff_stocktake_document_view(p_branch uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(public._staff_my_inventory_view(p_branch),false) or case
  when p_branch is null then cardinality(public._staff_stocktake_action_branches())>0
  else coalesce(p_branch=any(public._staff_stocktake_action_branches()),false) end
$$;
revoke all on function public._staff_stocktake_action_branches(),public._staff_stocktake_document_view(uuid) from public,anon;
grant execute on function public._staff_stocktake_action_branches(),public._staff_stocktake_document_view(uuid) to authenticated;

do $migration$
declare source text; entry_anchor text; row_anchor text; old_acl text; old_owner oid; old_options text[];
begin
 source:=pg_get_functiondef('public.get_inventory_check_list_workspace(integer,integer,text,text,text[],timestamptz,timestamptz,uuid,uuid)'::regprocedure);
 entry_anchor:='public._staff_my_inventory_view(p_branch_id)';
 row_anchor:='public._staff_my_inventory_view(c.branch_id)';
 if position(entry_anchor in source)=0 or position(row_anchor in source)=0 then
  raise exception 'STAFF_STOCKTAKE_DOCUMENT_READER_CHANGED';end if;
 source:=replace(replace(source,entry_anchor,'public._staff_stocktake_document_view(p_branch_id)'),row_anchor,
  format('(%s or coalesce(c.branch_id=any((select public._staff_stocktake_action_branches())::uuid[]),false))',row_anchor));
 execute source;

 source:=pg_get_functiondef('public.get_inventory_check_change_source(uuid)'::regprocedure);
 entry_anchor:='public._staff_my_inventory_view(null::uuid)';
 row_anchor:='public._staff_my_inventory_view(c.branch_id)';
 if position(entry_anchor in source)=0 or position(row_anchor in source)=0 then
  raise exception 'STAFF_STOCKTAKE_DOCUMENT_DETAIL_CHANGED';end if;
 execute replace(replace(source,entry_anchor,'public._staff_stocktake_document_view(null::uuid)'),row_anchor,'public._staff_stocktake_document_view(c.branch_id)');

 select pg_get_viewdef(c.oid,true),c.relacl::text,c.relowner,c.reloptions into source,old_acl,old_owner,old_options
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname='inventory_check_items_scoped' and c.relkind='v';
 row_anchor:='_staff_inventory_row_visible(o.branch_id)';
 if position(row_anchor in source)=0 then raise exception 'STAFF_STOCKTAKE_DOCUMENT_VIEW_CHANGED';end if;
 execute format('create or replace view public.inventory_check_items_scoped %s as %s',
  case when old_options is null then '' else 'with ('||array_to_string(old_options,',')||')' end,
  replace(source,row_anchor,'('||row_anchor||' or coalesce(o.branch_id=any((select public._staff_stocktake_action_branches())::uuid[]),false))'));
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname='inventory_check_items_scoped'
   and (c.relacl::text is distinct from old_acl or c.relowner<>old_owner or c.reloptions is distinct from old_options)) then
  raise exception 'STAFF_STOCKTAKE_VIEW_METADATA_CHANGED';end if;

 alter policy staff_inventory_document_read on public.inventory_checks using (
  (select public._staff_lot_has_no_view_exception())
  or coalesce(branch_id=any((select public._staff_inventory_document_readable_branches())::uuid[]),false)
  or coalesce(branch_id=any((select public._staff_stocktake_action_branches())::uuid[]),false));
end $migration$;

-- The change operation retains its separate edit/cancel guard.  Its read
-- prerequisite must accept the same scoped work access as the document list.
do $stocktake_mutation$
declare source text; anchor text := 'public._staff_permission_at_scope(actor,''inventory.view'',(select ic.branch_id from public.inventory_checks ic where ic.id=p_check_id and ic.tenant_id=public.get_user_tenant_id()))';
begin
 source:=pg_get_functiondef('public._change_inventory_check(uuid,text,jsonb,text,text,text,uuid,text,boolean)'::regprocedure);
 if (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 then
  raise exception 'STAFF_STOCKTAKE_MUTATION_VIEW_GUARD_CHANGED';end if;
 execute replace(source,anchor,'public._staff_stocktake_document_view((select ic.branch_id from public.inventory_checks ic where ic.id=p_check_id and ic.tenant_id=public.get_user_tenant_id()))');
end $stocktake_mutation$;
commit;
