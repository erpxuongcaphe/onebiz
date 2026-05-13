-- ============================================================
-- 00067: PIN POS per-user (Sprint B — CEO 12/05/2026)
--
-- Mục đích: cashier vào POS FnB bằng cách CHỌN ACCOUNT + NHẬP PIN 6 SỐ
-- thay vì đăng nhập email + password (tốn ~30-45 giây). Mỗi nhân viên có
-- 1 PIN riêng (per-user), không phải 1 PIN chung.
--
-- Khác với:
--   - supervisorPin (tenants.settings.sales) — 1 PIN chung — SẼ BỎ ở B.6
--   - OTP duyệt từ xa (manager_otp_codes) — TTL 2 phút, dùng 1 lần
--   - PIN POS (migration này) — pin per-user, dùng nhiều lần, để LOGIN
--
-- Approach Z (CEO chọn): mỗi user vẫn có row auth.users (Supabase Auth).
-- API route /api/auth/pos-pin-switch verify PIN → generate sign-in token
-- qua Supabase Admin → client setSession → RLS work bình thường với
-- auth.uid() của user thật.
-- ============================================================

create extension if not exists "pgcrypto";

-- ────────────────────────────────────────────────────────────────
-- 1. Thêm column PIN vào profiles
-- ────────────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists pos_pin_hash text,
  add column if not exists pos_pin_set_at timestamptz,
  add column if not exists pos_pin_set_by uuid references public.profiles(id) on delete set null,
  add column if not exists pos_pin_failed_attempts int not null default 0,
  add column if not exists pos_pin_locked_until timestamptz;

-- Index để query "user nào có PIN tại branch X" nhanh (cho dropdown POS)
create index if not exists idx_profiles_pos_pin_active
  on public.profiles(tenant_id, branch_id)
  where pos_pin_hash is not null and is_active = true;

-- ────────────────────────────────────────────────────────────────
-- 2. Helper hash function — bcrypt qua pgcrypto
-- ────────────────────────────────────────────────────────────────
create or replace function public.hash_pos_pin(p_pin text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select crypt(p_pin, gen_salt('bf', 10));  -- bcrypt cost 10
$$;

comment on function public.hash_pos_pin is
  'Hash PIN 6 số bằng bcrypt cost 10 (~100ms/hash). Salt random mỗi lần.';

-- ────────────────────────────────────────────────────────────────
-- 3. RPC set_user_pos_pin — owner/admin/manager đặt PIN cho cashier
-- ────────────────────────────────────────────────────────────────
create or replace function public.set_user_pos_pin(
  p_target_user_id uuid,
  p_pin text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_profile record;
  v_target_profile record;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED: please sign in before setting PIN';
  end if;

  -- Validate format PIN (6 chữ số)
  if p_pin is null or p_pin !~ '^[0-9]{6}$' then
    raise exception 'INVALID_PIN_FORMAT: PIN phải là 6 chữ số';
  end if;

  -- Check actor có quyền system.manage_users HOẶC role=owner
  select id, tenant_id, role
  into v_actor_profile
  from public.profiles
  where id = v_actor and is_active = true;

  if not found then
    raise exception 'USER_PROFILE_NOT_FOUND';
  end if;

  if v_actor_profile.role <> 'owner'
     and not public.user_has_permission(v_actor, 'system.manage_users') then
    raise exception 'PERMISSION_DENIED: cần quyền system.manage_users để đặt PIN POS';
  end if;

  -- Check target user cùng tenant
  select id, tenant_id, full_name, is_active
  into v_target_profile
  from public.profiles
  where id = p_target_user_id;

  if not found then
    raise exception 'TARGET_USER_NOT_FOUND: %', p_target_user_id;
  end if;

  if v_target_profile.tenant_id <> v_actor_profile.tenant_id then
    raise exception 'TENANT_MISMATCH: target user khác tenant';
  end if;

  -- Update PIN — reset failed_attempts + locked_until
  update public.profiles
  set pos_pin_hash = public.hash_pos_pin(p_pin),
      pos_pin_set_at = now(),
      pos_pin_set_by = v_actor,
      pos_pin_failed_attempts = 0,
      pos_pin_locked_until = null,
      updated_at = now()
  where id = p_target_user_id
    and tenant_id = v_actor_profile.tenant_id;

  -- Audit log — owner trace ai set PIN cho ai
  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_actor_profile.tenant_id, v_actor, 'set_pos_pin', 'user', p_target_user_id,
    jsonb_build_object(
      'target_user_id', p_target_user_id,
      'target_user_name', v_target_profile.full_name,
      'set_at', now()
    )
  );

  return jsonb_build_object(
    'success', true,
    'user_id', p_target_user_id,
    'user_name', v_target_profile.full_name
  );
end;
$$;

comment on function public.set_user_pos_pin is
  'Owner/admin/manager đặt PIN POS 6 số cho cashier. Audit log mọi lần set.';

grant execute on function public.set_user_pos_pin(uuid, text) to authenticated;

-- ────────────────────────────────────────────────────────────────
-- 4. RPC verify_pos_pin — verify PIN, return user info nếu match
-- ────────────────────────────────────────────────────────────────
-- LƯU Ý: RPC này verify đúng PIN nhưng KHÔNG ISSUE session. Server-side
-- API route mới (/api/auth/pos-pin-switch) sẽ gọi RPC này, sau đó dùng
-- Supabase Admin API để generate magiclink → swap session cho client.
-- ────────────────────────────────────────────────────────────────
create or replace function public.verify_pos_pin(
  p_user_id uuid,
  p_pin text,
  p_branch_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_profile record;
begin
  if p_pin is null or p_pin !~ '^[0-9]{6}$' then
    raise exception 'INVALID_PIN_FORMAT: PIN phải là 6 chữ số';
  end if;

  select id, tenant_id, branch_id, full_name, email, role, role_id,
         pos_pin_hash, pos_pin_failed_attempts, pos_pin_locked_until, is_active
  into v_profile
  from public.profiles
  where id = p_user_id;

  if not found then
    raise exception 'USER_NOT_FOUND: %', p_user_id;
  end if;

  if not v_profile.is_active then
    raise exception 'USER_INACTIVE: tài khoản đã bị khoá';
  end if;

  if v_profile.pos_pin_hash is null then
    raise exception 'PIN_NOT_SET: chưa đặt PIN POS cho user này';
  end if;

  -- Check lock period
  if v_profile.pos_pin_locked_until is not null
     and v_profile.pos_pin_locked_until > now() then
    raise exception 'PIN_LOCKED: bị khoá đến % (sai PIN quá nhiều lần)',
      v_profile.pos_pin_locked_until;
  end if;

  -- Verify PIN bằng crypt
  if v_profile.pos_pin_hash <> crypt(p_pin, v_profile.pos_pin_hash) then
    -- Sai → tăng counter, lock 15 phút nếu >= 10 lần
    update public.profiles
    set pos_pin_failed_attempts = pos_pin_failed_attempts + 1,
        pos_pin_locked_until = case
          when pos_pin_failed_attempts + 1 >= 10
          then now() + interval '15 minutes'
          else null
        end
    where id = p_user_id;

    raise exception 'INVALID_PIN: PIN không đúng (đã sai % lần)',
      v_profile.pos_pin_failed_attempts + 1;
  end if;

  -- Đúng → reset counter
  update public.profiles
  set pos_pin_failed_attempts = 0,
      pos_pin_locked_until = null
  where id = p_user_id;

  -- Audit log switch user (loss-prevention trace)
  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_profile.tenant_id, p_user_id, 'pos_pin_login', 'user', p_user_id,
    jsonb_build_object(
      'branch_id', p_branch_id,
      'at', now()
    )
  );

  return jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'full_name', v_profile.full_name,
    'email', v_profile.email,
    'tenant_id', v_profile.tenant_id,
    'role', v_profile.role,
    'role_id', v_profile.role_id
  );
end;
$$;

comment on function public.verify_pos_pin is
  'Verify PIN POS 6 số. Sai 10 lần → khoá 15 phút. Đúng → audit pos_pin_login. KHÔNG issue session (API route handle).';

grant execute on function public.verify_pos_pin(uuid, text, uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────
-- 5. RPC list_pos_pin_users — list user có PIN tại branch (cho dropdown POS)
-- ────────────────────────────────────────────────────────────────
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
    (p.pos_pin_hash is not null) as has_pin,
    (p.pos_pin_locked_until is not null and p.pos_pin_locked_until > now()) as is_locked
  from public.profiles p
  left join public.roles r on r.id = p.role_id
  where p.tenant_id = public.get_user_tenant_id()
    and p.is_active = true
    and p.pos_pin_hash is not null
    and (
      p.branch_id = p_branch_id
      or exists (
        select 1 from public.user_branches ub
        where ub.user_id = p.id and ub.branch_id = p_branch_id
      )
    )
  order by p.full_name;
$$;

comment on function public.list_pos_pin_users is
  'List user đã đặt PIN POS tại 1 chi nhánh — cho dropdown POS FnB chọn account switch.';

grant execute on function public.list_pos_pin_users(uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────
-- 6. RPC remove_user_pos_pin — gỡ PIN khi nhân viên nghỉ việc
-- ────────────────────────────────────────────────────────────────
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

grant execute on function public.remove_user_pos_pin(uuid) to authenticated;

notify pgrst, 'reload schema';
