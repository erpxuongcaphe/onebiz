-- Older account editors must not silently leave Hub/QC access behind.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$begin
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.update_managed_user_atomic(uuid,jsonb,uuid[])')
   and prosecdef and md5(replace(prosrc,chr(13),''))='940418734bd7a51149126389993a4ef7')
   or to_regprocedure('public.update_managed_user_before_staff_ops_guard(uuid,jsonb,uuid[])') is not null
 then raise exception 'STAFF_OPS_LEGACY_BASELINE_CHANGED'; end if;
end$$;
alter function public.update_managed_user_atomic(uuid,jsonb,uuid[]) rename to update_managed_user_before_staff_ops_guard;
revoke all on function public.update_managed_user_before_staff_ops_guard(uuid,jsonb,uuid[]) from public,anon,authenticated;
create function public.update_managed_user_atomic(p_target_user_id uuid,p_profile_patch jsonb default '{}'::jsonb,p_branch_ids uuid[] default null)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='3s' as $$
declare tenant uuid; affected uuid[]; branch uuid; old_branches uuid[]; result jsonb;
begin
 if p_branch_ids is not null then
  select p.tenant_id into tenant from public.profiles p where p.id=auth.uid() and coalesce(p.is_active,false);
  select coalesce(array_agg(id order by id),'{}'::uuid[]) into affected from (
   select m.branch_id id from public.ops_members m where m.tenant_id=tenant and m.user_id=p_target_user_id
   union select q.branch_id from public.ops_q_grants q where q.tenant_id=tenant and q.user_id=p_target_user_id
  ) x;
  foreach branch in array affected loop perform pg_advisory_xact_lock(hashtextextended(tenant::text||branch::text,0));end loop;
  lock table public.ops_members,public.ops_q_grants in share row exclusive mode;
  select coalesce(array_agg(id),'{}'::uuid[]) into old_branches from (
   select ub.branch_id id from public.user_branches ub where ub.user_id=p_target_user_id
   union select p.branch_id from public.profiles p where p.id=p_target_user_id and p.tenant_id=tenant and p.branch_id is not null
  ) x;
 end if;
 -- Perform existing authorization first; any later error rolls this write back.
 result:=public.update_managed_user_before_staff_ops_guard(p_target_user_id,p_profile_patch,p_branch_ids);
 if p_branch_ids is not null and (exists(select 1 from public.ops_members m where m.tenant_id=tenant and m.user_id=p_target_user_id and m.active and m.branch_id=any(old_branches) and not m.branch_id=any(p_branch_ids))
  or exists(select 1 from public.ops_q_grants q where q.tenant_id=tenant and q.user_id=p_target_user_id and q.active and q.branch_id=any(old_branches) and not q.branch_id=any(p_branch_ids))) then
  raise exception 'STAFF_OPS_USE_UNIFIED_EDITOR' using errcode='22023';
 end if;
 return result;
end$$;
revoke all on function public.update_managed_user_atomic(uuid,jsonb,uuid[]) from public,anon;
grant execute on function public.update_managed_user_atomic(uuid,jsonb,uuid[]) to authenticated;
commit;
