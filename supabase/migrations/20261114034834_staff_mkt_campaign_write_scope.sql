-- Prepare branch-aware create/status checks. Do not release MKT branch grants
-- until every MKT read/write path and RLS policy has been covered.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$declare x record;begin
 for x in select * from (values
  ('public.mkt_create_campaign(text,text,date,date,numeric,uuid,uuid,jsonb)','62343c127a689da4a1703a28a062168a'),
  ('public.mkt_change_campaign_status(uuid,text,text)','30a0c7d6c55c05cb66fe8b2723efdc12')
 ) v(signature,expected) loop
  if not exists(select 1 from pg_proc p where p.oid=to_regprocedure(x.signature) and p.prosecdef and md5(replace(p.prosrc,chr(13),''))=x.expected) then raise exception 'MKT_CAMPAIGN_WRITE_BASELINE_CHANGED: %',x.signature;end if;
 end loop;
 if to_regprocedure('public._staff_mkt_campaign_permission(uuid,text,uuid)') is null then raise exception 'MKT_SCOPE_RESOLVER_MISSING';end if;
end$$;
do $$declare body text; patched text;begin
 select replace(pg_get_functiondef(to_regprocedure('public.mkt_create_campaign(text,text,date,date,numeric,uuid,uuid,jsonb)')),chr(13),'') into body;
 if position('public.user_has_permission(v_actor, ''mkt.manage_campaigns'')' in body)=0 then raise exception 'MKT_CREATE_SCOPE_PATCH_MISSING';end if;
 patched:=replace(body,'public.user_has_permission(v_actor, ''mkt.manage_campaigns'')',
  '(case when p_branch_id is null then public.user_has_permission(v_actor, ''mkt.manage_campaigns'') else public._staff_permission_at_scope(v_actor, ''mkt.manage_campaigns'', p_branch_id) end)');
 execute patched;
 select replace(pg_get_functiondef(to_regprocedure('public.mkt_change_campaign_status(uuid,text,text)')),chr(13),'') into body;
 if position('public.user_has_permission(v_actor, ''mkt.manage_campaigns'')' in body)=0 or position('public.user_has_permission(v_actor, ''mkt.override_campaign'')' in body)=0 then raise exception 'MKT_STATUS_SCOPE_PATCH_MISSING';end if;
 patched:=replace(body,'public.user_has_permission(v_actor, ''mkt.manage_campaigns'')','public._staff_mkt_campaign_permission(v_actor, ''mkt.manage_campaigns'', p_campaign_id)');
 patched:=replace(patched,'public.user_has_permission(v_actor, ''mkt.override_campaign'')','public._staff_mkt_campaign_permission(v_actor, ''mkt.override_campaign'', p_campaign_id)');
 execute patched;
end$$;
commit;
