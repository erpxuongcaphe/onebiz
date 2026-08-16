-- ============================================================================
-- ROLLBACK 00328 — cấp lại quyền sửa/xoá sổ nhật ký cho authenticated
--
-- Chỉ dùng nếu phát hiện một chức năng thật sự cần sửa/xoá nhật ký. Lưu ý:
-- cấp lại nghĩa là nhân viên lại xoá được dấu vết thao tác của mình.
-- KHÔNG cấp lại cho anon (vốn đã sạch).
-- ============================================================================

grant update, delete, truncate on public.audit_log to authenticated;

do $$
declare v_con int;
begin
  select count(*) into v_con
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'audit_log'
    and grantee = 'authenticated'
    and privilege_type in ('UPDATE','DELETE','TRUNCATE');
  if v_con <> 3 then
    raise exception 'Rollback 00328 chua du: moi cap lai % / 3 quyen', v_con;
  end if;
  raise notice 'Rollback 00328: da cap lai 3 quyen sua/xoa nhat ky cho authenticated';
end $$;
