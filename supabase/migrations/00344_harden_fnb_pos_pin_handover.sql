-- ============================================================
-- 00344: Harden POS FnB PIN handover
--
-- Giỏ FnB van theo chi nhanh de thu ngan tiep nhan phuc vu tiep.
-- Migration nay chi khoa quyen doi PIN va sua nhat ky ban giao:
--   - A va B phai cung tenant, duoc vao dung chi nhanh, co quyen FnB.
--   - PIN duoc kiem trong khoa dong de dem sai/lock khong bi dua.
--   - Audit ghi A (nguoi giao), B (nguoi nhan), chi nhanh va ca A dang mo.
-- Khong chuyen chu ca, khong chuyen tien quy, khong sua gio hay don hang.
-- ============================================================

begin;

do $$
declare
  v_oid oid;
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'verify_pos_pin') <> 1
     or (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'list_pos_pin_users') <> 1 then
    raise exception using errcode = 'P0001', message = 'FNB_PIN_HANDOVER_OVERLOAD_COUNT_CHANGED';
  end if;

  foreach v_oid in array array[
    to_regprocedure('public.verify_pos_pin(uuid,text,uuid)'),
    to_regprocedure('public.list_pos_pin_users(uuid)'),
    to_regprocedure('public.user_has_branch_access(uuid,uuid)'),
    to_regprocedure('public.user_has_permission(uuid,text)')
  ] loop
    if v_oid is null then
      raise exception using errcode = 'P0001', message = 'FNB_PIN_HANDOVER_PREREQUISITE_MISSING';
    end if;
  end loop;

  if md5(pg_get_functiondef(to_regprocedure('public.verify_pos_pin(uuid,text,uuid)')))
       <> '1f1bb9a2668e66bc105452239116f1bc'
    or md5(pg_get_functiondef(to_regprocedure('public.list_pos_pin_users(uuid)')))
       <> '3473e36536c078fdd3de0fbf39b585de'
    or md5(pg_get_functiondef(to_regprocedure('public.user_has_branch_access(uuid,uuid)')))
       <> '48591a2a60e567be3b04610315ed4fad'
    or md5(pg_get_functiondef(to_regprocedure('public.user_has_permission(uuid,text)')))
       <> 'e6cf2d32775b7eef890a2278f29261d5' then
    raise exception using errcode = 'P0001', message = 'FNB_PIN_HANDOVER_FINGERPRINT_CHANGED';
  end if;

  if exists (
    select 1
    from pg_proc p
    where p.oid in (
      to_regprocedure('public.verify_pos_pin(uuid,text,uuid)'),
      to_regprocedure('public.list_pos_pin_users(uuid)'),
      to_regprocedure('public.user_has_branch_access(uuid,uuid)'),
      to_regprocedure('public.user_has_permission(uuid,text)')
    )
      and (not p.prosecdef or pg_get_userbyid(p.proowner) <> 'postgres')
  ) then
    raise exception using errcode = 'P0001', message = 'FNB_PIN_HANDOVER_FUNCTION_SECURITY_CHANGED';
  end if;
end;
$$;

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
    raise exception using errcode = 'P0001', message = 'INVALID_PIN';
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

create or replace function public.list_pos_pin_users(p_branch_id uuid)
returns table (
  id uuid,
  full_name text,
  role text,
  role_name text,
  has_pin boolean,
  is_locked boolean
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    p.id,
    p.full_name,
    p.role,
    r.name as role_name,
    true as has_pin,
    (p.pos_pin_locked_until is not null and p.pos_pin_locked_until > now()) as is_locked
  from public.profiles p
  left join public.roles r on r.id = p.role_id
  where p_branch_id is not null
    and auth.uid() is not null
    and public.user_has_branch_access(auth.uid(), p_branch_id)
    and public.user_has_permission(auth.uid(), 'pos_fnb.send_kitchen')
    and p.tenant_id = public.get_user_tenant_id()
    and p.is_active = true
    and p.pos_pin_hash is not null
    and public.user_has_branch_access(p.id, p_branch_id)
    and public.user_has_permission(p.id, 'pos_fnb.send_kitchen')
  order by p.full_name;
$$;

comment on function public.verify_pos_pin(uuid, text, uuid) is
  '00344: Xac nhan PIN ban giao quay FnB. A/B cung tenant, dung chi nhanh, co quyen FnB; audit ghi ca nguoi giao va nguoi nhan. Khong chuyen chu ca hay tien quy.';
comment on function public.list_pos_pin_users(uuid) is
  '00344: Chi liet ke nhan vien co PIN, quyen FnB va duoc vao chi nhanh hien tai.';

revoke all on function public.verify_pos_pin(uuid, text, uuid) from public, anon;
revoke all on function public.list_pos_pin_users(uuid) from public, anon;
grant execute on function public.verify_pos_pin(uuid, text, uuid) to authenticated;
grant execute on function public.list_pos_pin_users(uuid) to authenticated;

do $$
declare
  v_verify text := pg_get_functiondef(to_regprocedure('public.verify_pos_pin(uuid,text,uuid)'));
  v_list text := pg_get_functiondef(to_regprocedure('public.list_pos_pin_users(uuid)'));
begin
  if position('auth.uid()' in v_verify) = 0
     or position('for update' in lower(v_verify)) = 0
     or position('pos_fnb.send_kitchen' in v_verify) = 0
     or position('pos_pin_handover' in v_verify) = 0
     or position('auth.uid()' in v_list) = 0
     or position('pos_fnb.send_kitchen' in v_list) = 0
     or has_function_privilege('anon', to_regprocedure('public.verify_pos_pin(uuid,text,uuid)'), 'execute')
     or has_function_privilege('anon', to_regprocedure('public.list_pos_pin_users(uuid)'), 'execute')
     or not has_function_privilege('authenticated', to_regprocedure('public.verify_pos_pin(uuid,text,uuid)'), 'execute')
     or not has_function_privilege('authenticated', to_regprocedure('public.list_pos_pin_users(uuid)'), 'execute') then
    raise exception using errcode = 'P0001', message = 'FNB_PIN_HANDOVER_POSTFLIGHT_FAILED';
  end if;
end;
$$;

commit;
notify pgrst, 'reload schema';
