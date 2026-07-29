-- ============================================================
-- 00233 — GẤP: không huỷ được phiếu nhập (lỗi 23514 product_lots_status_check)
-- ============================================================
-- CEO gặp 29/07 khi huỷ PO000161:
--   [reopenPurchaseOrderForEdit] new row for relation "product_lots"
--   violates check constraint "product_lots_status_check" (code: 23514)
--
-- GỐC
-- Ba hàm hoàn nhập (00120, 00149, 00214) đều đặt lô đã tiêu hao một phần
-- thành `status = 'cancelled'`. Nhưng ràng buộc từ 00006 chỉ nhận
--   ('active', 'expired', 'consumed', 'disposed')
-- → 'cancelled' CHƯA BAO GIỜ hợp lệ. Mọi lần chạy vào nhánh đó đều chết.
--
-- VÌ SAO ĐẾN GIỜ MỚI NỔ
-- Nhánh này chỉ chạy khi lô đã dùng dở (current_qty < initial_qty). Lô còn
-- nguyên thì rơi vào nhánh DELETE ở trên, không đụng status. Các phiếu huỷ
-- trước đây đều là lô nguyên vẹn nên lọt. PO000161 là ca đầu tiên có hàng
-- đã bán bớt → chạm đúng dòng hỏng.
-- Bằng chứng: DB hiện chỉ có status 'active' (156) và 'consumed' (267),
-- KHÔNG có lô 'cancelled' nào — vì chưa lần nào ghi được.
--
-- SỬA: nới ràng buộc để nhận 'cancelled'.
-- Chọn nới thay vì đổi giá trị trong 3 hàm, vì 'cancelled' mô tả ĐÚNG tình
-- trạng: lô thuộc phiếu nhập đã huỷ nhưng hàng đã tiêu thụ một phần, phải
-- giữ lại làm dấu vết chứ không xoá.
--
-- AN TOÀN: mọi chỗ đọc lô đều lọc theo 'active' (hoặc 'active','expired')
-- nên lô 'cancelled' tự động bị loại khỏi tồn và khỏi phân bổ FIFO — đúng
-- ý muốn. Không đụng một dòng dữ liệu nào.
-- ============================================================

alter table public.product_lots
  drop constraint if exists product_lots_status_check;

alter table public.product_lots
  add constraint product_lots_status_check
  check (status in ('active', 'expired', 'consumed', 'disposed', 'cancelled'));

-- ============================================================
-- ĐỐI CHIẾU
-- ============================================================
-- Phải thấy 'cancelled' trong danh sách:
-- select pg_get_constraintdef(oid)
--   from pg_constraint
--  where conname = 'product_lots_status_check';
--
-- Sau khi anh huỷ lại PO000161, xem lô bị đánh dấu:
-- select lot_number, status, initial_qty, current_qty, note
--   from public.product_lots
--  where status = 'cancelled';
