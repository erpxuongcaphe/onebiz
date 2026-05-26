-- ============================================================
-- 00114: Fix get_user_effective_permissions ambiguity (CEO 26/05/2026)
-- ============================================================
--
-- BUG: Migration 00112 tạo RPC get_user_effective_permissions với:
--   RETURNS TABLE (permission_code text)
-- và CTE bên trong cũng SELECT cột tên `permission_code`. PostgreSQL
-- raise error: "column reference 'permission_code' is ambiguous".
--
-- Hậu quả: RPC fail HTTP 400 → AuthContext catch error → permissions
-- Set rỗng → toàn bộ menu phụ thuộc permissions bị ẩn (Sản xuất, Kho,
-- Tài chính nâng cao...). Bug tồn tại từ 22/05 đến 26/05.
--
-- FIX: rename CTE column thành `perm_code` để tránh trùng với RETURNS
-- TABLE column. Logic giữ nguyên 100%.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_user_effective_permissions(
  p_user_id uuid
) RETURNS TABLE (permission_code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_tenant_id uuid;
  v_role_id uuid;
BEGIN
  SELECT tenant_id, role_id INTO v_tenant_id, v_role_id
  FROM public.profiles
  WHERE id = p_user_id;

  IF v_tenant_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH role_perms AS (
    SELECT rp.permission_code AS perm_code
    FROM public.role_permissions rp
    WHERE rp.role_id = v_role_id
  ),
  user_grants AS (
    SELECT o.permission_code AS perm_code
    FROM public.user_permission_overrides o
    WHERE o.tenant_id = v_tenant_id
      AND o.user_id = p_user_id
      AND o.override_type = 'grant'
  ),
  user_revokes AS (
    SELECT o.permission_code AS perm_code
    FROM public.user_permission_overrides o
    WHERE o.tenant_id = v_tenant_id
      AND o.user_id = p_user_id
      AND o.override_type = 'revoke'
  )
  SELECT DISTINCT p.perm_code AS permission_code
  FROM (
    SELECT perm_code FROM role_perms
    UNION
    SELECT perm_code FROM user_grants
  ) p
  WHERE p.perm_code NOT IN (SELECT perm_code FROM user_revokes);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_effective_permissions(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_user_effective_permissions IS
  'Tính effective permissions cho user = role permissions ∪ grants ∖ revokes. CEO 26/05/2026 fix ambiguity.';

NOTIFY pgrst, 'reload schema';
