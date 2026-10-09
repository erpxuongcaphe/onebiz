-- Preserve the existing tenant/branch/permission checks. Return a failed result
-- after updating the retry counter, so the transaction commits the lockout.
create or replace function public.verify_pos_pin(
  p_user_id uuid,
  p_pin text,
  -- Giu default cu de CREATE OR REPLACE khong pha API bundle dang mo.
  -- Than ham van chan NULL, nen branch luon bat buoc ve mat nghiep vu.
  p_branch_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_profile record;
  v_target_profile record;
  v_source_shift_id uuid;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if p_user_id is null or p_branch_id is null then
    raise exception using errcode = '22023', message = 'PIN_HANDOVER_BRANCH_REQUIRED';
  end if;
  if p_pin is null or p_pin !~ '^[0-9]{6}$' then
    raise exception using errcode = '22023', message = 'INVALID_PIN_FORMAT';
  end if;

  select p.id, p.tenant_id, p.full_name
    into v_actor_profile
    from public.profiles p
   where p.id = v_actor
     and p.is_active = true;

  if not found then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if not exists (
    select 1
      from public.branches b
     where b.id = p_branch_id
       and b.tenant_id = v_actor_profile.tenant_id
       and b.is_active = true
  ) or not public.user_has_branch_access(v_actor, p_branch_id) then
    raise exception using errcode = '42501', message = 'PIN_HANDOVER_BRANCH_DENIED';
  end if;
  if not public.user_has_permission(v_actor, 'pos_fnb.send_kitchen') then
    raise exception using errcode = '42501', message = 'PIN_HANDOVER_PERMISSION_DENIED';
  end if;
  if p_user_id = v_actor then
    raise exception using errcode = '42501', message = 'PIN_HANDOVER_TARGET_DENIED';
  end if;

  -- Khoa dong B trong luc kiem PIN va cap nhat failed_attempts.
  select
    p.id, p.tenant_id, p.full_name, p.email, p.role, p.role_id,
    p.pos_pin_hash, p.pos_pin_failed_attempts, p.pos_pin_locked_until, p.is_active
    into v_target_profile
    from public.profiles p
   where p.id = p_user_id
     and p.tenant_id = v_actor_profile.tenant_id
   for update;

  if not found
     or not v_target_profile.is_active
     or not public.user_has_branch_access(v_target_profile.id, p_branch_id)
     or not public.user_has_permission(v_target_profile.id, 'pos_fnb.send_kitchen') then
    raise exception using errcode = '42501', message = 'PIN_HANDOVER_TARGET_DENIED';
  end if;
  if v_target_profile.pos_pin_hash is null then
    raise exception using errcode = '22023', message = 'PIN_NOT_SET';
  end if;
  if v_target_profile.pos_pin_locked_until is not null
     and v_target_profile.pos_pin_locked_until > now() then
    raise exception using errcode = '42301', message = 'PIN_LOCKED';
  end if;

  if v_target_profile.pos_pin_hash <> crypt(p_pin, v_target_profile.pos_pin_hash) then
    update public.profiles
       set pos_pin_failed_attempts = pos_pin_failed_attempts + 1,
           pos_pin_locked_until = case
             when pos_pin_failed_attempts + 1 >= 10 then now() + interval '15 minutes'
             else null
           end
     where id = v_target_profile.id
       and tenant_id = v_actor_profile.tenant_id;
    return jsonb_build_object('success', false, 'code', 'INVALID_PIN', 'attempts_remaining', greatest(0,10-v_target_profile.pos_pin_failed_attempts-1));
  end if;

  update public.profiles
     set pos_pin_failed_attempts = 0,
         pos_pin_locked_until = null
   where id = v_target_profile.id
     and tenant_id = v_actor_profile.tenant_id;

  select s.id
    into v_source_shift_id
    from public.shifts s
   where s.tenant_id = v_actor_profile.tenant_id
     and s.branch_id = p_branch_id
     and s.cashier_id = v_actor
     and s.status = 'open'
   order by s.opened_at desc
   limit 1;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_actor_profile.tenant_id,
    v_actor,
    'pos_pin_handover',
    'fnb_pos_handover',
    v_target_profile.id,
    jsonb_build_object(
      'from_user_id', v_actor,
      'from_user_name', v_actor_profile.full_name,
      'source_shift_id', v_source_shift_id
    ),
    jsonb_build_object(
      'to_user_id', v_target_profile.id,
      'to_user_name', v_target_profile.full_name,
      'branch_id', p_branch_id,
      'at', now()
    )
  );

  return jsonb_build_object(
    'success', true,
    'user_id', v_target_profile.id,
    'full_name', v_target_profile.full_name,
    'email', v_target_profile.email,
    'tenant_id', v_target_profile.tenant_id,
    'role', v_target_profile.role,
    'role_id', v_target_profile.role_id
  );
end;
$$;
revoke all on function public.verify_pos_pin(uuid,text,uuid) from public,anon;
grant execute on function public.verify_pos_pin(uuid,text,uuid) to authenticated;
notify pgrst, 'reload schema';
