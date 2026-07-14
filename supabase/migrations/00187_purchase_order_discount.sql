-- 00187_purchase_order_discount.sql
-- CEO 14/07/2026: Chiết khấu theo TỔNG tiền đơn ở phiếu nhập hàng
-- (ngoài chiết khấu theo từng mặt hàng đã có ở purchase_order_items.discount).
--
-- Bản chất: order_discount chỉ GHI LẠI số tiền chiết khấu ở cấp cả đơn để
-- reload/đối soát. Tổng phải trả (purchase_orders.total) + công nợ (debt) đã
-- được app trừ sẵn số này trước khi ghi, nên KHÔNG cần đụng gì cột total/debt.
-- Giá vốn nhập kho (WAC) tính theo unit_price từng dòng ở receive RPC 00028 —
-- KHÔNG dùng total/discount cấp đơn → chiết khấu cả đơn KHÔNG làm lệch giá vốn,
-- y hệt chiết khấu theo dòng + phí vận chuyển hiện có.
--
-- Additive, idempotent, không đụng dữ liệu cũ (mặc định 0 cho mọi phiếu cũ).

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS order_discount numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.purchase_orders.order_discount IS
  'Chiết khấu theo tổng tiền đơn (đ) — cấp cả phiếu, ngoài chiết khấu từng dòng ở purchase_order_items.discount. total/debt đã trừ sẵn số này. Không ảnh hưởng giá vốn (WAC).';

-- ── VERIFY (chạy tay, chỉ đọc) ────────────────────────────────────────────
-- 1) Cột đã tồn tại + kiểu numeric + default 0:
--    select column_name, data_type, column_default
--    from information_schema.columns
--    where table_name = 'purchase_orders' and column_name = 'order_discount';
-- 2) Mọi phiếu cũ = 0 (không phiếu nào bị đổi số):
--    select count(*) as tong_phieu,
--           count(*) filter (where order_discount = 0) as phieu_discount_0
--    from public.purchase_orders;
