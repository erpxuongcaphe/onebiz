-- ============================================================
-- 00116: Seed quyền inventory.lock cho Chủ cửa hàng + Admin (CEO 28/05/2026)
-- ============================================================
--
-- BỐI CẢNH: Thêm tính năng "Khóa cập nhật tồn kho đầu kỳ". Chỉ Chủ DN hoặc
-- người được cấp quyền `inventory.lock` mới được chốt-khóa / mở khóa tồn.
--
--   - Chủ cửa hàng (owner): có sẵn ALL (wildcard ở app) — seed cho chắc chắn.
--   - Admin: cấp mặc định (admin là tài khoản quản trị tin cậy).
--   - Quản lý / Thu ngân / ...: KHÔNG mặc định — owner/admin tự cấp qua UI
--     phân quyền nếu muốn giao cho người khác.
--
-- AN TOÀN DATA: Migration này CHỈ INSERT vào role_permissions
-- (ON CONFLICT DO NOTHING). KHÔNG đụng products / branch_stock / bất kỳ data
-- tồn kho nào. Chạy nhiều lần không lỗi, không mất data.
-- ============================================================

DO $$
DECLARE
  v_role record;
BEGIN
  FOR v_role IN
    SELECT id, name FROM public.roles
    WHERE name IN ('Chủ cửa hàng', 'Admin')
  LOOP
    INSERT INTO public.role_permissions (role_id, permission_code)
    VALUES (v_role.id, 'inventory.lock')
    ON CONFLICT (role_id, permission_code) DO NOTHING;
    RAISE NOTICE 'Seeded inventory.lock for role: % (%)', v_role.name, v_role.id;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
