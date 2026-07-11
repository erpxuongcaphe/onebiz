-- ============================================================
-- Migration 00173: Soft-delete cho invoices + bảo vệ đơn đặt hàng khỏi auto-xóa
-- ============================================================
--
-- BỐI CẢNH (sự cố 11/07/2026):
-- Đơn đặt hàng (source='order') bị XÓA CỨNG mất khi mở trong POS rồi xóa giỏ.
-- Chuỗi lỗi: tạo đơn (auto_saved=false) → mở trong POS → auto-save lật
-- auto_saved=true → giỏ trống → deleteDraftOrder(onlyAutoSaved:true) khớp →
-- DELETE CỨNG (CASCADE dòng hàng). Bảng invoices KHÔNG có soft-delete nên mất
-- không khôi phục được, không để lại vết.
--
-- MIGRATION NÀY (KHÔNG đụng dữ liệu cũ — chỉ thêm cột NULL + sửa 1 function):
--  1. Thêm cột `deleted_at` (soft-delete). Code chuyển deleteDraftOrder sang
--     SET deleted_at thay vì DELETE → khôi phục được bằng cách set lại NULL.
--  2. Sửa cleanup_expired_auto_drafts: KHÔNG bao giờ đụng source='order',
--     bỏ qua row đã soft-delete, và cũng chuyển sang SOFT-delete (giữ để cứu).
--
-- Lưu ý: soft-delete chỉ áp cho đơn NHÁP (status='draft'). Hóa đơn hoàn tất
-- không bao giờ bị xóa. Guard code (00173) chặn hẳn source='order'.
-- ============================================================

-- 1. Cột soft-delete ------------------------------------------------------
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

COMMENT ON COLUMN public.invoices.deleted_at IS
  'Soft-delete: NULL = còn sống; có giá trị = đã xóa mềm (khôi phục bằng cách set NULL lại). Chỉ áp cho đơn nháp; hóa đơn hoàn tất và đơn đặt hàng không bị xóa.';

-- Partial index: gần như mọi query đọc lọc deleted_at IS NULL.
CREATE INDEX IF NOT EXISTS idx_invoices_alive
  ON public.invoices (tenant_id, status)
  WHERE deleted_at IS NULL;

-- 2. Cleanup 30 ngày: bảo vệ đơn đặt hàng + soft-delete thay vì xóa cứng ----
CREATE OR REPLACE FUNCTION public.cleanup_expired_auto_drafts(
  p_tenant_id uuid,
  p_days integer DEFAULT 30
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  -- Soft-delete auto-drafts kỹ thuật quá hạn. TUYỆT ĐỐI KHÔNG đụng:
  --  - source='order' (đơn đặt hàng — chỉ được "Hủy" giữ bản ghi, không auto-xóa)
  --  - row đã soft-delete rồi (deleted_at IS NOT NULL) — idempotent
  UPDATE public.invoices
  SET deleted_at = NOW()
  WHERE tenant_id = p_tenant_id
    AND status = 'draft'
    AND auto_saved = true
    AND deleted_at IS NULL
    AND (source IS DISTINCT FROM 'order')
    AND updated_at < NOW() - (p_days || ' days')::INTERVAL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_expired_auto_drafts(uuid, integer) TO authenticated;

COMMENT ON FUNCTION public.cleanup_expired_auto_drafts IS
  'Soft-delete auto-saved drafts (auto_saved=TRUE) quá p_days ngày (mặc định 30). KHÔNG đụng source=order (đơn đặt hàng) và row đã xóa mềm. F9 manual (auto_saved=false) giữ vĩnh viễn.';

-- ============================================================
-- VERIFY (chạy tay sau khi apply — read-only)
-- ============================================================
-- 1) Cột đã có:
--    SELECT column_name FROM information_schema.columns
--     WHERE table_name='invoices' AND column_name='deleted_at';
-- 2) Không có đơn nào bị xóa mềm oan ngay sau migration (phải = 0):
--    SELECT count(*) FROM public.invoices WHERE deleted_at IS NOT NULL;
-- 3) Function đã chặn source='order' (đọc định nghĩa):
--    SELECT pg_get_functiondef('public.cleanup_expired_auto_drafts(uuid,integer)'::regprocedure);
