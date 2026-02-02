-- Migration: Update search_users RPC with Lock Filter
-- Adds is_locked parameter to search_users function
-- Also returns locked_until field for display

CREATE OR REPLACE FUNCTION search_users(
  p_search_term TEXT DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_branch_id UUID DEFAULT NULL,
  p_is_locked BOOLEAN DEFAULT NULL,
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
  locked_until TIMESTAMPTZ,
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
    p.locked_until,
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
    AND (p_is_locked IS NULL OR p.is_locked = p_is_locked)
  ORDER BY p.created_at DESC
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION search_users IS 'Search users by name, email, phone with filters including lock status';
