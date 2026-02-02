-- Migration: User Management Enhancements
-- Adds columns for user locking, login tracking, and phone unique constraint
-- Part of Phase 1: Authentication & User Management Improvements

-- Add new columns to profiles table
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS failed_login_attempts INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS deactivated_by UUID REFERENCES profiles(id);

-- Add comments for documentation
COMMENT ON COLUMN profiles.is_locked IS 'User account is locked (admin action or security)';
COMMENT ON COLUMN profiles.failed_login_attempts IS 'Count of consecutive failed login attempts';
COMMENT ON COLUMN profiles.locked_until IS 'Temporary lock expiration timestamp';
COMMENT ON COLUMN profiles.last_login_at IS 'Last successful login timestamp';
COMMENT ON COLUMN profiles.deactivated_at IS 'When the account was deactivated';
COMMENT ON COLUMN profiles.deactivated_by IS 'Who deactivated the account';

-- ⭐ IMPORTANT: Create unique index for phone within tenant
-- Allows phone to be NULL (for users without phone) but ensures uniqueness when set
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_phone_tenant
  ON profiles(tenant_id, phone)
  WHERE phone IS NOT NULL;

-- Index for search performance
CREATE INDEX IF NOT EXISTS idx_profiles_full_name_lower
  ON profiles(LOWER(full_name));

CREATE INDEX IF NOT EXISTS idx_profiles_email_lower
  ON profiles(LOWER(email));

CREATE INDEX IF NOT EXISTS idx_profiles_phone
  ON profiles(phone)
  WHERE phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_status
  ON profiles(status)
  WHERE status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_is_locked
  ON profiles(is_locked)
  WHERE is_locked = TRUE;

-- RPC Function: Toggle user lock status
CREATE OR REPLACE FUNCTION toggle_user_lock(
  p_user_id UUID,
  p_is_locked BOOLEAN,
  p_lock_duration_hours INT DEFAULT 24
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id UUID;
BEGIN
  -- Check admin permission
  IF NOT public.has_permission('users.manage') THEN
    RAISE EXCEPTION 'Không có quyền quản lý users';
  END IF;

  v_tenant_id := public.current_tenant_id();

  -- Verify user exists in same tenant
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = p_user_id AND tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'User không tồn tại';
  END IF;

  -- Update lock status
  UPDATE profiles
  SET
    is_locked = p_is_locked,
    locked_until = CASE
      WHEN p_is_locked THEN NOW() + (p_lock_duration_hours || ' hours')::INTERVAL
      ELSE NULL
    END,
    failed_login_attempts = CASE WHEN NOT p_is_locked THEN 0 ELSE failed_login_attempts END
  WHERE id = p_user_id AND tenant_id = v_tenant_id;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION toggle_user_lock TO authenticated;

COMMENT ON FUNCTION toggle_user_lock IS 'Admin function to lock/unlock user accounts';

-- RPC Function: Search users
CREATE OR REPLACE FUNCTION search_users(
  p_search_term TEXT DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_branch_id UUID DEFAULT NULL,
  p_limit INT DEFAULT 50
)
RETURNS TABLE(
  id UUID,
  email TEXT,
  full_name TEXT,
  phone TEXT,
  status TEXT,
  branch_id UUID,
  is_locked BOOLEAN,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    p.id,
    p.email,
    p.full_name,
    p.phone,
    p.status,
    p.branch_id,
    p.is_locked,
    p.last_login_at,
    p.created_at
  FROM profiles p
  WHERE p.tenant_id = current_tenant_id()
    AND (p_search_term IS NULL OR
         LOWER(p.full_name) LIKE '%' || LOWER(p_search_term) || '%' OR
         LOWER(p.email) LIKE '%' || LOWER(p_search_term) || '%' OR
         p.phone LIKE '%' || p_search_term || '%')
    AND (p_status IS NULL OR p.status = p_status)
    AND (p_branch_id IS NULL OR p.branch_id = p_branch_id)
  ORDER BY p.created_at DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION search_users TO authenticated;

COMMENT ON FUNCTION search_users IS 'Search users by name, email, or phone with filters';

-- Trigger: Auto-unlock users when locked_until expires
CREATE OR REPLACE FUNCTION auto_unlock_expired_locks()
RETURNS TRIGGER AS $$
BEGIN
  -- If locked_until has passed, automatically unlock
  IF NEW.is_locked = TRUE AND NEW.locked_until IS NOT NULL AND NEW.locked_until < NOW() THEN
    NEW.is_locked := FALSE;
    NEW.locked_until := NULL;
    NEW.failed_login_attempts := 0;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_auto_unlock_expired
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION auto_unlock_expired_locks();

COMMENT ON TRIGGER trg_auto_unlock_expired ON profiles IS 'Auto-unlock accounts when lock duration expires';
