-- ============================================================
-- 00194: Gỡ nốt tầng cuối — ràng buộc CỨNG ở bảng mkt_tasks
--
-- CEO 15/07: bấm "Duyệt & sinh việc" → lỗi
--   new row for relation "mkt_tasks" violates check constraint "mkt_tasks_check"
--
-- Luật "công đoạn Duyệt/Đăng phải gắn nội dung" nằm ở BA tầng. 00193 mới gỡ 2:
--   1. mkt_submit_plan (00182:112)  — chặn lúc nộp kế hoạch   → ĐÃ gỡ (00193)
--   2. mkt_start_task  (00174:327)  — chặn lúc bắt đầu việc   → ĐÃ gỡ (00193)
--   3. mkt_tasks_check (00168:153)  — CHECK cấp bảng          → GỠ Ở ĐÂY
--        check (task_type not in ('review','publish') or content_item_id is not null)
--
-- Vì bỏ sót tầng 3 nên kế hoạch NỘP được (tầng 1 đã mở) nhưng DUYỆT thì chết:
-- mkt_generate_tasks_from_plan_internal insert task 'publish' với
-- content_item_id = null → bảng đá ra.
--
-- Vì sao gỡ (nhất quán với 00193): lập kế hoạch là việc TƯƠNG LAI — chính kế
-- hoạch mới đẻ ra nội dung. Ràng buộc cứng ở bảng buộc phải khai báo nội dung
-- trước khi nó tồn tại. An toàn đã chuyển sang dạng CÓ ĐIỀU KIỆN trong
-- mkt_start_task / mkt_mark_task_done: CÓ gắn nội dung → bắt buộc đã duyệt mới
-- đăng; KHÔNG gắn → là việc thường.
--
-- Ràng buộc này cũng đang ngầm chặn màn "Chia Task Ngay" (00193 đã nới UI của
-- nó) → gỡ ở đây là xong cả 2 luồng.
--
-- Các rào KHÁC giữ nguyên, không đụng:
--   • trigger tenant-link (00174/00176/00180): chỉ soi KHI có gắn nội dung.
--   • mkt_submit_content_for_review: nộp bài duyệt thì đương nhiên cần nội dung.
--   • FK content_item_id → mkt_content_items: vẫn chặn id rác.
-- ============================================================

alter table public.mkt_tasks drop constraint if exists mkt_tasks_check;

notify pgrst, 'reload schema';
