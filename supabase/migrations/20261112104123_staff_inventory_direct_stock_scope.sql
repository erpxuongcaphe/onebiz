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
declare source text; patched text;
 anchor text:='_can_read_branch_inventory_00476(( SELECT auth.uid() AS uid), _request_branch_candidates_20261029.tenant_id, _request_branch_candidates_20261029.branch_id)';
begin
 source:=pg_get_viewdef('public.stock_movements_scoped'::regclass,true);
 if (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 then
  raise exception 'STAFF_STOCK_MOVEMENT_VIEW_CHANGED';end if;
 patched:=replace(source,anchor,anchor||' AND public._staff_inventory_movement_visible(_request_branch_candidates_20261029.branch_id)');
 execute 'create or replace view public.stock_movements_scoped with (security_barrier=true) as '||patched;
end $migration$;
commit;
