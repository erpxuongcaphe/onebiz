-- stock_movements_scoped is an owner-backed security-barrier view, so table
-- RLS alone does not constrain it. Filter its already-materialized branch
-- candidates, preserving independent report permissions and cost masking.
-- Inventory branch editing remains disabled until all consumers are audited.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create function public._staff_inventory_movement_visible(p_branch uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select public._staff_inventory_row_visible(p_branch) or (
  p_branch is not null and (
   public._staff_permission_at_scope(auth.uid(),'reports.analytics',p_branch)
   or public._staff_permission_at_scope(auth.uid(),'reports.dashboard',p_branch)
   or public._staff_permission_at_scope(auth.uid(),'reports.fnb',p_branch)
  )
 )
$$;
revoke all on function public._staff_inventory_movement_visible(uuid) from public,anon;
grant execute on function public._staff_inventory_movement_visible(uuid) to authenticated;
do $migration$
declare source text; patched text; old_acl text; old_owner oid; old_options text[];
 anchor text:='_can_read_branch_inventory_00476(( SELECT auth.uid() AS uid), _request_branch_candidates_20261029.tenant_id, _request_branch_candidates_20261029.branch_id)';
begin
 select pg_get_viewdef(c.oid,true),c.relacl::text,c.relowner,c.reloptions into source,old_acl,old_owner,old_options
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname='stock_movements_scoped' and c.relkind='v';
 if not coalesce('security_barrier=true'=any(old_options),false)
  or (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 then
  raise exception 'STAFF_STOCK_MOVEMENT_VIEW_CHANGED';end if;
 patched:=replace(source,anchor,anchor||' AND public._staff_inventory_movement_visible(_request_branch_candidates_20261029.branch_id)');
 execute format('create or replace view public.stock_movements_scoped with (%s) as %s',array_to_string(old_options,','),patched);
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname='stock_movements_scoped'
   and (c.relacl::text is distinct from old_acl or c.relowner<>old_owner or c.reloptions is distinct from old_options)) then
  raise exception 'STAFF_STOCK_MOVEMENT_VIEW_METADATA_CHANGED';end if;
end $migration$;
commit;
