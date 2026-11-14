-- Preserve designated reviewer access and scope manager access to linked campaigns.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$declare r record;body text;patched text;gate text;begin
 gate:='v_task.reviewer_id = v_actor or public.user_has_permission(v_actor, ''mkt.manage_campaigns'')';
 for r in select * from (values
  ('public.mkt_approve_task_review(uuid)','b82ceb876201b066c056e1656990fb35'),
  ('public.mkt_return_task_review(uuid,text)','2d07ca9fda48b0425a3b59c2f3e4172a')
 ) as x(sig,expected_hash) loop
  if not exists(select 1 from pg_proc p where p.oid=to_regprocedure(r.sig) and p.prosecdef and md5(replace(p.prosrc,chr(13),''))=r.expected_hash) then raise exception 'MKT_TASK_REVIEW_BASELINE_CHANGED: %',r.sig;end if;
  select replace(pg_get_functiondef(to_regprocedure(r.sig)),chr(13),'') into body;
  patched:=replace(body,'  if not (' || gate || ')',
   '  perform 1 from public.mkt_content_items where id=v_task.content_item_id for update;' || chr(10) ||
   '  perform 1 from public.mkt_channel_work_packages where id in (v_task.work_package_id,(select work_package_id from public.mkt_content_items where id=v_task.content_item_id)) order by id for update;' || chr(10) ||
   '  perform 1 from public.mkt_campaigns where id in (v_task.campaign_id,(select campaign_id from public.mkt_channel_work_packages where id=v_task.work_package_id),(select campaign_id from public.mkt_content_items where id=v_task.content_item_id),(select w.campaign_id from public.mkt_content_items c join public.mkt_channel_work_packages w on w.id=c.work_package_id and w.tenant_id=c.tenant_id where c.id=v_task.content_item_id)) order by id for update;' || chr(10) ||
   '  if not (' || gate || ')');
  if patched=body then raise exception 'MKT_TASK_REVIEW_LOCK_CHANGED: %',r.sig;end if;body:=patched;
  patched:=replace(body,gate,'coalesce(v_task.reviewer_id = v_actor,false) or public._staff_mkt_linked_permission(v_actor,''mkt.manage_campaigns'',v_task.campaign_id,v_task.work_package_id,v_task.content_item_id,null)');
  if patched=body then raise exception 'MKT_TASK_REVIEW_SCOPE_CHANGED: %',r.sig;end if;execute patched;
 end loop;
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.mkt_review_plan(uuid,uuid,text,text)') and p.prosecdef and md5(replace(p.prosrc,chr(13),''))='6d44455d779513e40df799dd8dbe1a22') then raise exception 'MKT_PLAN_REVIEW_BASELINE_CHANGED';end if;
 select replace(pg_get_functiondef('public.mkt_review_plan(uuid,uuid,text,text)'::regprocedure),chr(13),'') into body;
 patched:=replace(body,'if not public.user_has_permission(v_actor, ''mkt.manage_campaigns'') then raise exception ''INSUFFICIENT_ROLE'' using errcode = ''P0001''; end if;','');
 if patched=body then raise exception 'MKT_PLAN_REVIEW_GATE_CHANGED';end if;body:=patched;
 patched:=replace(body,'if not found or v_plan.tenant_id <> public.get_user_tenant_id() then raise exception ''NOT_FOUND'' using errcode = ''P0001''; end if;',
  'if not found or v_plan.tenant_id <> public.get_user_tenant_id() then raise exception ''NOT_FOUND'' using errcode = ''P0001''; end if;' || chr(10) ||
  '  perform 1 from public.mkt_channel_work_packages where id=v_plan.work_package_id for update;' || chr(10) ||
  '  perform 1 from public.mkt_campaigns where id in (v_plan.campaign_id,(select campaign_id from public.mkt_channel_work_packages where id=v_plan.work_package_id)) order by id for update;' || chr(10) ||
  '  if not public._staff_mkt_linked_permission(v_actor,''mkt.manage_campaigns'',null,null,null,p_plan_id) then raise exception ''INSUFFICIENT_ROLE'' using errcode = ''P0001''; end if;');
 if patched=body then raise exception 'MKT_PLAN_REVIEW_SCOPE_CHANGED';end if;execute patched;
end$$;
commit;
