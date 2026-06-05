-- ============================================================
-- 00128 — Seed permissions cho shift reconcile (CEO 05/06/2026)
-- ============================================================
-- Permissions mới ở constants.ts (migration 00127 wire):
--   shifts.reconcile_any         — Owner/Admin (mọi chi nhánh)
--   shifts.reconcile_own_branch  — Quản lý quán (chỉ chi nhánh mình)
--
-- An toàn:
--   - INSERT ON CONFLICT DO NOTHING — không double-seed
--   - Không drop permission cũ
--   - Không động data ca cũ
-- ============================================================

DO $$
DECLARE
  v_role record;
BEGIN
  FOR v_role IN SELECT id, name FROM public.roles LOOP
    IF v_role.name IN ('Chủ cửa hàng', 'Admin', 'Owner') THEN
      -- Owner + Admin: cả 2 quyền
      INSERT INTO public.role_permissions (role_id, permission_code)
      VALUES
        (v_role.id, 'shifts.reconcile_any'),
        (v_role.id, 'shifts.reconcile_own_branch')
      ON CONFLICT (role_id, permission_code) DO NOTHING;
      RAISE NOTICE 'Seeded 2 shift_reconcile permissions for role: % (%)',
        v_role.name, v_role.id;

    ELSIF v_role.name IN ('Quản lý', 'Quản lý quán', 'Manager') THEN
      -- Manager: chỉ own_branch
      INSERT INTO public.role_permissions (role_id, permission_code)
      VALUES (v_role.id, 'shifts.reconcile_own_branch')
      ON CONFLICT (role_id, permission_code) DO NOTHING;
      RAISE NOTICE 'Seeded shifts.reconcile_own_branch for role: % (%)',
        v_role.name, v_role.id;
    END IF;
  END LOOP;
END $$;
