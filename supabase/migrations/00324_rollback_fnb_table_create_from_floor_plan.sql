-- ============================================================================
-- ROLLBACK 00324 — trả fnb_table_config_atomic về đúng bản 00323
--
-- 00324 chỉ đổi THÂN hàm (thêm lối tạo bàn từ sơ đồ). Rollback = chạy lại
-- nguyên văn tệp 00323_fnb_table_config_rpcs.sql — nó dùng CREATE OR REPLACE
-- nên ghi đè an toàn, không đụng bảng/dữ liệu.
--
-- CẢNH BÁO: sau khi lui, vai trò chỉ có floor_plan.edit_* (ví dụ "Quản lý")
-- sẽ KHÔNG thêm được bàn từ màn Sơ đồ bàn — đúng hành vi 00323, nhưng hẹp hơn
-- những gì họ làm được trước F1a.
-- ============================================================================

do $$
begin
  raise notice 'Rollback 00324: chay lai nguyen van 00323_fnb_table_config_rpcs.sql';
  raise exception 'Chua chay gi ca — hay mo tep 00323_fnb_table_config_rpcs.sql va chay lai noi dung do.';
end $$;
