-- 00206 — Thẻ kho Đợt 6b: trigger tự ghi giá vào sổ lúc INSERT.
-- Thay vì sửa ~26 điểm ghi (dễ sót/rủi ro), 1 trigger điền giá tại đúng
-- thời điểm bán/nhập cho MỌI dòng mới:
--   unit_cost  = products.cost_price hiện tại (giá vốn lúc đó — dùng cho XUẤT)
--   unit_price = đơn giá phiếu nhập (giá nhập theo đợt — cho dòng NHẬP mua)
-- Chỉ điền khi cột đang NULL (không đè giá code chủ động ghi). Dòng cũ giữ NULL.

CREATE OR REPLACE FUNCTION public.fill_stock_movement_price()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.product_id IS NOT NULL AND NEW.unit_cost IS NULL THEN
    SELECT cost_price INTO NEW.unit_cost FROM products WHERE id = NEW.product_id;
  END IF;

  -- Giá nhập theo đợt: chỉ với dòng nhập mua (reference_id trỏ purchase_orders).
  IF NEW.unit_price IS NULL
     AND NEW.reference_id IS NOT NULL
     AND NEW.reference_type IN ('purchase_order','po_receive','goods_receipt','purchase_entry')
  THEN
    SELECT unit_price INTO NEW.unit_price
    FROM purchase_order_items
    WHERE purchase_order_id = NEW.reference_id AND product_id = NEW.product_id
    LIMIT 1;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_fill_stock_movement_price ON public.stock_movements;
CREATE TRIGGER trg_fill_stock_movement_price
  BEFORE INSERT ON public.stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.fill_stock_movement_price();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_fill_stock_movement_price') THEN
    RAISE EXCEPTION '00206 FAIL: trigger chưa tạo';
  END IF;
  RAISE NOTICE '00206 OK: trigger ghi giá đã bật cho dòng sổ MỚI.';
END $$;
