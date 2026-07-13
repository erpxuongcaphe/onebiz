-- ============================================================
-- Migration 00179: invoices.amount_tendered — tiền khách đưa thực tế tại quầy
-- ============================================================
--
-- BỐI CẢNH (CEO 13/07/2026): phiếu in ở POS có "Khách đã thanh toán" = tiền
-- khách ĐƯA THỰC (vd đưa 500k cho đơn 480k) + "Tiền thối lại". Nhưng hóa đơn
-- chỉ lưu số đã thu net (paid=480k) → IN LẠI từ trang Hóa đơn không tái hiện
-- được đúng 2 dòng này. Thêm cột lưu "tiền khách đưa" để 2 bản in KHỚP nhau.
--
-- - NULL = không ghi nhận (đơn cũ, chuyển khoản đủ, khách công nợ) → in lại
--   dùng paid như cũ, KHÔNG bịa số.
-- - Ghi bởi POS sau khi thanh toán thành công (best-effort, không block).
-- KHÔNG đụng dữ liệu cũ.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS amount_tendered numeric;

COMMENT ON COLUMN public.invoices.amount_tendered IS
  'Tiền khách đưa thực tế lúc thanh toán tại POS (>= paid khi có thối). NULL = không ghi nhận (đơn cũ/CK đủ/công nợ). In lại hóa đơn dùng để tái hiện "Khách đã thanh toán" + "Tiền thối lại" khớp phiếu POS.';

-- ============================================================
-- VERIFY (chạy tay sau khi apply — read-only)
-- ============================================================
-- 1) Cột đã có:
--    SELECT column_name, data_type FROM information_schema.columns
--     WHERE table_name='invoices' AND column_name='amount_tendered';
-- 2) Chưa đơn nào có giá trị (chỉ đơn MỚI sau deploy mới ghi):
--    SELECT count(*) FROM public.invoices WHERE amount_tendered IS NOT NULL;
