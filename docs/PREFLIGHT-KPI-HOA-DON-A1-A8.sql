-- ============================================================================
-- PREFLIGHT KPI HOÁ ĐƠN — BƯỚC A1–A8   08/08/2026
--
-- CHỈ ĐỌC. Toàn bộ là SELECT / EXPLAIN. Không tạo, không sửa, không xoá,
-- không gọi RPC ghi. Chạy lại bao nhiêu lần cũng vô hại.
--
-- ⚠️ CHẠY PREFLIGHT-KPI-HOA-DON-A0-CHON-TENANT.sql TRƯỚC, rồi dán tenant_id
--    OneBiz vào đúng MỘT chỗ ngay dưới đây. Chưa dán thì tệp báo lỗi và dừng —
--    cố ý như vậy, để không bao giờ chạy nhầm sang tenant khác.
-- ============================================================================

-- ┌──────────────────────────────────────────────────────────────────────┐
-- │  DÁN TENANT ID ONEBIZ VÀO DÒNG DƯỚI (thay cả chuỗi trong dấu nháy)   │
-- └──────────────────────────────────────────────────────────────────────┘
CREATE TEMP VIEW tt AS
  SELECT 'DAN_TENANT_ID_VAO_DAY'::uuid AS tenant_id;
-- Tệp dùng TEMP VIEW: chỉ sống trong phiên SQL Editor, tự mất khi đóng.
-- Không tạo gì trong schema public, không đụng dữ liệu.

-- Xác nhận lại một lần nữa mình đang soi đúng ai
SELECT 'A0b. Xác nhận tenant' AS muc, t.id AS tenant_id, t.name AS ten_tenant,
       (SELECT count(*) FROM public.invoices i WHERE i.tenant_id = t.id) AS so_hoa_don
FROM public.tenants t, tt WHERE t.id = tt.tenant_id;

-- ── A1. RLS trên 2 bảng liên quan ────────────────────────────────────────
SELECT
  'A1. RLS' AS muc, c.relname AS bang,
  c.relrowsecurity AS rls_bat, c.relforcerowsecurity AS rls_ep_chu_bang,
  (SELECT count(*) FROM pg_policies p
    WHERE p.schemaname='public' AND p.tablename=c.relname) AS so_policy,
  CASE WHEN c.relrowsecurity THEN '✅ có RLS — INVOKER là đủ'
       ELSE '⚠ RLS TẮT — INVOKER vẫn an toàn vì hàm tự lọc tenant, nhưng báo em biết' END AS ket_luan
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('invoices','shipping_orders');

SELECT 'A1b. Policy' AS muc, tablename AS bang, policyname AS ten, cmd AS lenh, qual AS dieu_kien_doc
FROM pg_policies WHERE schemaname='public' AND tablename IN ('invoices','shipping_orders')
ORDER BY tablename, policyname;

-- ── A2. Hàm xác định tenant ──────────────────────────────────────────────
-- Đúng tên là public.get_user_tenant_id() (00002_rls_policies.sql:7).
-- Liệt kê cả tên sai user_tenant_id() để chứng minh nó KHÔNG tồn tại.
SELECT
  'A2. Hàm tenant' AS muc,
  n.nspname||'.'||p.proname AS ten_ham,
  pg_get_function_identity_arguments(p.oid) AS tham_so,
  pg_get_function_result(p.oid) AS tra_ve,
  p.prosecdef AS la_security_definer
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE p.proname IN ('get_user_tenant_id','user_tenant_id','current_tenant_id')
ORDER BY 2;

-- ── A3. Hàm phân quyền theo mẫu báo cáo 00196 ───────────────────────────
SELECT
  'A3. Hàm quyền' AS muc,
  n.nspname||'.'||p.proname AS ten_ham,
  pg_get_function_identity_arguments(p.oid) AS tham_so,
  pg_get_function_result(p.oid) AS tra_ve,
  p.prosecdef AS la_security_definer, p.provolatile AS bien_thien
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN (
  'user_has_branch_access','get_user_accessible_branches',
  'assert_report_access','get_user_effective_permissions','user_has_permission')
ORDER BY 2;

-- A3b. Đọc THẲNG định nghĩa để xác nhận tính QUYỀN HIỆU LỰC = quyền theo vai
-- trò + cấp riêng − thu hồi riêng (00112/00114/00189), KHÔNG theo chức danh.
SELECT
  'A3b. Nguồn quyền hiệu lực' AS muc,
  n.nspname||'.'||p.proname   AS ten_ham,
  pg_get_functiondef(p.oid)   AS dinh_nghia
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public'
  AND p.proname IN ('user_has_permission','get_user_effective_permissions')
ORDER BY 2;

-- Hai mã quyền mở phạm vi toàn chuỗi đã gán cho vai trò nào chưa
SELECT 'A3c. Mã quyền đã gán' AS muc, rp.permission_code, count(*) AS so_vai_tro
FROM public.role_permissions rp
WHERE rp.permission_code IN ('reports.view_all_branches','system.manage_branches')
GROUP BY rp.permission_code ORDER BY 2;

-- ── A4. Chỉ mục + cỡ bảng. THIẾU thì BÁO, KHÔNG tự thêm ─────────────────
SELECT 'A4. Chỉ mục' AS muc, tablename AS bang, indexname AS ten, indexdef AS dinh_nghia
FROM pg_indexes WHERE schemaname='public' AND tablename IN ('invoices','shipping_orders')
ORDER BY tablename, indexname;

SELECT 'A4b. Cỡ bảng' AS muc, c.relname AS bang, c.reltuples::bigint AS so_dong_uoc_tinh,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS dung_luong
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('invoices','shipping_orders');

-- ── A5a. EXPLAIN — CA THÔNG THƯỜNG ───────────────────────────────────────
-- tenant + 1 chi nhánh (chi nhánh nhiều HĐ nhất của CHÍNH tenant này) + trong tháng.
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
WITH cn AS (
  SELECT i.branch_id FROM public.invoices i, tt
  WHERE i.tenant_id = tt.tenant_id AND i.branch_id IS NOT NULL
  GROUP BY i.branch_id ORDER BY count(*) DESC LIMIT 1
)
SELECT
  count(*)                                                       AS tat_ca_hoa_don,
  count(*) FILTER (WHERE i.status='completed')                   AS hoan_thanh,
  count(*) FILTER (WHERE i.status='cancelled')                   AS da_huy,
  coalesce(sum(i.total) FILTER (WHERE i.status='completed'),0)   AS gia_tri_hoan_thanh,
  coalesce(sum(coalesce(i.discount_amount,0)+coalesce(i.promotion_discount,0))
             FILTER (WHERE i.status='completed'),0)              AS giam_gia_ap_dung
FROM public.invoices i, tt, cn
WHERE i.tenant_id = tt.tenant_id
  AND i.deleted_at IS NULL
  AND i.branch_id = cn.branch_id
  AND i.created_at >= date_trunc('month', now())
  AND i.created_at <  (date_trunc('month', now()) + interval '1 month');

-- ── A5b. EXPLAIN — CA NẶNG NHẤT ─────────────────────────────────────────
-- Bật hết: tenant + chi nhánh + 1 năm + tìm 2 cột + ánh xạ trạng thái
-- + NOT EXISTS vận đơn (có lọc tenant của vận đơn).
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
WITH cn AS (
  SELECT i.branch_id FROM public.invoices i, tt
  WHERE i.tenant_id = tt.tenant_id AND i.branch_id IS NOT NULL
  GROUP BY i.branch_id ORDER BY count(*) DESC LIMIT 1
), loc AS (
  SELECT i.status, i.total,
         coalesce(i.discount_amount,0)+coalesce(i.promotion_discount,0) AS giam
  FROM public.invoices i, tt, cn
  WHERE i.tenant_id = tt.tenant_id
    AND i.deleted_at IS NULL
    AND i.branch_id = cn.branch_id
    AND i.created_at >= (now() - interval '1 year')
    AND i.created_at <  (date_trunc('day', now()) + interval '1 day')
    AND (i.code ILIKE '%HD%' OR i.customer_name ILIKE '%a%')
    AND NOT EXISTS (
      SELECT 1 FROM public.shipping_orders so
      WHERE so.invoice_id = i.id AND so.tenant_id = tt.tenant_id)
)
SELECT
  count(*)                                                    AS tat_ca_hoa_don,
  count(*) FILTER (WHERE status='completed')                  AS hoan_thanh,
  count(*) FILTER (WHERE status='cancelled')                  AS da_huy,
  coalesce(sum(total) FILTER (WHERE status='completed'),0)    AS gia_tri_hoan_thanh,
  coalesce(sum(giam)  FILTER (WHERE status='completed'),0)    AS giam_gia_ap_dung,
  count(*) FILTER (WHERE status = ANY (ARRAY['draft','confirmed','completed']))
                                                              AS so_dong_theo_bo_loc
FROM loc;

-- ── A6. Lọc Giao hàng — chia kín, không nhân đôi (khoá tenant mọi nhánh) ──
WITH song AS (
  SELECT i.id FROM public.invoices i, tt
  WHERE i.tenant_id = tt.tenant_id AND i.deleted_at IS NULL
), co AS (
  SELECT s.id FROM song s WHERE EXISTS (
    SELECT 1 FROM public.shipping_orders so, tt
    WHERE so.invoice_id = s.id AND so.tenant_id = tt.tenant_id)
), khong AS (
  SELECT s.id FROM song s WHERE NOT EXISTS (
    SELECT 1 FROM public.shipping_orders so, tt
    WHERE so.invoice_id = s.id AND so.tenant_id = tt.tenant_id)
), noi_thuong AS (   -- cố tình JOIN thường để lộ chỗ nhân đôi nếu có
  SELECT s.id FROM song s
  JOIN public.shipping_orders so ON so.invoice_id = s.id
  JOIN tt ON so.tenant_id = tt.tenant_id
)
SELECT
  'A6. Anti-join' AS muc,
  (SELECT count(*) FROM song)  AS hd_con_song,
  (SELECT count(*) FROM co)    AS co_giao_hang,
  (SELECT count(*) FROM khong) AS khong_giao_hang,
  (SELECT count(*) FROM co) + (SELECT count(*) FROM khong) AS cong_lai,
  (SELECT count(*) FROM noi_thuong)           AS join_thuong_ra,
  (SELECT count(DISTINCT id) FROM noi_thuong) AS join_thuong_dem_rieng,
  CASE
    WHEN (SELECT count(*) FROM co)+(SELECT count(*) FROM khong)
       <> (SELECT count(*) FROM song) THEN '❌ chia KHÔNG kín'
    WHEN (SELECT count(*) FROM noi_thuong) <> (SELECT count(DISTINCT id) FROM noi_thuong)
      THEN '⚠ chia kín NHƯNG có HĐ nhiều vận đơn → BẮT BUỘC EXISTS, cấm JOIN thường'
    ELSE '✅ chia kín · hiện chưa HĐ nào có nhiều vận đơn'
  END AS ket_luan;

-- ── A7. Hoá đơn có công thức bất thường — BÁO CÁO, KHÔNG SỬA ────────────
SELECT
  'A7. Bất thường' AS muc, i.code, i.status, i.created_at::date AS ngay,
  i.subtotal, i.discount_amount, i.promotion_discount, i.tax_amount,
  i.delivery_fee, i.total,
  (coalesce(i.subtotal,0)-coalesce(i.discount_amount,0)-coalesce(i.promotion_discount,0)
   +coalesce(i.tax_amount,0)+coalesce(i.delivery_fee,0)) AS total_theo_cong_thuc,
  i.total-(coalesce(i.subtotal,0)-coalesce(i.discount_amount,0)-coalesce(i.promotion_discount,0)
   +coalesce(i.tax_amount,0)+coalesce(i.delivery_fee,0)) AS lech
FROM public.invoices i, tt
WHERE i.tenant_id = tt.tenant_id AND i.deleted_at IS NULL
  AND abs(i.total-(coalesce(i.subtotal,0)-coalesce(i.discount_amount,0)
       -coalesce(i.promotion_discount,0)+coalesce(i.tax_amount,0)
       +coalesce(i.delivery_fee,0))) > 1
ORDER BY abs(i.total-(coalesce(i.subtotal,0)-coalesce(i.discount_amount,0)
       -coalesce(i.promotion_discount,0)+coalesce(i.tax_amount,0)
       +coalesce(i.delivery_fee,0))) DESC;

-- ── A8. Số gốc để đối chiếu sau khi tạo hàm ─────────────────────────────
-- Ghi lại. Sau khi chạy 00305, gọi hàm KHÔNG tham số (đăng nhập bằng tài khoản
-- có quyền xem toàn công ty của tenant này) → phải khớp TỪNG ĐỒNG.
SELECT
  'A8. Số gốc' AS muc,
  count(*)                                                     AS tat_ca_hoa_don,
  count(*) FILTER (WHERE i.status='completed')                 AS hoan_thanh,
  count(*) FILTER (WHERE i.status='cancelled')                 AS da_huy,
  coalesce(sum(i.total) FILTER (WHERE i.status='completed'),0) AS gia_tri_hoan_thanh,
  coalesce(sum(coalesce(i.discount_amount,0)+coalesce(i.promotion_discount,0))
             FILTER (WHERE i.status='completed'),0)            AS giam_gia_ap_dung
FROM public.invoices i, tt
WHERE i.tenant_id = tt.tenant_id AND i.deleted_at IS NULL;

SELECT 'A8b. Trạng thái' AS muc, i.status, count(*) AS so_dong,
       count(*) FILTER (WHERE i.deleted_at IS NOT NULL) AS trong_do_da_xoa_mem
FROM public.invoices i, tt
WHERE i.tenant_id = tt.tenant_id
GROUP BY i.status ORDER BY 3 DESC;

-- Dọn view tạm (tự mất khi đóng phiên, lệnh này chỉ cho gọn)
DROP VIEW IF EXISTS tt;
