-- Cancel and delete also change dependent tasks; all affected links need scope.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$begin if to_regprocedure('public._staff_mkt_task_tree_allowed(uuid,uuid)') is not null then raise exception 'MKT_TASK_TREE_HELPER_EXISTS';end if;end$$;
create function public._staff_mkt_task_tree_allowed(p_actor uuid,p_task uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare tenant uuid;begin
 select tenant_id into tenant from public.profiles where id=p_actor and is_active;
 if tenant is null or not exists(select 1 from public.mkt_tasks where id=p_task and tenant_id=tenant and deleted_at is null) then return false;end if;
 if public.user_has_permission(p_actor,'mkt.manage_team') then return true;end if;
 perform 1 from public.mkt_tasks t where t.tenant_id=tenant and t.deleted_at is null and (t.id=p_task or t.dependency_task_id=p_task) order by t.id for update;
 perform 1 from public.mkt_content_items c where c.tenant_id=tenant and c.id in (select t.content_item_id from public.mkt_tasks t where t.tenant_id=tenant and t.deleted_at is null and (t.id=p_task or t.dependency_task_id=p_task)) order by c.id for update;
 perform 1 from public.mkt_channel_work_packages w where w.tenant_id=tenant and w.id in (
  select t.work_package_id from public.mkt_tasks t where t.tenant_id=tenant and t.deleted_at is null and (t.id=p_task or t.dependency_task_id=p_task)
  union select c.work_package_id from public.mkt_tasks t join public.mkt_content_items c on c.id=t.content_item_id and c.tenant_id=t.tenant_id where t.tenant_id=tenant and t.deleted_at is null and (t.id=p_task or t.dependency_task_id=p_task)
 ) order by w.id for update;
 perform 1 from public.mkt_campaigns c where c.tenant_id=tenant and c.id in (
  select t.campaign_id from public.mkt_tasks t where t.tenant_id=tenant and t.deleted_at is null and (t.id=p_task or t.dependency_task_id=p_task)
  union select w.campaign_id from public.mkt_tasks t join public.mkt_channel_work_packages w on w.id=t.work_package_id and w.tenant_id=t.tenant_id where t.tenant_id=tenant and t.deleted_at is null and (t.id=p_task or t.dependency_task_id=p_task)
  union select ci.campaign_id from public.mkt_tasks t join public.mkt_content_items ci on ci.id=t.content_item_id and ci.tenant_id=t.tenant_id where t.tenant_id=tenant and t.deleted_at is null and (t.id=p_task or t.dependency_task_id=p_task)
  union select w.campaign_id from public.mkt_tasks t join public.mkt_content_items ci on ci.id=t.content_item_id and ci.tenant_id=t.tenant_id join public.mkt_channel_work_packages w on w.id=ci.work_package_id and w.tenant_id=ci.tenant_id where t.tenant_id=tenant and t.deleted_at is null and (t.id=p_task or t.dependency_task_id=p_task)
 ) order by c.id for update;
 return not exists(select 1 from public.mkt_tasks t where t.tenant_id=tenant and t.deleted_at is null and (t.id=p_task or t.dependency_task_id=p_task) and not public._staff_mkt_linked_permission(p_actor,'mkt.manage_campaigns',t.campaign_id,t.work_package_id,t.content_item_id,null));
end$$;
revoke all on function public._staff_mkt_task_tree_allowed(uuid,uuid) from public,anon,authenticated;
do $$declare r record;body text;patched text;gate text;begin
 for r in select * from (values
  ('public.mkt_cancel_task(uuid,text)','1b1a1c9da589e37d28e94b38b2d1b95e','mkt.manage_team','mkt.manage_campaigns'),
  ('public.mkt_delete_task(uuid,text)','d4496ba41452b21e3444a7e2720182d2','mkt.manage_campaigns','mkt.manage_team')
 ) as x(sig,expected_hash,first_permission,second_permission) loop
  if not exists(select 1 from pg_proc p where p.oid=to_regprocedure(r.sig) and p.prosecdef and md5(replace(p.prosrc,chr(13),''))=r.expected_hash) then raise exception 'MKT_TASK_TREE_BASELINE_CHANGED: %',r.sig;end if;
  select replace(pg_get_functiondef(to_regprocedure(r.sig)),chr(13),'') into body;
  gate:='  if not (' || chr(10) || '    public.user_has_permission(v_actor, ''' || r.first_permission || ''')' || chr(10) || '    or public.user_has_permission(v_actor, ''' || r.second_permission || ''')' || chr(10) || '  ) then' || chr(10) || '    raise exception ''INSUFFICIENT_ROLE'' using errcode = ''P0001'';' || chr(10) || '  end if;';
  patched:=replace(body,gate,'');if patched=body then raise exception 'MKT_TASK_TREE_GATE_CHANGED: %',r.sig;end if;body:=patched;
  if strpos(body,'  update public.mkt_tasks')=0 then raise exception 'MKT_TASK_TREE_UPDATE_MISSING: %',r.sig;end if;
  patched:=substr(body,1,strpos(body,'  update public.mkt_tasks')-1) || '  if not public._staff_mkt_task_tree_allowed(v_actor,p_task_id) then raise exception ''INSUFFICIENT_ROLE'' using errcode = ''P0001''; end if;' || chr(10) || substr(body,strpos(body,'  update public.mkt_tasks'));
  if patched=body then raise exception 'MKT_TASK_TREE_SCOPE_CHANGED: %',r.sig;end if;execute patched;
 end loop;
end$$;
commit;
