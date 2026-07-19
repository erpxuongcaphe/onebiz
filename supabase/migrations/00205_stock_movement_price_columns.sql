-- =====================================================================
-- 00205 — Thẻ kho Đợt 6a: 2 cột GIÁ trên sổ kho (stock_movements)
-- CEO 19/07/2026 chọn "cách nặng" (chính xác lịch sử): khắc giá vào sổ
-- ngay lúc bán/nhập. Đây là bước NỀN — chỉ thêm 2 cột NULLABLE:
--   • unit_cost  : đơn giá VỐN tại thời điểm ghi (dùng cho dòng XUẤT)
--   • unit_price : đơn giá GIAO DỊCH tại thời điểm ghi (giá nhập theo đợt
--                  cho dòng NHẬP; giá bán nếu cần)
--
-- AN TOÀN:
--   - NULLABLE, KHÔNG DEFAULT ràng buộc → mọi INSERT cũ (không truyền 2 cột
--     này) VẪN CHẠY BÌNH THƯỜNG. Không cần sửa writer nào ở bước 6a.
--   - KHÔNG backfill ở đây → dòng lịch sử giữ nguyên (NULL = "chưa ghi giá",
--     UI hiện "—"). Backfill 55% từ audit_log làm ở bước 6d, sau khi các
--     điểm ghi (6b/6c) đã bắt đầu ghi giá cho dòng MỚI.
--   - numeric(18,4): đủ cho đơn giá VND lẫn giá vốn lẻ (WAC có phần thập phân).
-- =====================================================================

ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS unit_cost  numeric(18,4),
  ADD COLUMN IF NOT EXISTS unit_price numeric(18,4);

COMMENT ON COLUMN public.stock_movements.unit_cost IS
  'Đợt 6 (19/07): đơn giá vốn tại thời điểm ghi sổ (WAC lúc đó). NULL = dòng cũ chưa ghi giá.';
COMMENT ON COLUMN public.stock_movements.unit_price IS
  'Đợt 6 (19/07): đơn giá giao dịch tại thời điểm ghi (giá nhập theo đợt / giá bán). NULL = chưa ghi.';

-- =====================================================================
-- VERIFY (đọc sau khi chạy — không thay đổi dữ liệu)
-- =====================================================================
DO $$
DECLARE
  has_cost boolean;
  has_price boolean;
BEGIN
  SELECT
    bool_or(column_name = 'unit_cost'),
    bool_or(column_name = 'unit_price')
  INTO has_cost, has_price
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'stock_movements';

  IF NOT has_cost OR NOT has_price THEN
    RAISE EXCEPTION '00205 FAIL: thiếu cột unit_cost/unit_price';
  END IF;
  RAISE NOTICE '00205 OK: stock_movements đã có unit_cost + unit_price (nullable). Chưa backfill (đúng chủ đích).';
END $$;
