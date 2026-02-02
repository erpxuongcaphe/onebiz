-- Migration: Admin Password Reset
-- Allows admin to verify permissions before resetting user password
-- Note: Actual password update requires Supabase Admin API client-side

CREATE OR REPLACE FUNCTION admin_reset_user_password(
  p_user_id UUID,
  p_new_password TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id UUID;
  v_user_email TEXT;
BEGIN
  -- Check admin permission
  IF NOT public.has_permission('users.manage') THEN
    RAISE EXCEPTION 'Không có quyền quản lý users';
  END IF;

  -- Get current tenant
  v_tenant_id := public.current_tenant_id();

  -- Verify user exists in same tenant and get email
  SELECT email INTO v_user_email
  FROM profiles
  WHERE id = p_user_id AND tenant_id = v_tenant_id;

  IF v_user_email IS NULL THEN
    RAISE EXCEPTION 'User không tồn tại';
  END IF;

  -- Verify user is not locked
  IF EXISTS (
    SELECT 1 FROM profiles
    WHERE id = p_user_id AND is_locked = TRUE
  ) THEN
    RAISE EXCEPTION 'User đang bị khóa. Vui lòng mở khóa trước khi reset password.';
  END IF;

  -- Success - actual password update happens client-side with Admin API
  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_reset_user_password TO authenticated;

COMMENT ON FUNCTION admin_reset_user_password IS 'Admin function to verify permissions before password reset. Actual password update requires Supabase Admin API.';
