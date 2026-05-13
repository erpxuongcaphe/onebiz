-- ============================================================
-- 00071: Nhân viên tự đổi PIN POS của mình (CEO 13/05/2026)
--
-- Trước migration này:
--   - Chỉ owner/admin (system.manage_users) mới đặt PIN qua RPC
--     set_user_pos_pin → owner biết PIN của tất cả nhân viên → KHÔNG OK
--     (PIN cá nhân phải bảo mật)
--
-- Sau migration:
--   - Owner/admin VẪN reset PIN được khi NV quên (set_user_pos_pin giữ nguyên)
--   - Nhân viên TỰ set/đổi PIN qua RPC mới: change_my_pos_pin
--     • Lần đầu chưa có PIN → cho set không cần verify old_pin
--     • Đã có PIN → require old_pin để xác thực owner thật của session
--
-- Logic verify old_pin:
--   Quan trọng — nếu không verify, ai mượn máy POS đang login đều
--   overwrite được PIN → kẻ xấu có thể chiếm account.
-- ============================================================

create or replace function public.change_my_pos_pin(
  p_old_pin text,    -- null khi user chưa từng set PIN (lần đầu)
  p_new_pin text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_profile record;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED: vui lòng đăng nhập trước';
  end if;

  -- Validate format PIN mới (6 chữ số)
  if p_new_pin is null or p_new_pin !~ '^[0-9]{6}$' then
    raise exception 'INVALID_PIN_FORMAT: PIN mới phải gồm đúng 6 chữ số';
  end if;

  -- Load profile của user hiện tại
  select id, tenant_id, full_name, pos_pin_hash, is_active
  into v_profile
  from public.profiles
  where id = v_actor;

  if not found then
    raise exception 'USER_PROFILE_NOT_FOUND';
  end if;

  if not v_profile.is_active then
    raise exception 'USER_INACTIVE: tài khoản đã bị khoá';
  end if;

  -- Nếu user đã có PIN cũ → bắt buộc verify để chống session-takeover
  if v_profile.pos_pin_hash is not null then
    if p_old_pin is null or p_old_pin !~ '^[0-9]{6}$' then
      raise exception 'OLD_PIN_REQUIRED: cần nhập PIN cũ để xác thực';
    end if;
    if v_profile.pos_pin_hash <> crypt(p_old_pin, v_profile.pos_pin_hash) then
      raise exception 'INVALID_OLD_PIN: PIN cũ không đúng';
    end if;
    -- PIN mới không được trùng PIN cũ
    if v_profile.pos_pin_hash = crypt(p_new_pin, v_profile.pos_pin_hash) then
      raise exception 'PIN_SAME_AS_OLD: PIN mới trùng PIN cũ';
    end if;
  end if;

  -- Update PIN — reset failed_attempts + locked_until
  update public.profiles
  set pos_pin_hash = public.hash_pos_pin(p_new_pin),
      pos_pin_set_at = now(),
      pos_pin_set_by = v_actor,  -- self-set
      pos_pin_failed_attempts = 0,
      pos_pin_locked_until = null,
      updated_at = now()
  where id = v_actor;

  -- Audit log
  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_profile.tenant_id, v_actor, 'change_pos_pin_self', 'user', v_actor,
    jsonb_build_object(
      'changed_at', now(),
      'is_first_time', v_profile.pos_pin_hash is null
    )
  );

  return jsonb_build_object(
    'success', true,
    'user_id', v_actor,
    'is_first_time', v_profile.pos_pin_hash is null
  );
end;
$$;

comment on function public.change_my_pos_pin is
  'Nhân viên tự đổi PIN POS của chính mình. Lần đầu chưa có PIN: p_old_pin=null. Đã có PIN: required.';

grant execute on function public.change_my_pos_pin(text, text) to authenticated;

notify pgrst, 'reload schema';
