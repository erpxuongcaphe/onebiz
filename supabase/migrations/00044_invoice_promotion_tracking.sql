-- ============================================================
-- 00044_invoice_promotion_tracking.sql
--
-- Sprint KM-4 — Track promotion_id trên mỗi invoice để báo cáo
-- hiệu quả KM (revenue impact, top KM theo lượt + amount, ROI).
--
-- KM-2 chỉ increment usage_count. Để báo cáo CEO biết "KM nào sinh
-- ra bao nhiêu doanh thu / đã giảm bao nhiêu", cần link invoice →
-- promotion. Field thêm vào invoices:
--   - promotion_id:           promotion áp dụng (NULL = không có KM)
--   - promotion_discount:     số tiền giảm bởi KM (cap by total)
--   - promotion_free_value:   trị giá quà tặng (BOGO/gift), monetize
--                             để tính cost
-- ============================================================

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS promotion_id UUID
  REFERENCES public.promotions(id) ON DELETE SET NULL;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS promotion_discount NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS promotion_free_value NUMERIC NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.invoices.promotion_id IS
  'Promotion áp dụng cho hoá đơn này. NULL = không có KM. ON DELETE SET NULL để xoá KM cũ không phá invoice. Engine set ở POS checkout (KM-4).';

COMMENT ON COLUMN public.invoices.promotion_discount IS
  'Số tiền giảm BỞI KM cụ thể (đã loại trừ line discount + manual order discount). Dùng cho báo cáo "KM giảm bao nhiêu".';

COMMENT ON COLUMN public.invoices.promotion_free_value IS
  'Trị giá hàng tặng kèm (BOGO + gift) — sum(freeItems.qty × unitPrice). Dùng cho báo cáo "chi phí KM" và P&L (deduction from gross).';

-- Index cho query báo cáo: promotion_id + status
CREATE INDEX IF NOT EXISTS idx_invoices_promotion
  ON public.invoices (tenant_id, promotion_id, status, created_at)
  WHERE promotion_id IS NOT NULL;
