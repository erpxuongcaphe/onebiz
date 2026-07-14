-- 00188_order_fulfilled_by.sql
-- CEO 14/07/2026 — "đúng logic đơn đặt hàng":
-- 1 ĐƠN ĐẶT HÀNG (source='order') có thể được xuất thành 1 HÓA ĐƠN RIÊNG
-- (số có thể khác đơn gốc do sửa khi bán). Khi đó đơn KHÔNG phải một lần bán
-- riêng ⇒ KHÔNG được tính doanh thu lần nữa, nhưng vẫn phải hiện "đã xử lý".
--
-- Cột fulfilled_by_id = đơn này đã được xuất thành hóa đơn nào.
--   · Có giá trị  ⇒ đơn hiện "Đã xuất hóa đơn"; loại khỏi danh sách "chưa xử lý"
--     ở POS + khỏi "Tổng cần thu"; GIỮ NGUYÊN status cũ (thường 'draft').
--   · Vì giữ status (không 'completed') nên MỌI báo cáo đếm status='completed'
--     (doanh thu, doanh thu theo mặt hàng) KHÔNG đụng tới ⇒ không đội số.
-- Additive, idempotent, không đổi status constraint, không đụng dữ liệu khác.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS fulfilled_by_id uuid REFERENCES public.invoices(id);

COMMENT ON COLUMN public.invoices.fulfilled_by_id IS
  'Đơn đặt hàng (source=order) đã được xuất thành hóa đơn này. Có giá trị ⇒ "đã xuất hóa đơn", không tính bán lần nữa (giữ status cũ, không completed).';

-- ── Dọn ca mồ côi DH000004 (bug "Xử lý đặt hàng" ở POS, 14/07) ──────────────
-- DH000004 (đơn đặt) đã bán thực tế qua HD001430 (hóa đơn — số khác do sửa khi
-- bán). Chỉ GẮN LINK để đơn hiện "Đã xuất hóa đơn".
-- KHÔNG đụng HD001430, KHÔNG đụng kho/tiền, KHÔNG xóa gì, KHÔNG đổi status.
-- Guard chặt theo id chính xác + chỉ khi chưa gắn link (idempotent).
update public.invoices
set fulfilled_by_id = 'd145d120-eafa-4b14-a495-5f6ce69e85dd'  -- HD001430 (hóa đơn bán thật)
where id = '54fcd6ba-915f-4390-9967-3f9f47e3dddf'            -- DH000004 (đơn đặt hàng gốc)
  and source = 'order'
  and fulfilled_by_id is null;

-- ── VERIFY (đọc tay, chỉ SELECT) ───────────────────────────────────────────
-- 1) Cột đã có:
--    select column_name, data_type from information_schema.columns
--    where table_name='invoices' and column_name='fulfilled_by_id';
-- 2) DH000004 đã gắn link + GIỮ status cũ (không completed):
--    select code, order_code, status, total, fulfilled_by_id
--    from public.invoices where id='54fcd6ba-915f-4390-9967-3f9f47e3dddf';
--    → fulfilled_by_id = 'd145d120-...', status vẫn 'draft' (KHÔNG đổi).
-- 3) HD001430 nguyên vẹn (không bị đụng):
--    select code, status, total, paid from public.invoices
--    where id='d145d120-eafa-4b14-a495-5f6ce69e85dd';
--    → status='completed', total=11145500, paid=11145500 (y như cũ).
