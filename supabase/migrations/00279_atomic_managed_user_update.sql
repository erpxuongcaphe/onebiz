-- ============================================================
-- 00279: Atomic managed-user profile and branch access update
-- ============================================================
-- Definition only. Existing users and branch assignments are not changed.

create or replace function public.update_managed_user_atomic(
  p_target_user_id uuid,
  p_profile_patch jsonb default '{}'::jsonb,
  p_branch_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_profile record;
  v_target record;
  v_saved record;
  v_role_id uuid;
  v_old_branches uuid[];
  v_new_branches uuid[];
  v_full_name text;
  v_phone text;
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
     and not public.user_has_permission(v_actor, 'system.manage_users') then
    raise exception using errcode = '42501', message = 'MANAGE_USERS_PERMISSION_REQUIRED';
  end if;
  if p_target_user_id is null then
    raise exception using errcode = '22023', message = 'TARGET_USER_REQUIRED';
  end if;
  if p_profile_patch is null or jsonb_typeof(p_profile_patch) <> 'object' or exists (
    select 1 from jsonb_object_keys(p_profile_patch) as item(key)
    where item.key not in ('full_name', 'phone', 'role_id', 'is_active')
  ) then
    raise exception using errcode = '22023', message = 'PROFILE_PATCH_INVALID';
  end if;

  select p.* into v_target
    from public.profiles p
   where p.id = p_target_user_id
     and p.tenant_id = v_actor_profile.tenant_id
   for update;
  if not found then
    raise exception using errcode = '22023', message = 'TARGET_USER_NOT_FOUND';
  end if;
  if v_target.role = 'owner' and v_actor_profile.role <> 'owner' then
    raise exception using errcode = '42501', message = 'ONLY_OWNER_CAN_UPDATE_OWNER';
  end if;
  if v_target.role = 'owner' and p_profile_patch ? 'role_id' then
    raise exception using errcode = '22023', message = 'OWNER_ROLE_CANNOT_CHANGE';
  end if;
  if p_target_user_id = v_actor
     and p_profile_patch ? 'is_active'
     and not (p_profile_patch->>'is_active')::boolean then
    raise exception using errcode = '22023', message = 'CANNOT_DEACTIVATE_SELF';
  end if;

  if p_profile_patch ? 'full_name' then
    v_full_name := nullif(trim(coalesce(p_profile_patch->>'full_name', '')), '');
    if v_full_name is null or length(v_full_name) > 160 then
      raise exception using errcode = '22023', message = 'FULL_NAME_INVALID';
    end if;
  end if;
  if p_profile_patch ? 'phone' then
    v_phone := nullif(trim(coalesce(p_profile_patch->>'phone', '')), '');
    if length(coalesce(v_phone, '')) > 32 then
      raise exception using errcode = '22023', message = 'PHONE_INVALID';
    end if;
  end if;
  if p_profile_patch ? 'role_id' then
    v_role_id := nullif(p_profile_patch->>'role_id', '')::uuid;
    if v_role_id is not null and not exists (
      select 1 from public.roles r
       where r.id = v_role_id and r.tenant_id = v_actor_profile.tenant_id
    ) then
      raise exception using errcode = '22023', message = 'ROLE_NOT_FOUND';
    end if;
  end if;
  if p_profile_patch ? 'is_active'
     and jsonb_typeof(p_profile_patch->'is_active') <> 'boolean' then
    raise exception using errcode = '22023', message = 'IS_ACTIVE_INVALID';
  end if;

  select coalesce(array_agg(ub.branch_id order by ub.branch_id), '{}'::uuid[])
    into v_old_branches
    from public.user_branches ub
   where ub.user_id = p_target_user_id;

  if p_branch_ids is not null then
    if cardinality(p_branch_ids) = 0
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
  end if;

  update public.profiles p
     set full_name = case when p_profile_patch ? 'full_name' then v_full_name else p.full_name end,
         phone = case when p_profile_patch ? 'phone' then v_phone else p.phone end,
         role_id = case when p_profile_patch ? 'role_id' then v_role_id else p.role_id end,
         is_active = case when p_profile_patch ? 'is_active' then (p_profile_patch->>'is_active')::boolean else p.is_active end,
         branch_id = case when p_branch_ids is not null then p_branch_ids[1] else p.branch_id end,
         updated_at = now()
   where p.id = p_target_user_id and p.tenant_id = v_actor_profile.tenant_id
  returning * into v_saved;

  if p_branch_ids is not null then
    delete from public.user_branches ub where ub.user_id = p_target_user_id;
    insert into public.user_branches (user_id, branch_id, granted_by)
    select p_target_user_id, item.branch_id, v_actor
      from unnest(p_branch_ids) with ordinality item(branch_id, position)
     order by item.position;
    v_new_branches := p_branch_ids;
  else
    v_new_branches := v_old_branches;
  end if;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_actor_profile.tenant_id, v_actor, 'update', 'user', p_target_user_id,
    to_jsonb(v_target) || jsonb_build_object('branch_ids', v_old_branches),
    to_jsonb(v_saved) || jsonb_build_object('branch_ids', v_new_branches, 'atomic', true)
  );
  return jsonb_build_object(
    'id', v_saved.id,
    'branch_ids', v_new_branches,
    'primary_branch_id', v_saved.branch_id
  );
end;
$$;

revoke all on function public.update_managed_user_atomic(uuid, jsonb, uuid[]) from public, anon;
grant execute on function public.update_managed_user_atomic(uuid, jsonb, uuid[]) to authenticated;

select to_regprocedure('public.update_managed_user_atomic(uuid,jsonb,uuid[])') is not null
  as update_managed_user_atomic_ok;
