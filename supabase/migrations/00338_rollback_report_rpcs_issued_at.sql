-- ============================================================================
-- 00338 HOÀN TÁC — trả 3 RPC Khách × Sản phẩm về ĐÚNG thân hàm trước khi vá
--
-- ⚠️ Sau khi hoàn tác, trang Khách × Sản phẩm sẽ LỆCH SỐ so với các trang báo
-- cáo khác đúng vào những hóa đơn được chỉnh ngày. Chỉ chạy khi 00338 gây sự
-- cố thật.
--
-- TỰ ĐỦ: khôi phục từ ảnh chụp `public.rpc_backup_ngay_hoa_don` do chính 00338
-- ghi trước khi vá — khôi phục đúng BẢN ĐANG CHẠY, không phụ thuộc bản trong
-- repo và không cần chạy thêm migration nào khác.
--
-- KHÔNG đụng dữ liệu — chỉ đổi thân hàm. Idempotent.
-- ============================================================================

begin;

do $kiem$
declare v_n int;
begin
  if to_regclass('public.rpc_backup_ngay_hoa_don') is null then
    raise exception
      'HOANTAC_00338: không có bảng ảnh chụp public.rpc_backup_ngay_hoa_don — '
      'không thể hoàn tác chính xác. DỪNG. (Ảnh chụp do chính 00338 ghi lúc vá.)';
  end if;
  select count(*) into v_n from public.rpc_backup_ngay_hoa_don where migration = '00338';
  if v_n = 0 then
    raise exception
      'HOANTAC_00338: ảnh chụp không có dòng nào của 00338 — có thể 00338 chưa từng chạy. DỪNG.';
  end if;
  if v_n <> 3 then
    raise exception
      'HOANTAC_00338: ảnh chụp có % dòng (phải 3) — DỪNG để người kiểm lại.', v_n;
  end if;
end $kiem$;

do $go$
declare r record; v_n int := 0;
begin
  for r in
    select chu_ky, def_truoc from public.rpc_backup_ngay_hoa_don
    where migration = '00338' order by chu_ky
  loop
    execute r.def_truoc;
    v_n := v_n + 1;
    raise notice '00338 hoàn tác: đã khôi phục %', r.chu_ky;
  end loop;
  raise notice '00338 hoàn tác: % / 3 hàm', v_n;
end $go$;

-- ── Hậu kiểm: so với CHÍNH ẢNH CHỤP, không so marker ──────────────────────
-- Không kiểm "hết marker": trên production bản TRƯỚC KHI chạy 00338 vốn đã
-- mang marker (Pha A3 vá từ 20/08), nên kiểm marker sẽ báo hỏng oan. Phép so
-- đúng là: thân hàm hiện tại phải TRÙNG KHỚP thân đã chụp.
do $hau_kiem$
declare v_lech int;
begin
  select count(*) into v_lech
  from public.rpc_backup_ngay_hoa_don b
  join pg_proc p on p.oid = b.ham_oid
  where b.migration = '00338'
    and pg_get_functiondef(p.oid) is distinct from b.def_truoc;
  if v_lech <> 0 then
    raise exception
      '00338 hoàn tác THẤT BẠI: % hàm KHÔNG khớp thân đã chụp. CUỘN LẠI.', v_lech;
  end if;
  raise notice '00338 hoàn tác: ĐẠT — cả 3 hàm khớp từng ký tự với ảnh chụp';
end $hau_kiem$;

commit;

notify pgrst, 'reload schema';

-- Ảnh chụp GIỮ LẠI để đối chiếu. Xoá tay khi đã chắc chắn:
--   delete from public.rpc_backup_ngay_hoa_don where migration = '00338';
