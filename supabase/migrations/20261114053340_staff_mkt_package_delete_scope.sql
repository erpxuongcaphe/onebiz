-- Deletion cascades to plans and tasks; every linked campaign must be in scope.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$declare body text;patched text;gate text;begin
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.mkt_delete_work_package(uuid,text)') and p.prosecdef and md5(replace(p.prosrc,chr(13),''))='5ddda8bf1c2715fe9e03d78d2dbff46e') then raise exception 'MKT_PACKAGE_DELETE_BASELINE_CHANGED';end if;
 select replace(pg_get_functiondef('public.mkt_delete_work_package(uuid,text)'::regprocedure),chr(13),'') into body;
 gate:='  if not public.user_has_permission(v_actor, ''mkt.manage_campaigns'') then' || chr(10) || '    raise exception ''INSUFFICIENT_ROLE'' using errcode = ''P0001'';' || chr(10) || '  end if;';
 patched:=replace(body,gate,'');if patched=body then raise exception 'MKT_PACKAGE_DELETE_GATE_CHANGED';end if;body:=patched;
 patched:=replace(body,'  with removed as (',
  '  perform 1 from public.mkt_channel_plans where work_package_id=p_work_package_id and tenant_id=v_tenant and deleted_at is null order by id for update;' || chr(10) ||
  '  perform 1 from public.mkt_tasks where work_package_id=p_work_package_id and tenant_id=v_tenant and deleted_at is null order by id for update;' || chr(10) ||
  '  perform 1 from public.mkt_content_items ci where ci.tenant_id=v_tenant and ci.id in (select t.content_item_id from public.mkt_tasks t where t.work_package_id=p_work_package_id and t.tenant_id=v_tenant and t.deleted_at is null) order by ci.id for update;' || chr(10) ||
  '  perform 1 from public.mkt_channel_work_packages w where w.tenant_id=v_tenant and w.id in (select ci.work_package_id from public.mkt_tasks t join public.mkt_content_items ci on ci.id=t.content_item_id and ci.tenant_id=t.tenant_id where t.work_package_id=p_work_package_id and t.tenant_id=v_tenant and t.deleted_at is null) order by w.id for update;' || chr(10) ||
  '  perform 1 from public.mkt_campaigns c where c.tenant_id=v_tenant and c.id in (select v_wp.campaign_id union select p.campaign_id from public.mkt_channel_plans p where p.work_package_id=p_work_package_id and p.tenant_id=v_tenant and p.deleted_at is null union select t.campaign_id from public.mkt_tasks t where t.work_package_id=p_work_package_id and t.tenant_id=v_tenant and t.deleted_at is null union select ci.campaign_id from public.mkt_tasks t join public.mkt_content_items ci on ci.id=t.content_item_id and ci.tenant_id=t.tenant_id where t.work_package_id=p_work_package_id and t.tenant_id=v_tenant and t.deleted_at is null union select w.campaign_id from public.mkt_tasks t join public.mkt_content_items ci on ci.id=t.content_item_id and ci.tenant_id=t.tenant_id join public.mkt_channel_work_packages w on w.id=ci.work_package_id and w.tenant_id=ci.tenant_id where t.work_package_id=p_work_package_id and t.tenant_id=v_tenant and t.deleted_at is null) order by c.id for update;' || chr(10) ||
  '  if not public._staff_mkt_linked_permission(v_actor,''mkt.manage_campaigns'',null,p_work_package_id,null,null) or exists(select 1 from public.mkt_channel_plans p where p.work_package_id=p_work_package_id and p.tenant_id=v_tenant and p.deleted_at is null and not public._staff_mkt_linked_permission(v_actor,''mkt.manage_campaigns'',null,null,null,p.id)) or exists(select 1 from public.mkt_tasks t where t.work_package_id=p_work_package_id and t.tenant_id=v_tenant and t.deleted_at is null and not public._staff_mkt_linked_permission(v_actor,''mkt.manage_campaigns'',t.campaign_id,t.work_package_id,t.content_item_id,null)) then raise exception ''INSUFFICIENT_ROLE'' using errcode = ''P0001''; end if;' || chr(10) ||
  '  with removed as (');
 if patched=body then raise exception 'MKT_PACKAGE_DELETE_SCOPE_CHANGED';end if;execute patched;
end$$;
commit;
