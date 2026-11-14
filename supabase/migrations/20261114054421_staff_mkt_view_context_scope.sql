-- An explicit branch view grant permits entry; shared-data flags stay global.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$declare body text;patched text;begin
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.mkt_get_my_context()') and p.prosecdef and md5(replace(p.prosrc,chr(13),''))='98ce58db86dffd6cdd78fc91c103e984') then raise exception 'MKT_CONTEXT_BASELINE_CHANGED';end if;
 select replace(pg_get_functiondef('public.mkt_get_my_context()'::regprocedure),chr(13),'') into body;
 patched:=replace(body,'''canView'', public.user_has_permission(v_actor, ''mkt.view'')',
  '''canView'', (public.user_has_permission(v_actor, ''mkt.view'') or exists(select 1 from public.user_branch_permission_overrides o where o.tenant_id=v_profile.tenant_id and o.user_id=v_actor and o.permission_code=''mkt.view'' and o.override_type=''grant'' and public.user_has_permission_at_branch(v_actor,''mkt.view'',o.branch_id)))');
 if patched=body then raise exception 'MKT_CONTEXT_VIEW_CHANGED';end if;execute patched;
end$$;
commit;
