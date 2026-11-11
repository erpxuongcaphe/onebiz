-- Add organization labels only AFTER the existing server scope decision.
-- No grants, assignments or permission decision rules are changed.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
create or replace function public.get_managed_accounts() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor public.profiles; doc jsonb;
begin
 select * into actor from public.profiles where id=auth.uid() and is_active;
 if actor.id is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 select document into doc from public.account_hierarchy_config where tenant_id=actor.tenant_id;
 return coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'fullName',p.full_name,'email',coalesce(p.email,''),
  'phone',p.phone,'role',p.role,'roleId',p.role_id,'roleName',r.name,'branchId',p.branch_id,
  'branchIds',coalesce((select jsonb_agg(b.branch_id) from (select branch_id from public.user_branches where user_id=p.id union select p.branch_id where p.branch_id is not null) b),'[]'),
  'departmentIds',coalesce((select jsonb_agg(distinct aa->>'departmentId') from jsonb_array_elements(coalesce(doc->'assignments','[]')) aa where aa->>'userId'=p.id::text and aa->>'departmentId' is not null),'[]'),
  'positionIds',coalesce((select jsonb_agg(distinct aa->>'positionId') from jsonb_array_elements(coalesce(doc->'assignments','[]')) aa where aa->>'userId'=p.id::text),'[]'),
  'isActive',p.is_active,'createdAt',p.created_at) order by p.created_at)
  from public.profiles p left join public.roles r on r.id=p.role_id and r.tenant_id=p.tenant_id
  where p.tenant_id=actor.tenant_id and (public._account_decision(actor.id,p.id,'edit')='ALLOWED'
   or public._account_decision(actor.id,p.id,'password')='ALLOWED')),'[]');
end $$;
revoke all on function public.get_managed_accounts() from public,anon;
grant execute on function public.get_managed_accounts() to authenticated;
commit;
