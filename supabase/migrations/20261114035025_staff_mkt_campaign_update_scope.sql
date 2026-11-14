-- Check both source and destination after locking the campaign.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$declare body text; patched text;begin
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.mkt_update_campaign(uuid,jsonb)') and p.prosecdef and md5(replace(p.prosrc,chr(13),''))='e839d3985dce52bf7029cc3d14d6d013') then raise exception 'MKT_CAMPAIGN_UPDATE_BASELINE_CHANGED';end if;
 select replace(pg_get_functiondef(to_regprocedure('public.mkt_update_campaign(uuid,jsonb)')),chr(13),'') into body;
 patched:=replace(body, 'if not public.user_has_permission(v_actor, ''mkt.manage_campaigns'') then raise exception ''INSUFFICIENT_ROLE'' using errcode = ''P0001''; end if;', '');
 if patched=body then raise exception 'MKT_UPDATE_PERMISSION_GATE_CHANGED';end if;
 body:=patched;
 patched:=replace(body,
  'if not found or v_campaign.tenant_id <> public.get_user_tenant_id() then raise exception ''NOT_FOUND'' using errcode = ''P0001''; end if;',
  'if not found or v_campaign.tenant_id <> public.get_user_tenant_id() then raise exception ''NOT_FOUND'' using errcode = ''P0001''; end if;' || chr(10) ||
  '  if not public._staff_mkt_campaign_permission(v_actor, ''mkt.manage_campaigns'', p_campaign_id) then raise exception ''INSUFFICIENT_ROLE'' using errcode = ''P0001''; end if;' || chr(10) ||
  '  if nullif(p_patch->>''branchId'', '''') is not null and not public._staff_permission_at_scope(v_actor, ''mkt.manage_campaigns'', (p_patch->>''branchId'')::uuid) then raise exception ''INSUFFICIENT_ROLE'' using errcode = ''P0001''; end if;');
 if patched=body then raise exception 'MKT_UPDATE_LOCK_GATE_CHANGED';end if;
 execute patched;
end$$;
commit;
