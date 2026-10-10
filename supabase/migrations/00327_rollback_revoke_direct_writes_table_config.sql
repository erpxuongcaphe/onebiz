-- ============================================================================
-- ROLLBACK 00327 — cấp lại đúng quyền ghi đã thu hồi ở F1b
--
-- Dùng khi phát hiện một màn nào đó vẫn cần ghi thẳng và cần mở lại gấp trong
-- giờ bán. Cấp lại ĐÚNG 4 quyền đã thu hồi, cho ĐÚNG vai trò `authenticated`.
--
-- KHÔNG cấp lại cho `anon` — vai trò này vốn đã sạch từ 00239, cấp lại là mở
-- cửa cho người chưa đăng nhập, không phải "trả về như cũ".
-- ============================================================================

grant insert, update, delete, truncate on public.restaurant_tables      to authenticated;
grant insert, update, delete, truncate on public.floor_plan_zones       to authenticated;
grant insert, update, delete, truncate on public.floor_plan_decorations to authenticated;

do $$
declare v_con int;
begin
  select count(*) into v_con
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name in ('restaurant_tables','floor_plan_zones','floor_plan_decorations')
    and grantee = 'authenticated'
    and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE');
  if v_con <> 12 then
    raise exception 'Rollback 00327 chua du: moi cap lai % / 12 quyen', v_con;
  end if;
  raise notice 'Rollback 00327: da cap lai 12 quyen ghi cho authenticated (anon van sach)';
end $$;
