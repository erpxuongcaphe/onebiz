-- Migration: Activate User Permissions System
-- Enables admins to grant special permissions to individual users
-- Special permissions override or supplement role-based permissions

-- =====================================================
-- RPC: Add or Update User Special Permission
-- =====================================================
CREATE OR REPLACE FUNCTION add_user_permission(
  p_user_id UUID,
  p_permission_code TEXT,
  p_granted BOOLEAN DEFAULT TRUE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id UUID;
BEGIN
  -- Check admin permission
  IF NOT public.has_permission('users.permissions.manage') THEN
    RAISE EXCEPTION 'Không có quyền quản lý permissions';
  END IF;

  v_tenant_id := current_tenant_id();

  -- Verify user exists in same tenant
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = p_user_id AND tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'User không tồn tại trong tenant';
  END IF;

  -- Insert or update permission
  INSERT INTO user_permissions (tenant_id, user_id, permission_code, granted, assigned_by)
  VALUES (v_tenant_id, p_user_id, p_permission_code, p_granted, auth.uid())
  ON CONFLICT (tenant_id, user_id, permission_code)
  DO UPDATE SET
    granted = p_granted,
    assigned_by = auth.uid(),
    assigned_at = NOW();

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION add_user_permission TO authenticated;
COMMENT ON FUNCTION add_user_permission IS 'Admin assigns special permission to user (grant or deny)';

-- =====================================================
-- RPC: Remove User Special Permission
-- =====================================================
CREATE OR REPLACE FUNCTION remove_user_permission(
  p_user_id UUID,
  p_permission_code TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Check admin permission
  IF NOT public.has_permission('users.permissions.manage') THEN
    RAISE EXCEPTION 'Không có quyền quản lý permissions';
  END IF;

  -- Delete permission
  DELETE FROM user_permissions
  WHERE user_id = p_user_id
    AND permission_code = p_permission_code
    AND tenant_id = current_tenant_id();

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION remove_user_permission TO authenticated;
COMMENT ON FUNCTION remove_user_permission IS 'Remove special permission from user';

-- =====================================================
-- RPC: Get User Special Permissions
-- =====================================================
CREATE OR REPLACE FUNCTION get_user_special_permissions(
  p_user_id UUID
)
RETURNS TABLE(
  permission_code TEXT,
  granted BOOLEAN,
  assigned_at TIMESTAMPTZ,
  assigned_by_name TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    up.permission_code,
    up.granted,
    up.assigned_at,
    p.full_name AS assigned_by_name
  FROM user_permissions up
  LEFT JOIN profiles p ON p.id = up.assigned_by
  WHERE up.user_id = p_user_id
    AND up.tenant_id = current_tenant_id()
  ORDER BY up.assigned_at DESC;
$$;

GRANT EXECUTE ON FUNCTION get_user_special_permissions TO authenticated;
COMMENT ON FUNCTION get_user_special_permissions IS 'Get all special permissions assigned to a user';
