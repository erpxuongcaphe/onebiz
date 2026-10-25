-- Read-only bootstrap: one network request, same effective grants and branch rules.
-- No user argument, no writes, no authorization cache, no business RPC changes.
begin;
set local lock_timeout = '2s';
create or replace function public.get_my_auth_bootstrap()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_perms text[] := array[]::text[];
  v_scope uuid[] := array[]::uuid[];
  v_all boolean := false;
  v_tenant jsonb;
  v_branches jsonb;
  v_profile_json jsonb;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select * into v_profile from public.profiles where id = v_actor;
  if found then
    -- Explicit projection: never expose PIN hashes or other private profile columns.
    v_profile_json := jsonb_build_object('id',v_profile.id,'tenant_id',v_profile.tenant_id,
      'branch_id',v_profile.branch_id,'role_id',v_profile.role_id,'full_name',v_profile.full_name,
      'email',v_profile.email,'phone',v_profile.phone,'role',v_profile.role,
      'is_active',v_profile.is_active,'created_at',v_profile.created_at);
  end if;
  if v_profile.id is null or not coalesce(v_profile.is_active,false) then
    return jsonb_build_object('version',1,'profile',v_profile_json,'tenant',null,
      'branches','[]'::jsonb,'permissions','[]'::jsonb,'scope','[]'::jsonb);
  end if;
  if v_profile.role = 'owner' then v_perms := array['*'];
  else
    select coalesce(array_agg(p.permission_code),array[]::text[]) into v_perms
      from public.get_user_effective_permissions(v_actor) p;
  end if;
  v_all := v_profile.role = 'owner' or '*' = any(v_perms) or 'reports.view_all_branches' = any(v_perms);
  select coalesce(array_agg(s.branch_id),array[]::uuid[]) into v_scope
    from public.get_user_accessible_branches(v_actor) s;
  select to_jsonb(t) into v_tenant from public.tenants t where t.id = v_profile.tenant_id;
  if v_tenant is null then raise exception 'AUTH_TENANT_UNAVAILABLE' using errcode='42501'; end if;
  select coalesce(jsonb_agg(to_jsonb(b) order by b.is_default desc,b.id),'[]'::jsonb) into v_branches
    from public.branches b where b.tenant_id = v_profile.tenant_id and b.is_active
      and (v_all or b.id = any(v_scope));
  return jsonb_build_object('version',1,'profile',v_profile_json,'tenant',v_tenant,
    'branches',v_branches,'permissions',to_jsonb(v_perms),
    'scope',coalesce((select jsonb_agg(jsonb_build_object('branch_id',s)) from unnest(v_scope) s),'[]'::jsonb));
end;
$$;
revoke all on function public.get_my_auth_bootstrap() from public, anon;
grant execute on function public.get_my_auth_bootstrap() to authenticated;
comment on function public.get_my_auth_bootstrap() is 'Read-only current-user bootstrap. Fresh grants and assigned branch scope; no client-supplied identity.';
notify pgrst, 'reload schema';
commit;
