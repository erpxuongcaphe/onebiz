create or replace function public.remove_user_pos_pin(
  p_target_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_profile record;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select id, tenant_id, role into v_actor_profile
  from public.profiles
  where id = v_actor and is_active = true;

  if not found then
    raise exception 'USER_PROFILE_NOT_FOUND';
  end if;

  if v_actor_profile.role <> 'owner'
     and not public.user_has_permission(v_actor, 'system.manage_users') then
    raise exception 'PERMISSION_DENIED';
  end if;

  update public.profiles
  set pos_pin_hash = null,
      pos_pin_set_at = null,
      pos_pin_set_by = null,
      pos_pin_failed_attempts = 0,
      pos_pin_locked_until = null,
      updated_at = now()
  where id = p_target_user_id
    and tenant_id = v_actor_profile.tenant_id;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_actor_profile.tenant_id, v_actor, 'remove_pos_pin', 'user', p_target_user_id,
    jsonb_build_object('removed_at', now())
  );

  return jsonb_build_object('success', true, 'user_id', p_target_user_id);
end;
$$;