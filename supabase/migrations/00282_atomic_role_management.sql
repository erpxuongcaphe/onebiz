-- ============================================================
-- 00282: Atomic role and permission management
-- ============================================================
-- Definition only. Existing roles and permissions are not changed.

create or replace function public.save_role_atomic(
  p_role_id uuid,
  p_payload jsonb default '{}'::jsonb,
  p_permission_codes text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_old record;
  v_saved record;
  v_name text;
  v_old_permissions text[];
  v_new_permissions text[];
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  select p.tenant_id into v_tenant_id
    from public.profiles p
   where p.id = v_actor and coalesce(p.is_active, true);
  if v_tenant_id is null then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if not public.user_has_permission(v_actor, 'system.manage_roles') then
    raise exception using errcode = '42501', message = 'MANAGE_ROLES_PERMISSION_REQUIRED';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or exists (
    select 1 from jsonb_object_keys(p_payload) as item(key)
    where item.key not in ('name', 'description', 'color')
  ) then
    raise exception using errcode = '22023', message = 'ROLE_PAYLOAD_INVALID';
  end if;
  if p_role_id is null or p_payload ? 'name' then
    v_name := nullif(trim(coalesce(p_payload->>'name', '')), '');
    if v_name is null or length(v_name) > 120 then
      raise exception using errcode = '22023', message = 'ROLE_NAME_INVALID';
    end if;
  end if;
  if length(coalesce(p_payload->>'description', '')) > 500
     or length(coalesce(p_payload->>'color', '')) > 80 then
    raise exception using errcode = '22023', message = 'ROLE_FIELD_TOO_LONG';
  end if;
  if p_permission_codes is not null and (
    cardinality(p_permission_codes) > 300
    or cardinality(p_permission_codes) <> (
      select count(distinct item.code)::integer
        from unnest(p_permission_codes) as item(code)
    )
    or exists (
      select 1 from unnest(p_permission_codes) as item(code)
      where length(item.code) not between 3 and 120
         or item.code !~ '^[a-z0-9_]+([.][a-z0-9_]+)+$'
    )
  ) then
    raise exception using errcode = '22023', message = 'PERMISSION_CODES_INVALID';
  end if;

  if p_role_id is null then
    insert into public.roles (
      tenant_id, name, description, color, is_system
    ) values (
      v_tenant_id, v_name,
      nullif(trim(coalesce(p_payload->>'description', '')), ''),
      coalesce(nullif(trim(coalesce(p_payload->>'color', '')), ''), 'bg-primary'),
      false
    ) returning * into v_saved;
    v_old_permissions := '{}'::text[];
  else
    select r.* into v_old
      from public.roles r
     where r.id = p_role_id and r.tenant_id = v_tenant_id
     for update;
    if not found then
      raise exception using errcode = '22023', message = 'ROLE_NOT_FOUND';
    end if;
    if v_old.is_system and exists (select 1 from jsonb_object_keys(p_payload)) then
      raise exception using errcode = '22023', message = 'SYSTEM_ROLE_METADATA_LOCKED';
    end if;
    update public.roles r
       set name = case when p_payload ? 'name' then v_name else r.name end,
           description = case when p_payload ? 'description' then nullif(trim(coalesce(p_payload->>'description', '')), '') else r.description end,
           color = case when p_payload ? 'color' then coalesce(nullif(trim(coalesce(p_payload->>'color', '')), ''), 'bg-primary') else r.color end,
           updated_at = now()
     where r.id = p_role_id and r.tenant_id = v_tenant_id
    returning * into v_saved;
    select coalesce(array_agg(rp.permission_code order by rp.permission_code), '{}'::text[])
      into v_old_permissions
      from public.role_permissions rp where rp.role_id = p_role_id;
  end if;

  if p_permission_codes is not null then
    delete from public.role_permissions rp where rp.role_id = v_saved.id;
    insert into public.role_permissions (role_id, permission_code)
    select v_saved.id, item.code
      from unnest(p_permission_codes) as item(code)
     order by item.code;
    v_new_permissions := p_permission_codes;
  else
    v_new_permissions := v_old_permissions;
  end if;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_tenant_id, v_actor,
    case when p_role_id is null then 'create'
         when p_permission_codes is not null then 'permissions_update'
         else 'update' end,
    'role', v_saved.id,
    case when p_role_id is null then null
         else to_jsonb(v_old) || jsonb_build_object('permissions', v_old_permissions) end,
    to_jsonb(v_saved) || jsonb_build_object('permissions', v_new_permissions, 'atomic', true)
  );
  return to_jsonb(v_saved) || jsonb_build_object('permissions', v_new_permissions);
end;
$$;

create or replace function public.delete_role_atomic(p_role_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_role record;
  v_permissions text[];
  v_member_count integer;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  select p.tenant_id into v_tenant_id
    from public.profiles p
   where p.id = v_actor and coalesce(p.is_active, true);
  if v_tenant_id is null or not public.user_has_permission(v_actor, 'system.manage_roles') then
    raise exception using errcode = '42501', message = 'MANAGE_ROLES_PERMISSION_REQUIRED';
  end if;
  select r.* into v_role
    from public.roles r
   where r.id = p_role_id and r.tenant_id = v_tenant_id
   for update;
  if not found then
    raise exception using errcode = '22023', message = 'ROLE_NOT_FOUND';
  end if;
  if v_role.is_system then
    raise exception using errcode = '22023', message = 'SYSTEM_ROLE_CANNOT_DELETE';
  end if;
  select coalesce(array_agg(rp.permission_code order by rp.permission_code), '{}'::text[])
    into v_permissions from public.role_permissions rp where rp.role_id = p_role_id;
  select count(*)::integer into v_member_count
    from public.profiles p
   where p.tenant_id = v_tenant_id and p.role_id = p_role_id;
  update public.profiles p
     set role_id = null, updated_at = now()
   where p.tenant_id = v_tenant_id and p.role_id = p_role_id;
  delete from public.roles r where r.id = p_role_id and r.tenant_id = v_tenant_id;
  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_tenant_id, v_actor, 'delete', 'role', p_role_id,
    to_jsonb(v_role) || jsonb_build_object(
      'permissions', v_permissions, 'unassigned_members', v_member_count
    ),
    jsonb_build_object('deleted', true, 'atomic', true)
  );
  return jsonb_build_object('id', p_role_id, 'unassigned_members', v_member_count);
end;
$$;

revoke all on function public.save_role_atomic(uuid, jsonb, text[]) from public, anon;
grant execute on function public.save_role_atomic(uuid, jsonb, text[]) to authenticated;
revoke all on function public.delete_role_atomic(uuid) from public, anon;
grant execute on function public.delete_role_atomic(uuid) to authenticated;

select
  to_regprocedure('public.save_role_atomic(uuid,jsonb,text[])') is not null as save_role_atomic_ok,
  to_regprocedure('public.delete_role_atomic(uuid)') is not null as delete_role_atomic_ok;
