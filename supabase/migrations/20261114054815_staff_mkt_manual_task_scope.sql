-- Scope campaign managers to every linked campaign; preserve team-wide access.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$declare body text;patched text;gate text;begin
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.mkt_create_manual_task(text,text,uuid,uuid,uuid,uuid,text,timestamptz,integer)') and p.prosecdef and md5(replace(p.prosrc,chr(13),''))='72739656ce1e41761d2b0ede47f9061e') then raise exception 'MKT_MANUAL_TASK_BASELINE_CHANGED';end if;
 select replace(pg_get_functiondef('public.mkt_create_manual_task(text,text,uuid,uuid,uuid,uuid,text,timestamptz,integer)'::regprocedure),chr(13),'') into body;
 gate:='  if not (public.user_has_permission(v_actor, ''mkt.manage_team'') or public.user_has_permission(v_actor, ''mkt.manage_campaigns'')) then' || chr(10) || '    raise exception ''INSUFFICIENT_ROLE'' using errcode = ''P0001'';' || chr(10) || '  end if;';
 patched:=replace(body,gate,'');if patched=body then raise exception 'MKT_MANUAL_TASK_GATE_CHANGED';end if;body:=patched;
 patched:=replace(body,'  insert into public.mkt_tasks (',
  '  perform 1 from public.mkt_channel_work_packages where id=p_work_package_id and tenant_id=v_tenant for update;' || chr(10) ||
  '  perform 1 from public.mkt_campaigns where tenant_id=v_tenant and id in (p_campaign_id,(select campaign_id from public.mkt_channel_work_packages where id=p_work_package_id and tenant_id=v_tenant)) order by id for update;' || chr(10) ||
  '  if not (public.user_has_permission(v_actor,''mkt.manage_team'') or public._staff_mkt_linked_permission(v_actor,''mkt.manage_campaigns'',p_campaign_id,p_work_package_id,null,null)) then raise exception ''INSUFFICIENT_ROLE'' using errcode = ''P0001''; end if;' || chr(10) ||
  '  insert into public.mkt_tasks (');
 if patched=body then raise exception 'MKT_MANUAL_TASK_SCOPE_CHANGED';end if;execute patched;
end$$;
commit;
