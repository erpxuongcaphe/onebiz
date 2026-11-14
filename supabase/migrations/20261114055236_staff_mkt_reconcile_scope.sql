-- Check both plan and task scope before reconciling execution.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$declare body text;patched text;gate text;begin
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.mkt_reconcile_plan_task(uuid,uuid,text,uuid,text)') and p.prosecdef and md5(replace(p.prosrc,chr(13),''))='acc251e635d7b2ac1dfea60f0f971bce') then raise exception 'MKT_RECONCILE_BASELINE_CHANGED';end if;
 select replace(pg_get_functiondef('public.mkt_reconcile_plan_task(uuid,uuid,text,uuid,text)'::regprocedure),chr(13),'') into body;
 gate:='  if not public.user_has_permission(v_actor, ''mkt.manage_campaigns'') then' || chr(10) || '    raise exception ''INSUFFICIENT_ROLE'' using errcode = ''P0001'';' || chr(10) || '  end if;';
 patched:=replace(body,gate,'');if patched=body then raise exception 'MKT_RECONCILE_GATE_CHANGED';end if;body:=patched;
 patched:=replace(body,'  if p_decision = ''cancel'' then',
  '  perform 1 from public.mkt_content_items where id=v_task.content_item_id for update;' || chr(10) ||
  '  perform 1 from public.mkt_channel_work_packages where id in (v_plan.work_package_id,v_task.work_package_id,(select work_package_id from public.mkt_content_items where id=v_task.content_item_id)) order by id for update;' || chr(10) ||
  '  perform 1 from public.mkt_campaigns where id in (v_plan.campaign_id,v_task.campaign_id,(select campaign_id from public.mkt_channel_work_packages where id=v_plan.work_package_id),(select campaign_id from public.mkt_channel_work_packages where id=v_task.work_package_id),(select campaign_id from public.mkt_content_items where id=v_task.content_item_id),(select w.campaign_id from public.mkt_content_items c join public.mkt_channel_work_packages w on w.id=c.work_package_id and w.tenant_id=c.tenant_id where c.id=v_task.content_item_id)) order by id for update;' || chr(10) ||
  '  if not (public._staff_mkt_linked_permission(v_actor,''mkt.manage_campaigns'',null,null,null,p_plan_id) and public._staff_mkt_linked_permission(v_actor,''mkt.manage_campaigns'',v_task.campaign_id,v_task.work_package_id,v_task.content_item_id,null)) then raise exception ''INSUFFICIENT_ROLE'' using errcode = ''P0001''; end if;' || chr(10) ||
  '  if p_decision = ''cancel'' then');
 if patched=body then raise exception 'MKT_RECONCILE_SCOPE_CHANGED';end if;execute patched;
end$$;
commit;
