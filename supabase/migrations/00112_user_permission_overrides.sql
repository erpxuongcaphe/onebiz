-- ============================================================
-- 00112: Per-user permission overrides (CEO 22/05/2026)
-- ============================================================
-- CEO: 'sẽ có những user mặc dù cùng chức danh nhưng lại sẽ có những
-- quyền riêng biệt'. RBAC thuần (role → permissions) không đủ linh hoạt.
--
-- Mô hình:
--   Effective permissions = (role permissions ∪ grants) ∖ revokes
--
-- Ví dụ:
--   - Linh là Cashier (role permissions: discount, void, ...)
--   - Add grant: EDIT_PRICE → Linh có thêm quyền sửa giá
--   - Add revoke: VOID → Linh không hủy hóa đơn được nữa
--   → Hai cashier "cùng chức danh" có quyền khác nhau
--
-- Owner role bypass mọi check (xem auth-context.tsx).

CREATE TABLE IF NOT EXISTS public.user_permission_overrides (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- profiles.id = auth.users.id (mapping 1-1)
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  permission_code text NOT NULL,
  override_type text NOT NULL CHECK (override_type IN ('grant', 'revoke')),
  /** Ghi chú lý do override (vd "tin cashier lâu năm", "thực tập sinh tạm khoá"). */
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- 1 user × 1 permission = 1 override (grant HOẶC revoke, không cả hai)
  UNIQUE (tenant_id, user_id, permission_code)
);

CREATE INDEX IF NOT EXISTS idx_user_perm_overrides_user
  ON public.user_permission_overrides (user_id);

CREATE INDEX IF NOT EXISTS idx_user_perm_overrides_tenant
  ON public.user_permission_overrides (tenant_id);

COMMENT ON TABLE public.user_permission_overrides IS
  'Per-user permission grants/revokes — override role permissions. Effective = role ∪ grants ∖ revokes. CEO 22/05/2026.';

-- ============================================================
-- Helper RPC: tính effective permissions cho 1 user
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
    SELECT rp.permission_code
    FROM public.role_permissions rp
    WHERE rp.role_id = v_role_id
  ),
  user_grants AS (
    SELECT o.permission_code
    FROM public.user_permission_overrides o
    WHERE o.tenant_id = v_tenant_id
      AND o.user_id = p_user_id
      AND o.override_type = 'grant'
  ),
  user_revokes AS (
    SELECT o.permission_code
    FROM public.user_permission_overrides o
    WHERE o.tenant_id = v_tenant_id
      AND o.user_id = p_user_id
      AND o.override_type = 'revoke'
  )
  SELECT DISTINCT p.permission_code
  FROM (
    SELECT permission_code FROM role_perms
    UNION
    SELECT permission_code FROM user_grants
  ) p
  WHERE p.permission_code NOT IN (SELECT permission_code FROM user_revokes);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_effective_permissions(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_user_effective_permissions IS
  'Tính effective permissions cho user = role permissions ∪ grants ∖ revokes. CEO 22/05/2026.';

-- ============================================================
-- RLS — chỉ tenant owner/admin được xem/sửa overrides
-- ============================================================

ALTER TABLE public.user_permission_overrides ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_permission_overrides'
      AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON public.user_permission_overrides
      FOR ALL
      USING (
        tenant_id IN (
          SELECT tenant_id FROM public.profiles WHERE id = auth.uid()
        )
      );
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
