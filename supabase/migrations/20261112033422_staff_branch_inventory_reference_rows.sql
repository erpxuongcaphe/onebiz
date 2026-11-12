-- Operations references combine global product/supplier catalogs with
-- branch-specific lot and purchase documents. Only scope the latter.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
do $migration$
declare source text; anchor text := 'public.user_has_permission(auth.uid(),permission)';
begin
  source := pg_get_functiondef('public.ops_q_reference_rows(uuid,text,text,uuid)'::regprocedure);
  if (length(source)-length(replace(source,anchor,''))) / length(anchor) <> 1 then
    raise exception 'STAFF_INVENTORY_REFERENCE_CONSUMER_CHANGED';
  end if;
  execute replace(source,anchor,
    '(case when permission=''inventory.view'' then public._staff_permission_at_scope(auth.uid(),permission,p_branch) else public.user_has_permission(auth.uid(),permission) end)');
end $migration$;
commit;
