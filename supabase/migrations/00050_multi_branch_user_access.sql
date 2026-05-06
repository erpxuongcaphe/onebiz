-- ============================================================
-- Migration 00050 — Multi-branch user access (Sprint USER-MGMT)
-- ============================================================
-- CEO 06/05/2026: User có thể được cấp quyền truy cập 1+ chi nhánh
-- HOẶC tất cả chi nhánh. Hiện tại profiles.branch_id chỉ 1 chi nhánh
-- → cần m2m table user_branches.
--
-- BACKWARD COMPAT:
--   - profiles.branch_id giữ làm "chi nhánh chính" / mặc định khi đăng nhập
--   - user_branches là EXTRA branches user được phép truy cập
--   - Nếu profiles.role = 'owner' → bypass all checks (full access)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  granted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_user_branches_user
  ON public.user_branches(user_id);
CREATE INDEX IF NOT EXISTS idx_user_branches_branch
  ON public.user_branches(branch_id);

ALTER TABLE public.user_branches ENABLE ROW LEVEL SECURITY;

-- RLS: tenant members có thể read user_branches của tenant mình
DROP POLICY IF EXISTS "user_branches_select" ON public.user_branches;
CREATE POLICY "user_branches_select" ON public.user_branches
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = user_branches.user_id
        AND p.tenant_id = get_user_tenant_id()
    )
  );

DROP POLICY IF EXISTS "user_branches_insert" ON public.user_branches;
CREATE POLICY "user_branches_insert" ON public.user_branches
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = user_branches.user_id
        AND p.tenant_id = get_user_tenant_id()
    )
  );

DROP POLICY IF EXISTS "user_branches_delete" ON public.user_branches;
CREATE POLICY "user_branches_delete" ON public.user_branches
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = user_branches.user_id
        AND p.tenant_id = get_user_tenant_id()
    )
  );

-- ============================================================
-- Function: kiểm tra user có truy cập chi nhánh không
-- ============================================================
-- Logic:
-- - Owner role → true (full access)
-- - profiles.branch_id = chi nhánh đang check → true (legacy default branch)
-- - Có row trong user_branches → true (extra granted)
-- - Else → false
CREATE OR REPLACE FUNCTION public.user_has_branch_access(
  p_user_id UUID,
  p_branch_id UUID
) RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_user_id
      AND (
        p.role = 'owner'
        OR p.branch_id = p_branch_id
        OR EXISTS (
          SELECT 1 FROM public.user_branches ub
          WHERE ub.user_id = p_user_id AND ub.branch_id = p_branch_id
        )
      )
  );
$$;

-- ============================================================
-- Function: get all branch IDs user has access to
-- ============================================================
-- Owner → return TẤT CẢ branches của tenant
-- Else → return profiles.branch_id + user_branches[]
CREATE OR REPLACE FUNCTION public.get_user_accessible_branches(p_user_id UUID)
RETURNS TABLE(branch_id UUID)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT b.id AS branch_id
  FROM public.profiles p
  JOIN public.branches b ON b.tenant_id = p.tenant_id
  WHERE p.id = p_user_id AND p.role = 'owner'

  UNION

  SELECT p.branch_id
  FROM public.profiles p
  WHERE p.id = p_user_id AND p.branch_id IS NOT NULL AND p.role <> 'owner'

  UNION

  SELECT ub.branch_id
  FROM public.user_branches ub
  JOIN public.profiles p ON p.id = ub.user_id
  WHERE ub.user_id = p_user_id AND p.role <> 'owner';
$$;

-- ============================================================
-- Permission codes mới (insert nếu chưa có)
-- ============================================================
-- Sau migration này, role nào có 'system.manage_users' permission sẽ
-- được phép tạo user + assign branch + assign role.
-- Owner role mặc định luôn có (bypass).

-- Document only — không seed trực tiếp vì roles + role_permissions
-- depend tenant. App layer (lib/permissions) sẽ register permission codes:
--   - system.manage_users (existing)
--   - system.manage_branch_access (NEW — assign user to branches)
--   - system.create_user (NEW — tạo user mới với password)
