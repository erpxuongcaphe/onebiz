-- Use the branch of the persisted stocktake for the view prerequisite.
-- Editing/cancelling remains independently guarded by its existing permission.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $migration$
declare source text; patched text; anchor text := 'public.user_has_permission(actor,''inventory.view'')';
begin
  source := pg_get_functiondef('public._change_inventory_check(uuid,text,jsonb,text,text,text,uuid,text,boolean)'::regprocedure);
  if (length(source)-length(replace(source,anchor,''))) / length(anchor) <> 1 then
    raise exception 'STAFF_INVENTORY_CHECK_VIEW_CONSUMER_CHANGED';
  end if;
  patched := replace(source,anchor,
    'public._staff_permission_at_scope(actor,''inventory.view'',(select ic.branch_id from public.inventory_checks ic where ic.id=p_check_id and ic.tenant_id=public.get_user_tenant_id()))');
  execute patched;
end $migration$;
commit;
