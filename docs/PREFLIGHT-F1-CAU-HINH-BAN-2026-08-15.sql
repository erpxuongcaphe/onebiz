-- ============================================================================
-- PREFLIGHT F1 — CẤU HÌNH BÀN & SƠ ĐỒ BÀN   15/08/2026
--
-- CHỈ ĐỌC. Toàn bộ là SELECT trên catalog + dữ liệu. Không tạo, không sửa,
-- không xoá, không gọi RPC ghi. Chạy lại bao nhiêu lần cũng vô hại.
--
-- Mục đích: chụp hiện trạng TRƯỚC khi viết migration RPC khoá ghi cấu hình
-- bàn/sơ đồ bàn (restaurant_tables · floor_plan_zones · floor_plan_decorations).
-- Kết quả quyết định nội dung migration — KHÔNG đoán từ repo.
--
-- Tenant OneBiz đã xác nhận 08/08: 148e8ac5-b891-4de3-9055-cfa41f39ddb0
-- (nếu nghi ngờ, chạy lại docs/PREFLIGHT-KPI-HOA-DON-A0-CHON-TENANT.sql).
--
-- Cách chạy: Supabase → SQL Editor → dán cả tệp → Run. SQL Editor thường chỉ
-- hiện kết quả CÂU CUỐI — chạy theo từng khối F1..F7 nếu cần xem đủ.
-- ============================================================================

-- ── F1a. RLS + policy trên 3 bảng cấu hình ─────────────────────────────────
-- Quyết định: RPC SECURITY DEFINER có phải là lớp chặn DUY NHẤT hay còn RLS đỡ.
SELECT
  'F1a. RLS' AS muc, c.relname AS bang,
  c.relrowsecurity AS rls_bat, c.relforcerowsecurity AS rls_ep_chu_bang,
  (SELECT count(*) FROM pg_policies p
    WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS so_policy
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('restaurant_tables','floor_plan_zones','floor_plan_decorations');

SELECT 'F1b. Policy' AS muc, tablename AS bang, policyname AS ten, cmd AS lenh,
       roles::text AS vai_tro, qual AS dieu_kien_doc, with_check AS dieu_kien_ghi
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('restaurant_tables','floor_plan_zones','floor_plan_decorations')
ORDER BY tablename, policyname;

-- ── F2. GRANT trực tiếp trên 3 bảng — CÂU QUAN TRỌNG NHẤT ─────────────────
-- Nếu authenticated đang có INSERT/UPDATE/DELETE và RLS tắt thì BẤT KỲ nhân
-- viên đăng nhập nào (không cần quyền) cũng sửa được sơ đồ bàn qua devtools.
-- Đây chính là cái F1 phải đóng.
SELECT
  'F2. Grant bảng' AS muc, table_name AS bang, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('restaurant_tables','floor_plan_zones','floor_plan_decorations')
  AND grantee IN ('anon','authenticated','public')
ORDER BY table_name, grantee, privilege_type;

-- ── F3. Hàm nền RPC sẽ gọi — xác nhận tồn tại, đúng chữ ký ─────────────────
SELECT
  'F3. Hàm nền' AS muc,
  n.nspname||'.'||p.proname AS ten_ham,
  pg_get_function_identity_arguments(p.oid) AS tham_so,
  pg_get_function_result(p.oid) AS tra_ve,
  p.prosecdef AS la_security_definer
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN (
  'get_user_tenant_id','user_has_permission','user_has_branch_access',
  'get_user_accessible_branches',
  'fnb_transfer_table_atomic','mark_fnb_table_available_atomic')
ORDER BY 2;

-- ── F4. Mã quyền liên quan đã gán cho vai trò nào ──────────────────────────
-- Hệ thống đang dùng 3 HỌ mã quyền cho cùng nhóm việc:
--   pos_fnb.manage_tables (RPC 00275/00277/00322 đang kiểm)
--   system.manage_branches (trang /he-thong/quan-ly-ban đang gate)
--   floor_plan.view / edit_branch / edit_global (trang /he-thong/so-do-ban)
-- Cần biết thực tế vai trò nào giữ mã nào để chốt mã cho RPC mới.
SELECT 'F4. Quyền đã gán' AS muc, r.name AS vai_tro, rp.permission_code
FROM public.role_permissions rp
JOIN public.roles r ON r.id = rp.role_id
WHERE rp.permission_code IN (
  'pos_fnb.manage_tables','system.manage_branches',
  'floor_plan.view','floor_plan.edit_branch','floor_plan.edit_global')
ORDER BY rp.permission_code, r.name;

-- Ghi đè theo người dùng cho các mã trên. Cột thật là override_type (không
-- phải granted) — gom theo giá trị thật để không đoán 'grant'/'revoke'.
SELECT 'F4b. Ghi đè cá nhân' AS muc, upo.permission_code,
       upo.override_type, count(*) AS so_nguoi
FROM public.user_permission_overrides upo
WHERE upo.permission_code IN (
  'pos_fnb.manage_tables','system.manage_branches',
  'floor_plan.view','floor_plan.edit_branch','floor_plan.edit_global')
GROUP BY upo.permission_code, upo.override_type
ORDER BY 2, 3;

-- ── F5. Hiện trạng dữ liệu bàn (khoá theo tenant OneBiz) ───────────────────
-- Migration KHÔNG được đổi dữ liệu — chụp lại để hậu kiểm so sánh y nguyên.
SELECT
  'F5. Bàn theo chi nhánh' AS muc, b.name AS chi_nhanh,
  count(*) FILTER (WHERE t.is_active)                          AS ban_dang_dung,
  count(*) FILTER (WHERE NOT t.is_active)                      AS ban_da_xoa_mem,
  count(*) FILTER (WHERE t.is_active AND t.status <> 'available') AS ban_dang_ban,
  count(*) FILTER (WHERE t.is_active AND t.current_order_id IS NOT NULL) AS ban_co_don,
  count(*) FILTER (WHERE t.is_active AND t.locked)             AS ban_khoa_keo,
  count(DISTINCT t.zone) FILTER (WHERE t.is_active)            AS so_khu_text
FROM public.restaurant_tables t
JOIN public.branches b ON b.id = t.branch_id
WHERE t.tenant_id = '148e8ac5-b891-4de3-9055-cfa41f39ddb0'
GROUP BY b.name ORDER BY b.name;

-- Trạng thái bàn đang tồn tại thực tế (RPC guard xoá phải khớp tập này)
SELECT 'F5b. Trạng thái bàn' AS muc, t.status, count(*) AS so_ban
FROM public.restaurant_tables t
WHERE t.tenant_id = '148e8ac5-b891-4de3-9055-cfa41f39ddb0' AND t.is_active
GROUP BY t.status ORDER BY 3 DESC;

-- ── F6. Hai hệ "khu vực" song song — đo độ lệch ───────────────────────────
-- restaurant_tables.zone (TEXT, màn Bàn & Khu vực) vs floor_plan_zones (+ zone_id,
-- màn Sơ đồ bàn). renameZone hiện chỉ đổi TEXT, không đụng floor_plan_zones.name.
SELECT
  'F6. Khu TEXT vs khu sơ đồ' AS muc, b.name AS chi_nhanh,
  (SELECT count(DISTINCT t.zone) FROM public.restaurant_tables t
    WHERE t.branch_id = b.id AND t.is_active AND t.zone IS NOT NULL) AS khu_text,
  (SELECT count(*) FROM public.floor_plan_zones z
    WHERE z.branch_id = b.id AND z.is_active)                        AS khu_so_do,
  (SELECT count(*) FROM public.restaurant_tables t
    WHERE t.branch_id = b.id AND t.is_active AND t.zone_id IS NULL)  AS ban_chua_gan_so_do,
  (SELECT count(*) FROM public.restaurant_tables t
    LEFT JOIN public.floor_plan_zones z ON z.id = t.zone_id
    WHERE t.branch_id = b.id AND t.is_active AND t.zone_id IS NOT NULL
      AND (z.id IS NULL OR NOT z.is_active))                         AS ban_gan_khu_da_an
FROM public.branches b
WHERE b.tenant_id = '148e8ac5-b891-4de3-9055-cfa41f39ddb0'
ORDER BY b.name;

-- Trang trí sơ đồ (floor_plan_decorations) — đếm để biết quy mô
SELECT 'F6b. Trang trí' AS muc, count(*) AS so_dong,
       count(DISTINCT zone_id) AS so_khu_co_trang_tri
FROM public.floor_plan_decorations
WHERE tenant_id = '148e8ac5-b891-4de3-9055-cfa41f39ddb0';

-- ── F7. audit_log — RPC mới sẽ ghi vào đây, xác nhận cấu trúc + grant ─────
SELECT 'F7. Cột audit_log' AS muc,
       string_agg(column_name || ':' || data_type, ' · ' ORDER BY ordinal_position) AS cot
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'audit_log';

SELECT 'F7b. Grant audit_log' AS muc, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'audit_log'
  AND grantee IN ('anon','authenticated','public')
ORDER BY grantee, privilege_type;
