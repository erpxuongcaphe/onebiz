-- Preserve existing assignee, reviewer and creator paths; scope manager visibility.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$begin
 if to_regprocedure('public._staff_mkt_read_workflow(text,uuid)') is not null then raise exception 'MKT_WORKFLOW_READ_HELPER_EXISTS';end if;
end$$;
create function public._staff_mkt_read_workflow(p_kind text,p_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare u uuid:=auth.uid(); tenant uuid; result boolean:=false;begin
 if u is null then return false;end if;
 select tenant_id into tenant from public.profiles where id=u and is_active;
 if tenant is null then return false;end if;
 if p_kind='package' then
  select public.user_has_permission(u,'mkt.manage_team') or public._staff_mkt_linked_permission(u,'mkt.manage_campaigns',null,w.id,null,null) or public._staff_mkt_linked_permission(u,'mkt.split_work_packages',null,w.id,null,null)
  into result from public.mkt_channel_work_packages w where w.id=p_id and w.tenant_id=tenant;
 elsif p_kind='task' then
  select public.user_has_permission(u,'mkt.manage_team') or public._staff_mkt_linked_permission(u,'mkt.manage_campaigns',t.campaign_id,t.work_package_id,t.content_item_id,null)
  into result from public.mkt_tasks t where t.id=p_id and t.tenant_id=tenant;
 elsif p_kind='content' then
  select public.user_has_permission(u,'mkt.manage_team') or public.user_has_permission(u,'mkt.review_content') or public._staff_mkt_linked_permission(u,'mkt.manage_campaigns',null,null,c.id,null)
  into result from public.mkt_content_items c where c.id=p_id and c.tenant_id=tenant;
 end if;
 return coalesce(result,false);
end$$;
revoke all on function public._staff_mkt_read_workflow(text,uuid) from public,anon;
grant execute on function public._staff_mkt_read_workflow(text,uuid) to authenticated;
do $$declare r record;expression text;patched text;begin
 for r in select * from (values
  ('public.mkt_channel_work_packages','mkt_work_packages_select','428d70a3ffe01728e53be8086fcd6b52','( SELECT mkt_is_lead() AS mkt_is_lead)','public._staff_mkt_read_workflow(''package'',mkt_channel_work_packages.id)'),
  ('public.mkt_tasks','mkt_tasks_select','a3d4fb4fe2d90f357b6fa7bbacbd8f6e','( SELECT mkt_is_lead() AS mkt_is_lead)','public._staff_mkt_read_workflow(''task'',mkt_tasks.id)'),
  ('public.mkt_content_items','mkt_content_items_select','305dd74dfca9b87b2bfd32fc10729bf5','( SELECT mkt_can_review() AS mkt_can_review)','public._staff_mkt_read_workflow(''content'',mkt_content_items.id)')
 ) as x(tbl,policy,expected_hash,old_expr,new_expr) loop
  select pg_get_expr(polqual,polrelid) into expression from pg_policy where polrelid=to_regclass(r.tbl) and polname=r.policy;
  if expression is null or md5(expression)<>r.expected_hash then raise exception 'MKT_WORKFLOW_READ_BASELINE_CHANGED: %',r.policy;end if;
  patched:=replace(expression,r.old_expr,r.new_expr);
  if patched=expression then raise exception 'MKT_WORKFLOW_READ_SCOPE_CHANGED: %',r.policy;end if;
  if r.policy='mkt_work_packages_select' then
   expression:=patched;
   patched:=replace(expression,' OR ( SELECT user_has_permission(( SELECT auth.uid() AS uid), ''mkt.split_work_packages''::text) AS user_has_permission)','');
   if patched=expression then raise exception 'MKT_PACKAGE_SPLIT_READ_CHANGED';end if;
  end if;
  execute format('alter policy %I on %s using (%s)',r.policy,r.tbl,patched);
 end loop;
end$$;
commit;
