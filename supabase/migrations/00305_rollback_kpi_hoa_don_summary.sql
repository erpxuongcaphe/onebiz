-- ============================================================================
-- ROLLBACK 00305 — gỡ hàm tổng hợp KPI màn Hoá đơn
--
-- An toàn tuyệt đối: 00305 CHỈ tạo một hàm chỉ-đọc, không đụng bảng, cột,
-- ràng buộc, policy hay dữ liệu. Gỡ nó ra là hệ thống về đúng như trước.
--
-- Sau khi chạy tệp này, màn Hoá đơn phải được đưa về bản giao diện cũ
-- (bỏ đường dẫn khỏi danh sách bật) — nếu không, lời gọi hàm sẽ báo lỗi
-- "function does not exist" và dải chỉ số hiện rỗng.
-- ============================================================================

-- Ghi đủ chữ ký để không gỡ nhầm hàm trùng tên khác chữ ký.
DROP FUNCTION IF EXISTS public.get_invoice_list_summary(
  uuid, timestamptz, timestamptz, text[], text, text, text);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_invoice_list_summary'
  ) THEN
    RAISE EXCEPTION 'Rollback 00305 that bai: ham van con ton tai';
  END IF;
  RAISE NOTICE 'Rollback 00305: OK — da go get_invoice_list_summary';
END $$;
