-- =====================================================
-- Migration: User CRUD for Admin
-- Purpose: Allow admins to update user profiles and deactivate users
-- Features:
--   - admin_update_user_profile() RPC
--   - deactivate_user() RPC with soft delete
--   - Validation and permission checks
-- Note: User creation is handled via Edge Function (admin-create-user)
-- =====================================================

-- Step 1: Add deactivation tracking columns to profiles (if not exists)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS deactivated_by UUID REFERENCES profiles(id);

-- Step 2: Create index for deactivated users
CREATE INDEX IF NOT EXISTS idx_profiles_deactivated ON profiles(tenant_id, status, deactivated_at);

-- Step 3: RPC - Admin Update User Profile
CREATE OR REPLACE FUNCTION admin_update_user_profile(
  p_user_id UUID,
  p_full_name TEXT,
  p_phone TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id UUID;
  v_current_user_id UUID;
BEGIN
  -- Check permission
  IF NOT public.has_permission('users.manage') THEN
    RAISE EXCEPTION 'Không có quyền sửa thông tin user';
  END IF;

  v_tenant_id := public.current_tenant_id();
  v_current_user_id := auth.uid();

  -- Verify user exists in same tenant
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = p_user_id AND tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'User không tồn tại hoặc không thuộc tenant này';
  END IF;

  -- Validate full_name (required)
  IF p_full_name IS NULL OR TRIM(p_full_name) = '' THEN
    RAISE EXCEPTION 'Họ và tên không được để trống';
  END IF;

  -- Validate phone format (Vietnam phone number - optional)
  IF p_phone IS NOT NULL AND p_phone != '' THEN
    IF NOT p_phone ~ '^\+?[0-9]{10,12}$' THEN
      RAISE EXCEPTION 'Số điện thoại không hợp lệ';
    END IF;

    -- Check phone uniqueness within tenant
    IF EXISTS (
      SELECT 1 FROM profiles
      WHERE phone = p_phone
        AND tenant_id = v_tenant_id
        AND id != p_user_id
    ) THEN
      RAISE EXCEPTION 'Số điện thoại đã được sử dụng bởi user khác';
    END IF;
  END IF;

  -- Validate email format (optional, for display only - auth email cannot change)
  IF p_email IS NOT NULL AND p_email != '' THEN
    IF NOT p_email ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
      RAISE EXCEPTION 'Email không hợp lệ';
    END IF;
  END IF;

  -- Update profile
  UPDATE profiles
  SET
    full_name = TRIM(p_full_name),
    phone = CASE WHEN p_phone IS NOT NULL AND p_phone != '' THEN p_phone ELSE NULL END,
    email = CASE WHEN p_email IS NOT NULL AND p_email != '' THEN p_email ELSE email END,
    updated_at = NOW()
  WHERE id = p_user_id AND tenant_id = v_tenant_id;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_update_user_profile TO authenticated;

-- Step 4: RPC - Deactivate User (Soft Delete)
CREATE OR REPLACE FUNCTION deactivate_user(
  p_user_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id UUID;
  v_current_user_id UUID;
  v_user_email TEXT;
  v_user_name TEXT;
BEGIN
  -- Check permission
  IF NOT public.has_permission('users.manage') THEN
    RAISE EXCEPTION 'Không có quyền vô hiệu hóa user';
  END IF;

  v_tenant_id := public.current_tenant_id();
  v_current_user_id := auth.uid();

  -- Cannot deactivate self
  IF p_user_id = v_current_user_id THEN
    RAISE EXCEPTION 'Không thể vô hiệu hóa chính mình';
  END IF;

  -- Verify user exists in same tenant
  SELECT email, full_name INTO v_user_email, v_user_name
  FROM profiles
  WHERE id = p_user_id AND tenant_id = v_tenant_id;

  IF v_user_email IS NULL THEN
    RAISE EXCEPTION 'User không tồn tại hoặc không thuộc tenant này';
  END IF;

  -- Check if user is already deactivated
  IF EXISTS (
    SELECT 1 FROM profiles
    WHERE id = p_user_id AND status = 'inactive'
  ) THEN
    RAISE EXCEPTION 'User đã bị vô hiệu hóa trước đó';
  END IF;

  -- Update profile to inactive
  UPDATE profiles
  SET
    status = 'inactive',
    deactivated_at = NOW(),
    deactivated_by = v_current_user_id,
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'deactivation_reason', p_reason,
      'deactivated_by_name', (SELECT full_name FROM profiles WHERE id = v_current_user_id)
    ),
    updated_at = NOW()
  WHERE id = p_user_id AND tenant_id = v_tenant_id;

  -- Revoke all active sessions (Note: This requires Edge Function or Admin API)
  -- For now, user can still use existing tokens until they expire
  -- TODO: Consider implementing session revocation via Edge Function

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION deactivate_user TO authenticated;

-- Step 5: RPC - Reactivate User (Undo deactivation)
CREATE OR REPLACE FUNCTION reactivate_user(
  p_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id UUID;
BEGIN
  -- Check permission
  IF NOT public.has_permission('users.manage') THEN
    RAISE EXCEPTION 'Không có quyền kích hoạt lại user';
  END IF;

  v_tenant_id := public.current_tenant_id();

  -- Verify user exists in same tenant
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = p_user_id AND tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'User không tồn tại hoặc không thuộc tenant này';
  END IF;

  -- Check if user is inactive
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = p_user_id AND status = 'inactive'
  ) THEN
    RAISE EXCEPTION 'User đang ở trạng thái active';
  END IF;

  -- Reactivate user
  UPDATE profiles
  SET
    status = 'active',
    deactivated_at = NULL,
    deactivated_by = NULL,
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'reactivated_at', NOW(),
      'reactivated_by', auth.uid()
    ),
    updated_at = NOW()
  WHERE id = p_user_id AND tenant_id = v_tenant_id;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION reactivate_user TO authenticated;

-- Step 6: RPC - Admin Update User Branch
CREATE OR REPLACE FUNCTION admin_update_user_branch(
  p_user_id UUID,
  p_branch_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id UUID;
BEGIN
  -- Check permission
  IF NOT public.has_permission('users.manage') THEN
    RAISE EXCEPTION 'Không có quyền thay đổi chi nhánh user';
  END IF;

  v_tenant_id := public.current_tenant_id();

  -- Verify user exists
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = p_user_id AND tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'User không tồn tại';
  END IF;

  -- Verify branch exists in same tenant
  IF p_branch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM branches
    WHERE id = p_branch_id AND tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Chi nhánh không tồn tại';
  END IF;

  -- Update branch
  UPDATE profiles
  SET branch_id = p_branch_id, updated_at = NOW()
  WHERE id = p_user_id AND tenant_id = v_tenant_id;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_update_user_branch TO authenticated;

-- Step 7: RPC - Admin Assign Roles to User
CREATE OR REPLACE FUNCTION admin_assign_user_roles(
  p_user_id UUID,
  p_role_ids UUID[]
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id UUID;
  v_role_id UUID;
BEGIN
  -- Check permission
  IF NOT public.has_permission('users.manage') THEN
    RAISE EXCEPTION 'Không có quyền gán role cho user';
  END IF;

  v_tenant_id := public.current_tenant_id();

  -- Verify user exists
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = p_user_id AND tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'User không tồn tại';
  END IF;

  -- Remove existing roles
  DELETE FROM user_roles
  WHERE user_id = p_user_id AND tenant_id = v_tenant_id;

  -- Assign new roles
  FOREACH v_role_id IN ARRAY p_role_ids
  LOOP
    -- Verify role exists in same tenant
    IF NOT EXISTS (
      SELECT 1 FROM roles
      WHERE id = v_role_id AND tenant_id = v_tenant_id
    ) THEN
      RAISE EXCEPTION 'Role không tồn tại: %', v_role_id;
    END IF;

    INSERT INTO user_roles (user_id, role_id, tenant_id, assigned_by)
    VALUES (p_user_id, v_role_id, v_tenant_id, auth.uid());
  END LOOP;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_assign_user_roles TO authenticated;

-- Step 8: View - Get User Details with Roles
CREATE OR REPLACE VIEW user_details AS
SELECT
  p.id,
  p.tenant_id,
  p.email,
  p.full_name,
  p.phone,
  p.avatar_url,
  p.branch_id,
  b.name AS branch_name,
  p.status,
  p.is_locked,
  p.locked_until,
  p.last_login_at,
  p.deactivated_at,
  p.deactivated_by,
  deactivator.full_name AS deactivated_by_name,
  p.created_at,
  p.updated_at,
  ARRAY_AGG(r.id) FILTER (WHERE r.id IS NOT NULL) AS role_ids,
  ARRAY_AGG(r.name) FILTER (WHERE r.name IS NOT NULL) AS role_names
FROM profiles p
LEFT JOIN branches b ON p.branch_id = b.id
LEFT JOIN user_roles ur ON p.id = ur.user_id
LEFT JOIN roles r ON ur.role_id = r.id
LEFT JOIN profiles deactivator ON p.deactivated_by = deactivator.id
WHERE p.tenant_id = public.current_tenant_id()
GROUP BY p.id, b.name, deactivator.full_name;

GRANT SELECT ON user_details TO authenticated;

-- Step 9: Add comments
COMMENT ON FUNCTION admin_update_user_profile IS 'Admin updates user profile information (name, phone, email)';
COMMENT ON FUNCTION deactivate_user IS 'Soft delete user - prevents login but preserves data';
COMMENT ON FUNCTION reactivate_user IS 'Reactivate previously deactivated user';
COMMENT ON FUNCTION admin_update_user_branch IS 'Admin changes user branch assignment';
COMMENT ON FUNCTION admin_assign_user_roles IS 'Admin assigns roles to user';
COMMENT ON VIEW user_details IS 'Complete user information with roles for admin UI';
