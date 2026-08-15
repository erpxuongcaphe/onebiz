-- ============================================================================
-- ROLLBACK 00323 — gỡ 4 RPC cấu hình bàn & sơ đồ bàn (F1a)
--
-- 00323 CHỈ tạo hàm + quyền gọi, không đụng bảng/policy/dữ liệu — gỡ hàm là
-- hệ thống về đúng như trước. LƯU Ý: nếu bundle web đã chuyển sang gọi RPC
-- (PR F1a đã deploy) thì phải revert PR đó TRƯỚC rồi mới chạy rollback này,
-- nếu không các màn cấu hình bàn sẽ báo "function does not exist".
-- ============================================================================

drop function if exists public.fnb_table_config_atomic(text, uuid, jsonb);
drop function if exists public.fnb_floor_zone_config_atomic(text, uuid, jsonb);
drop function if exists public.fnb_floor_layout_update_atomic(jsonb);
drop function if exists public.fnb_floor_decoration_config_atomic(text, jsonb);

do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'fnb_table_config_atomic','fnb_floor_zone_config_atomic',
      'fnb_floor_layout_update_atomic','fnb_floor_decoration_config_atomic')
  ) then
    raise exception 'Rollback 00323 that bai: van con ham ton tai';
  end if;
  raise notice 'Rollback 00323: OK — da go 4 RPC cau hinh ban/so do';
end $$;
