-- ============================================================================
-- 00327 — F1b: thu hồi quyền ghi thẳng 3 bảng cấu hình bàn
--
-- ⚠️ CHỈ CHẠY KHI CEO XÁC NHẬN, sau 24–48h dùng ổn định F1a (00323/00324).
--
-- Sau migration này, trình duyệt KHÔNG còn ghi thẳng vào 3 bảng được nữa —
-- mọi thay đổi phải đi qua 4 RPC của 00323. Đây là bước biến "khuyến khích
-- dùng RPC" thành "chỉ còn RPC".
--
-- ĐIỀU KIỆN ĐÃ KIỂM TRƯỚC KHI VIẾT TỆP NÀY:
--   • Đã quét toàn bộ mã nguồn (kể cả import động, barrel, bundle đã build):
--     không còn INSERT/UPDATE/DELETE trực tiếp vào 3 bảng.
--   • Đường ghi cuối cùng (`cancelKitchenOrder`) đã xoá ở PR dọn mã chết.
--   • 4 RPC 00323 là SECURITY DEFINER nên KHÔNG bị ảnh hưởng bởi việc thu hồi.
--   • RPC vận hành bàn (00275/00321/00322) cũng SECURITY DEFINER → chuyển/gộp/
--     nhả bàn của Phục vụ vẫn chạy bình thường.
--
-- KHÔNG đụng: RLS, bảng, cột, dữ liệu, audit_log (audit_log tách đợt A1 riêng).
-- GIỮ NGUYÊN quyền SELECT để mọi màn đọc dữ liệu như cũ.
-- ============================================================================

revoke insert, update, delete, truncate on public.restaurant_tables      from authenticated;
revoke insert, update, delete, truncate on public.floor_plan_zones       from authenticated;
revoke insert, update, delete, truncate on public.floor_plan_decorations from authenticated;

-- anon lẽ ra đã sạch từ 00239 — chạy lại cho chắc, không hại gì.
revoke insert, update, delete, truncate on public.restaurant_tables      from anon;
revoke insert, update, delete, truncate on public.floor_plan_zones       from anon;
revoke insert, update, delete, truncate on public.floor_plan_decorations from anon;

-- ── Hậu kiểm ──
do $$
declare
  v_con  int;
  v_doc  int;
  v_rpc  int;
begin
  -- 1. Không còn quyền ghi nào sót lại
  select count(*) into v_con
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name in ('restaurant_tables','floor_plan_zones','floor_plan_decorations')
    and grantee in ('authenticated','anon')
    and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE');
  if v_con <> 0 then
    raise exception '00327 that bai: van con % quyen ghi truc tiep', v_con;
  end if;

  -- 2. Quyền ĐỌC phải còn nguyên, nếu không thì mọi màn bàn sẽ trắng
  select count(*) into v_doc
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name in ('restaurant_tables','floor_plan_zones','floor_plan_decorations')
    and grantee = 'authenticated'
    and privilege_type = 'SELECT';
  if v_doc <> 3 then
    raise exception '00327 that bai: quyen SELECT bi mat (con % / 3 bang)', v_doc;
  end if;

  -- 3. 4 RPC cấu hình phải còn sống — không có chúng thì web hết đường ghi
  select count(*) into v_rpc
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and p.proname in ('fnb_table_config_atomic','fnb_floor_zone_config_atomic',
                      'fnb_floor_layout_update_atomic','fnb_floor_decoration_config_atomic');
  if v_rpc <> 4 then
    raise exception '00327 that bai: chi thay % / 4 RPC cau hinh (SECURITY DEFINER)', v_rpc;
  end if;

  raise notice '00327: OK — da thu hoi ghi thang 3 bang, giu SELECT, 4 RPC con song';
end $$;
