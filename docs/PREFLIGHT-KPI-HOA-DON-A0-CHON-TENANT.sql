-- ============================================================================
-- PREFLIGHT KPI HOÁ ĐƠN — BƯỚC A0: CHỌN TENANT   08/08/2026
--
-- CHỈ ĐỌC. Một câu SELECT duy nhất. Không đụng gì.
--
-- Vì sao tách riêng: bấm Run là chạy cả tệp, không dừng theo lời chú thích
-- được. Nên bước xác nhận tenant phải là MỘT TỆP RIÊNG, chạy xong nhìn mắt.
--
-- CÁCH DÙNG
--   1. Chạy tệp này.
--   2. Nhìn cột `ten_tenant`, tìm đúng dòng OneBiz.
--   3. Copy `tenant_id` của dòng đó.
--   4. Mở PREFLIGHT-KPI-HOA-DON-A1-A8.sql, dán UUID vào đúng chỗ đánh dấu
--      ở đầu tệp, rồi mới chạy.
-- ============================================================================

SELECT
  t.id                              AS tenant_id,
  t.name                            AS ten_tenant,
  t.slug                            AS ma_ngan,
  count(i.id)                       AS so_hoa_don,
  count(i.id) FILTER (WHERE i.deleted_at IS NULL) AS so_hoa_don_con_song,
  min(i.created_at)::date           AS hoa_don_dau_tien,
  max(i.created_at)::date           AS hoa_don_gan_nhat
FROM public.tenants t
LEFT JOIN public.invoices i ON i.tenant_id = t.id
GROUP BY t.id, t.name, t.slug
ORDER BY count(i.id) DESC;
