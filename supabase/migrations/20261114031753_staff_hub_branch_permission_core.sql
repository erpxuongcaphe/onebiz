-- Preparation only: existing staff Hub scopes keep their current behaviour
-- until all callers are migrated and the branch catalogue is released.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$ declare item record; begin
 for item in select * from (values
  ('public.ops_can(uuid,text)','567acce12030bfa6d63b1a20725ab73d'),
  ('public.ops_manager(uuid,uuid)','38ddf37490b932d5fe3d255962c3a536'),
  ('public.ops_q_can(uuid,text)','ae17e9c7eb7abb2135bdf4f74b33a9a6')
 ) as x(signature,expected) loop
  if not exists(select 1 from pg_proc p where p.oid=to_regprocedure(item.signature)
    and p.prosecdef and md5(replace(p.prosrc,chr(13),''))=item.expected) then
   raise exception 'HUB_BRANCH_BASELINE_CHANGED: %',item.signature;
  end if;
 end loop;
 if to_regprocedure('public._staff_permission_at_scope(uuid,text,uuid)') is null then
  raise exception 'HUB_BRANCH_RESOLVER_MISSING';
 end if;
end $$;

create or replace function public.ops_can(p_branch uuid,p_cap text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join public.branches b on b.tenant_id=p.tenant_id
 where p.id=auth.uid() and p.is_active and b.id=p_branch and b.is_active
 and public._staff_permission_at_scope(p.id,'ops.view',b.id)
 and public._staff_permission_at_scope(p.id,case p_cap
  when 'view' then 'ops.view' when 'work' then 'ops.work'
  when 'verify' then 'ops.verify' when 'approve_policy' then 'ops.configure'
  when 'close_period' then 'ops.close_period' when 'cancel_todo' then 'ops.cancel_todo'
  when 'manage_members' then 'ops.manage_members' else null end,b.id)
 and (public.ops_ceo() or exists(select 1 from public.ops_members m where m.tenant_id=p.tenant_id and m.branch_id=b.id and m.user_id=p.id and m.active
  and ((p_cap='view' and m.member_role in ('manager','reviewer')) or p_cap=any(m.capabilities) or (p_cap='work' and m.member_role='manager')))
  or p_cap='view' and exists(select 1 from public.ops_q_grants g where g.tenant_id=p.tenant_id and g.branch_id=b.id and g.user_id=p.id and g.active
   and ((g.can_audit or g.can_correct) and public._staff_permission_at_scope(p.id,'ops.verify',b.id) or g.can_accounting and public._staff_permission_at_scope(p.id,'ops.work',b.id)))));
$$;

create or replace function public.ops_manager(p_branch uuid,p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.ops_members m join public.profiles p on p.id=m.user_id and p.tenant_id=m.tenant_id
 where m.branch_id=p_branch and m.user_id=p_user and m.active and p.is_active and m.member_role='manager'
 and public._staff_permission_at_scope(p.id,'ops.view',m.branch_id) and public._staff_permission_at_scope(p.id,'ops.work',m.branch_id));
$$;

create or replace function public.ops_q_can(p_branch uuid,p_cap text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join public.branches b on b.tenant_id=p.tenant_id
 where p.id=auth.uid() and p.is_active and b.id=p_branch and b.is_active and public._staff_permission_at_scope(p.id,'ops.view',b.id) and
 case p_cap
 when 'manage' then public.ops_can(b.id,'approve_policy')
 when 'close' then public.ops_can(b.id,'close_period')
 when 'work' then public.ops_manager(b.id,p.id) and public.ops_can(b.id,'work')
 when 'qc' then public._staff_permission_at_scope(p.id,'ops.verify',b.id) and not exists(select 1 from public.ops_members m where m.tenant_id=p.tenant_id and m.branch_id=b.id and m.user_id=p.id and m.active and m.member_role='manager')
   and exists(select 1 from public.ops_q_grants g where g.tenant_id=p.tenant_id and g.branch_id=b.id and g.user_id=p.id and g.active and g.can_audit)
 when 'correct' then public._staff_permission_at_scope(p.id,'ops.verify',b.id) and not exists(select 1 from public.ops_members m where m.tenant_id=p.tenant_id and m.branch_id=b.id and m.user_id=p.id and m.active and m.member_role='manager')
   and exists(select 1 from public.ops_q_grants g where g.tenant_id=p.tenant_id and g.branch_id=b.id and g.user_id=p.id and g.active and g.can_correct)
 when 'accounting' then public._staff_permission_at_scope(p.id,'ops.work',b.id) and exists(select 1 from public.ops_q_grants g where g.tenant_id=p.tenant_id and g.branch_id=b.id and g.user_id=p.id and g.active and g.can_accounting)
 when 'view' then public.ops_can(b.id,'view')
 else false end);
$$;
commit;
