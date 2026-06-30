-- ============================================================
-- Migration 00154: NẮN LẠI invoices.debt bị lệch (CEO 30/06/2026)
-- ============================================================
-- TRIỆU CHỨNG (CEO báo): HD001328 total = 40.000, paid = 40.000 (đã trả đủ)
--   NHƯNG debt = 40.000 → trang Công nợ hiện "còn nợ 40.000" SAI (đáng lẽ 0).
--
-- CHẨN ĐOÁN (đọc service-role, read-only):
--   - Quét 119 đơn (trừ huỷ): CHỈ 1 đơn lệch (HD001328). 118 đơn còn lại
--     debt = GREATEST(total - paid, 0) đúng → KHÔNG phải lỗi hệ thống tràn lan,
--     chỉ là 1 bản ghi lạc (straggler).
--   - invoices.debt là NGUỒN cho trigger 00130 (trg_sync_customer_debt) →
--     customers.debt = SUM(invoices.debt completed). Nên debt đơn sai kéo theo
--     công nợ KH "Xưởng Tư Búa" sai 40.000. Dialog Công nợ đọc đúng cột debt,
--     lỗi nằm ở GIÁ TRỊ cột, không phải ở code hiển thị.
--
-- FIX: nắn per-invoice debt về đúng ĐỊNH NGHĨA của chính nó = GREATEST(total-paid,0)
--   cho MỌI đơn đang lệch (idempotent — chỉ chạm dòng sai, hiện là 1).
--   Trigger 00130 tự đồng bộ customers.debt; gọi recompute_all_customer_debts()
--   để chắc chắn 100% aggregate khớp.
--
-- AN TOÀN:
--   - CHỈ sửa cột debt cho khớp công thức của nó (total - paid). KHÔNG đụng
--     total / paid / trạng thái / dòng hàng / lịch sử. Không xoá gì.
--   - Idempotent: chạy lại nhiều lần không đổi thêm (WHERE lọc đúng dòng lệch).
-- ============================================================

UPDATE public.invoices
SET debt = GREATEST(total - paid, 0)
WHERE status <> 'cancelled'
  AND debt IS DISTINCT FROM GREATEST(total - paid, 0);

-- Đồng bộ lại toàn bộ công nợ KH từ invoice debt đã nắn đúng (an toàn, idempotent).
SELECT public.recompute_all_customer_debts();

-- Kiểm tra nhanh sau khi chạy (đếm số đơn còn lệch — phải = 0):
--   SELECT COUNT(*) FROM public.invoices
--   WHERE status <> 'cancelled' AND debt IS DISTINCT FROM GREATEST(total - paid, 0);
