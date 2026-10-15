begin;
set local lock_timeout='3s';
-- New related-branch grants do not confer any central OneBiz permission.
create or replace function public.ops_can(p_branch uuid,p_cap text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join public.branches b on b.tenant_id=p.tenant_id
 where p.id=auth.uid() and p.is_active and b.id=p_branch and b.is_active
 and public.ops_has_permission('ops.view')
 and public.ops_has_permission(case p_cap
  when 'view' then 'ops.view' when 'work' then 'ops.work'
  when 'verify' then 'ops.verify' when 'approve_policy' then 'ops.configure'
  when 'close_period' then 'ops.close_period' when 'cancel_todo' then 'ops.cancel_todo'
  when 'manage_members' then 'ops.manage_members' else null end)
 and (public.ops_ceo() or exists(select 1 from public.ops_members m where m.tenant_id=p.tenant_id and m.branch_id=b.id and m.user_id=p.id and m.active
  and ((p_cap='view' and m.member_role in ('manager','reviewer')) or p_cap=any(m.capabilities) or (p_cap='work' and m.member_role='manager')))
  or p_cap='view' and exists(select 1 from public.ops_q_grants g where g.tenant_id=p.tenant_id and g.branch_id=b.id and g.user_id=p.id and g.active
   and ((g.can_audit or g.can_correct) and public.ops_has_permission('ops.verify') or g.can_accounting and public.ops_has_permission('ops.work')))));
$$;
revoke all on function public.ops_can(uuid,text) from public,anon;
grant execute on function public.ops_can(uuid,text) to authenticated;
commit;
