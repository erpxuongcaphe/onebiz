-- Additive owner-only snapshot: no assignment changes. Hub and QC grants stay
-- separate and no staff access is inferred from a job title.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$begin
 if to_regprocedure('public._staff_profile_snapshot(uuid)') is null
  or to_regclass('public.ops_members') is null or to_regclass('public.ops_q_grants') is null
  or to_regprocedure('public.get_staff_operations_access(uuid)') is not null then
  raise exception 'STAFF_OPERATIONS_SNAPSHOT_BASELINE_CHANGED';end if;
end$$;
create function public.get_staff_operations_access(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare profile jsonb; tenant uuid; members jsonb; qc jsonb; value jsonb;
begin
 -- Reuse the existing owner, active profile, same-tenant and non-owner gate.
 profile:=public._staff_profile_snapshot(p_user_id);
 select p.tenant_id into tenant from public.profiles p where p.id=p_user_id;
 select coalesce(jsonb_agg(jsonb_build_object('branchId',m.branch_id,'branchName',b.name,'branchActive',coalesce(b.is_active,false),
   'role',m.member_role,'capabilities',to_jsonb(m.capabilities),'active',m.active) order by m.branch_id),'[]'::jsonb)
 into members from public.ops_members m join public.branches b on b.id=m.branch_id and b.tenant_id=m.tenant_id
 where m.tenant_id=tenant and m.user_id=p_user_id;
 select coalesce(jsonb_agg(jsonb_build_object('branchId',g.branch_id,'branchName',b.name,'branchActive',coalesce(b.is_active,false),
   'canAudit',g.can_audit,'canCorrect',g.can_correct,'canAccounting',g.can_accounting,'active',g.active) order by g.branch_id),'[]'::jsonb)
 into qc from public.ops_q_grants g join public.branches b on b.id=g.branch_id and b.tenant_id=g.tenant_id
 where g.tenant_id=tenant and g.user_id=p_user_id;
 value:=jsonb_build_object('version',1,'userId',p_user_id,'memberships',members,'qualityGrants',qc);
 return value||jsonb_build_object('fingerprint',md5(value::text));
end$$;
revoke all on function public.get_staff_operations_access(uuid) from public,anon;
grant execute on function public.get_staff_operations_access(uuid) to authenticated;
commit;
