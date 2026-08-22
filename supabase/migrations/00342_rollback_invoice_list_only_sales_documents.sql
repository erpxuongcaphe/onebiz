-- ============================================================================
-- 00342 HOÀN TÁC — trả get_invoice_list_summary về ĐÚNG bản đã chụp trước khi vá
--
-- Không dựng lại thân hàm bằng tay: chạy thẳng `def_truoc` trong bản chụp bất
-- biến `rpc_backup_chung_tu_ban`. Nhờ vậy dù nền là 00305 hay 00339 thì hoàn
-- tác vẫn về đúng trạng thái thực tế lúc chạy 00342.
--
-- KHÔNG đụng dữ liệu. Chỉ định nghĩa hàm.
--
-- ⚠️ NGUYÊN TỬ: khôi phục hàm và hậu kiểm nằm trong MỘT transaction. Không bọc
-- thì một lỗi giữa chừng để lại RPC nửa cũ nửa mới — đúng thứ khó phát hiện
-- nhất vì hàm vẫn chạy, chỉ cho số sai.
-- ============================================================================

begin;

do $hoan_tac$
declare
  r record;
  v_n int := 0;
begin
  for r in
    select ham_oid, chu_ky, def_truoc
    from public.rpc_backup_chung_tu_ban
    where migration = '00342'
  loop
    execute r.def_truoc;
    v_n := v_n + 1;
  end loop;

  if v_n = 0 then
    raise exception
      'Hoan tac 00342 DUNG: khong co dong nao trong rpc_backup_chung_tu_ban. '
      'Co the 00342 chua tung chay tren CSDL nay.';
  end if;
  raise notice 'Hoan tac 00342: da khoi phuc % ham', v_n;
end $hoan_tac$;

-- ── Hậu kiểm: định nghĩa hiện tại phải TRÙNG bản chụp, và sạch marker ──────
do $kiem$
declare
  v_lech int;
  v_con  int;
begin
  select count(*) into v_lech
  from public.rpc_backup_chung_tu_ban b
  join pg_proc p on p.oid = b.ham_oid
  where b.migration = '00342'
    and pg_get_functiondef(p.oid) is distinct from b.def_truoc;
  if v_lech <> 0 then
    raise exception 'Hoan tac 00342 THAT BAI: % ham chua trung ban chup. CUON LAI.', v_lech;
  end if;

  select count(*) into v_con
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_invoice_list_summary'
    and position('CHUNG_TU_BAN_00342' in pg_get_functiondef(p.oid)) > 0;
  if v_con <> 0 then
    raise exception 'Hoan tac 00342 THAT BAI: van con marker CHUNG_TU_BAN_00342. CUON LAI.';
  end if;

  raise notice 'Hoan tac 00342: DAT — hàm trùng bản chụp, sạch marker.';
end $kiem$;

commit;

notify pgrst, 'reload schema';

-- Giữ lại bảng chụp (không DROP): là sử liệu, và cho phép chạy lại 00342.
