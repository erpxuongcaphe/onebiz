-- ============================================================
-- 00280: Atomic managed-user profile and branch initialization
-- ============================================================
-- Definition only. Existing users and branch assignments are not changed.

create or replace function public.initialize_managed_user_atomic(
  p_target_user_id uuid,
  p_full_name text,
  p_email text,
  p_phone text,
  p_role_id uuid,
  p_branch_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_profile record;
  v_existing record;
  v_saved record;
  v_profile_exists boolean := false;
  v_name text := nullif(trim(coalesce(p_full_name, '')), '');
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  select p.id, p.tenant_id, p.role
    into v_actor_profile
    from public.profiles p
   where p.id = v_actor and coalesce(p.is_active, true);
  if not found then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if v_actor_profile.role <> 'owner'
     and not (
       public.user_has_permission(v_actor, 'system.create_user')
       or public.user_has_permission(v_actor, 'system.manage_users')
     ) then
    raise exception using errcode = '42501', message = 'CREATE_USER_PERMISSION_REQUIRED';
  end if;
  if p_target_user_id is null or not exists (
    select 1 from auth.users u where u.id = p_target_user_id
  ) then
    raise exception using errcode = '22023', message = 'AUTH_USER_NOT_FOUND';
  end if;
  if v_name is null or length(v_name) > 160 then
    raise exception using errcode = '22023', message = 'FULL_NAME_INVALID';
  end if;
  if length(coalesce(v_email, '')) > 254 or length(coalesce(v_phone, '')) > 32 then
    raise exception using errcode = '22023', message = 'CONTACT_INVALID';
  end if;
  if p_role_id is not null and not exists (
    select 1 from public.roles r
     where r.id = p_role_id and r.tenant_id = v_actor_profile.tenant_id
  ) then
    raise exception using errcode = '22023', message = 'ROLE_NOT_FOUND';
  end if;
  if p_branch_ids is null
     or cardinality(p_branch_ids) = 0
     or cardinality(p_branch_ids) <> (
       select count(distinct item.branch_id)::integer
         from unnest(p_branch_ids) as item(branch_id)
     )
     or cardinality(p_branch_ids) <> (
       select count(*)::integer
         from public.branches b
        where b.id = any(p_branch_ids)
          and b.tenant_id = v_actor_profile.tenant_id
          and coalesce(b.is_active, true)
     ) then
    raise exception using errcode = '22023', message = 'BRANCH_SCOPE_INVALID';
  end if;

  select p.* into v_existing
    from public.profiles p
   where p.id = p_target_user_id
   for update;
  v_profile_exists := found;
  if v_profile_exists and v_existing.tenant_id <> v_actor_profile.tenant_id then
    raise exception using errcode = '42501', message = 'CROSS_TENANT_TARGET_DENIED';
  end if;
  if v_profile_exists and v_existing.role = 'owner' then
    raise exception using errcode = '42501', message = 'OWNER_PROFILE_CANNOT_BE_INITIALIZED';
  end if;

  if not v_profile_exists then
    insert into public.profiles (
      id, tenant_id, role_id, role, full_name, email, phone,
      branch_id, is_active
    ) values (
      p_target_user_id, v_actor_profile.tenant_id, p_role_id, 'staff',
      v_name, v_email, v_phone, p_branch_ids[1], true
    ) returning * into v_saved;
  else
    update public.profiles p
       set role_id = p_role_id,
           role = 'staff',
           full_name = v_name,
           email = v_email,
           phone = v_phone,
           branch_id = p_branch_ids[1],
           is_active = true,
           updated_at = now()
     where p.id = p_target_user_id
       and p.tenant_id = v_actor_profile.tenant_id
    returning * into v_saved;
  end if;

  delete from public.user_branches ub where ub.user_id = p_target_user_id;
  insert into public.user_branches (user_id, branch_id, granted_by)
  select p_target_user_id, item.branch_id, v_actor
    from unnest(p_branch_ids) with ordinality item(branch_id, position)
   order by item.position;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_actor_profile.tenant_id, v_actor, 'create', 'user', p_target_user_id,
    case when not v_profile_exists then null else to_jsonb(v_existing) end,
    to_jsonb(v_saved) || jsonb_build_object('branch_ids', p_branch_ids, 'atomic', true)
  );
  return jsonb_build_object(
    'id', v_saved.id,
    'branch_ids', p_branch_ids,
    'primary_branch_id', v_saved.branch_id
  );
end;
$$;

revoke all on function public.initialize_managed_user_atomic(uuid, text, text, text, uuid, uuid[]) from public, anon;
grant execute on function public.initialize_managed_user_atomic(uuid, text, text, text, uuid, uuid[]) to authenticated;

select to_regprocedure('public.initialize_managed_user_atomic(uuid,text,text,text,uuid,uuid[])') is not null
  as initialize_managed_user_atomic_ok;
