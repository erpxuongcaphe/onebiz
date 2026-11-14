-- Scope manager visibility while preserving owner and reviewer visibility.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$declare body text;patched text;begin
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.mkt_can_read_plan(uuid)') and p.prosecdef and md5(replace(p.prosrc,chr(13),''))='1168b589933b659404d22c250570ef93') then raise exception 'MKT_PLAN_READ_BASELINE_CHANGED';end if;
 select replace(pg_get_functiondef('public.mkt_can_read_plan(uuid)'::regprocedure),chr(13),'') into body;
 patched:=replace(body,'(select public.mkt_is_lead())','(public.user_has_permission(auth.uid(),''mkt.manage_team'') or public._staff_mkt_linked_permission(auth.uid(),''mkt.manage_campaigns'',null,null,null,p_plan_id))');
 if patched=body then raise exception 'MKT_PLAN_READ_SCOPE_CHANGED';end if;
 execute patched;
end$$;
commit;
