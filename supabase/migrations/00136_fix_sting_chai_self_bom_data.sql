-- ============================================================
-- Migration 00136: DỌN DATA Sting Chai — sự cố BOM tự-tham-chiếu
-- ============================================================
--
-- CEO 10/06/2026 — bối cảnh:
--   SKU "Sting Chai" (NVL-KHO-006, ĐVT gốc = chai) từng bị gắn BOM
--   "Công thức cho Sting Chai" = 24 × chính nó (self-referential), nhằm
--   bán theo thùng (1 thùng = 24 chai). Vì SKU bán VÀ NVL tiêu hao là
--   CÙNG 1 mã → mỗi đơn vị bán tự trừ chính nó ×24.
--
--   Hóa đơn HD001218 (06-05, bán THẬT 24 chai) → consume_bom = 24×24 = 576
--   → 1 phiếu stock_movements 'out' 576 chai (RÁC) → branch_stock = -504.
--
--   CEO đã GỠ BOM (products.has_bom=false, bom_code=null) nhưng phiếu 576
--   vẫn nằm trong sổ cái → tồn vẫn sai.
--
-- TỒN ĐÚNG (CEO xác nhận HD001218 bán thật 24 chai):
--   +48 +48 −48 (đầu kỳ ghi đè) +24 (mua PO000047) −24 (bán HD001218) = 48
--
-- FIX (chỉ tác động DUY NHẤT sản phẩm NVL-KHO-006):
--   1. Sửa phiếu rác 576 → 24 (đúng số bán thật), ghi rõ lý do vào note.
--   2. Recompute branch_stock Sting Chai từ sổ cái đã sửa → 48.
--   3. Recompute products.stock = SUM(branch_stock) → 48.
--
-- Sau migration: cả 2 trang (/hang-hoa = 48, /hang-hoa/ton-kho = 48) khớp,
-- POS Retail hiện lại Sting Chai (hết tồn âm).
--
-- Bán thùng đúng cách: dùng ĐƠN VỊ QUY ĐỔI (1 thùng = 24 chai) ở form SP,
-- KHÔNG dùng BOM. Guard chặn BOM tự-ăn đã thêm ở migration 00135 v2.
-- ============================================================

-- 1. Sửa phiếu rác 576 → 24 (giữ bản ghi, ghi rõ lý do — không xóa cứng)
UPDATE public.stock_movements
SET quantity = 24,
    note = 'Bán 24 chai Sting Chai (HD001218). [SỬA 10/06/2026: phiếu gốc 576 '
        || 'do BOM tự-tham-chiếu sai 24×24 — đã chỉnh về 24 = số bán thật]'
WHERE product_id = (SELECT id FROM public.products WHERE code = 'NVL-KHO-006')
  AND reference_type = 'bom_consume'
  AND quantity = 576;

-- 2. Recompute branch_stock Sting Chai từ sổ cái (đã sửa) — per branch
UPDATE public.branch_stock bs
SET quantity = (
      SELECT COALESCE(SUM(CASE WHEN sm.type = 'in' THEN sm.quantity
                               ELSE -sm.quantity END), 0)
        FROM public.stock_movements sm
       WHERE sm.product_id = bs.product_id
         AND sm.branch_id = bs.branch_id
    ),
    updated_at = now()
WHERE bs.product_id = (SELECT id FROM public.products WHERE code = 'NVL-KHO-006');

-- 3. Recompute products.stock = SUM(branch_stock) cho Sting Chai
UPDATE public.products p
SET stock = (
      SELECT COALESCE(SUM(quantity), 0)
        FROM public.branch_stock bs
       WHERE bs.product_id = p.id
    )
WHERE p.code = 'NVL-KHO-006';

-- 4. Kiểm tra kết quả (mong đợi: cả 3 cột = 48)
DO $$
DECLARE
  v_products_stock numeric;
  v_branch_stock   numeric;
  v_ledger         numeric;
BEGIN
  SELECT p.stock,
         (SELECT COALESCE(SUM(quantity),0) FROM public.branch_stock bs WHERE bs.product_id = p.id),
         (SELECT COALESCE(SUM(CASE WHEN type='in' THEN quantity ELSE -quantity END),0)
            FROM public.stock_movements sm WHERE sm.product_id = p.id)
    INTO v_products_stock, v_branch_stock, v_ledger
    FROM public.products p WHERE p.code = 'NVL-KHO-006';

  RAISE NOTICE 'Sting Chai sau fix → products.stock=%, branch_stock=%, sổ cái=% (mong đợi 48/48/48)',
    v_products_stock, v_branch_stock, v_ledger;
END $$;
