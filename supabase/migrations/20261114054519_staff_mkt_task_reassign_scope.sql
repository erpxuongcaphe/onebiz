-- Retain company-wide team management and scope campaign management to linked data.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$declare body text;patched text;begin
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.mkt_reassign_task(uuid,uuid,text)') and p.prosecdef and md5(replace(p.prosrc,chr(13),''))='9341996a110be2f4f3c61c7c18c50896') then raise exception 'MKT_TASK_REASSIGN_BASELINE_CHANGED';end if;
 select replace(pg_get_functiondef('public.mkt_reassign_task(uuid,uuid,text)'::regprocedure),chr(13),'') into body;
 patched:=replace(body,'if not (public.user_has_permission(v_actor, ''mkt.manage_team'') or public.user_has_permission(v_actor, ''mkt.manage_campaigns'')) then raise exception ''INSUFFICIENT_ROLE'' using errcode = ''P0001''; end if;','');
 if patched=body then raise exception 'MKT_TASK_REASSIGN_GATE_CHANGED';end if;body:=patched;
 patched:=replace(body,'if not found or v_task.tenant_id <> public.get_user_tenant_id() then raise exception ''NOT_FOUND'' using errcode = ''P0001''; end if;',
  'if not found or v_task.tenant_id <> public.get_user_tenant_id() then raise exception ''NOT_FOUND'' using errcode = ''P0001''; end if;' || chr(10) ||
  '  perform 1 from public.mkt_content_items where id=v_task.content_item_id for update;' || chr(10) ||
  '  perform 1 from public.mkt_channel_work_packages where id in (v_task.work_package_id,(select work_package_id from public.mkt_content_items where id=v_task.content_item_id)) order by id for update;' || chr(10) ||
  '  perform 1 from public.mkt_campaigns where id in (v_task.campaign_id,(select campaign_id from public.mkt_channel_work_packages where id=v_task.work_package_id),(select campaign_id from public.mkt_content_items where id=v_task.content_item_id),(select w.campaign_id from public.mkt_content_items c join public.mkt_channel_work_packages w on w.id=c.work_package_id and w.tenant_id=c.tenant_id where c.id=v_task.content_item_id)) order by id for update;' || chr(10) ||
  '  if not (public.user_has_permission(v_actor,''mkt.manage_team'') or public._staff_mkt_linked_permission(v_actor,''mkt.manage_campaigns'',v_task.campaign_id,v_task.work_package_id,v_task.content_item_id,null)) then raise exception ''INSUFFICIENT_ROLE'' using errcode = ''P0001''; end if;');
 if patched=body then raise exception 'MKT_TASK_REASSIGN_SCOPE_CHANGED';end if;execute patched;
end$$;
commit;
