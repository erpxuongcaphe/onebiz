-- ============================================================================
-- 00340 HOÀN TÁC — khôi phục ĐÚNG ảnh chụp quyền trước khi vá
--
-- ⚠️ HOÀN TÁC NÀY MỞ LẠI LỖ HỔNG: `anon` gọi lại được toàn bộ RPC như trước,
-- trong đó có 16 hàm ghi dữ liệu không kiểm danh tính. Chỉ chạy khi có luồng
-- CHƯA ĐĂNG NHẬP thật sự hỏng và cần khôi phục dịch vụ ngay.
--
-- CÁCH ÍT RỦI RO HƠN — THỬ TRƯỚC KHI HOÀN TÁC TOÀN BỘ:
--   cấp lại đúng hàm đang bị chặn, theo chữ ký đầy đủ:
--       grant execute on function public.<ten>(<chu_ky>) to anon;
--   rồi thêm hàm đó vào Khối 0 của 00340 để lần sau không mất.
--
-- KHÔNG BAO GIỜ dùng `grant execute on all functions ... to anon`: lệnh đó mở
-- rộng hơn cả trạng thái trước khi vá (cấp cả hàm mà anon vốn KHÔNG có).
-- File này chỉ trả lại ĐÚNG những gì đã lấy đi, đọc từ ảnh chụp.
-- ============================================================================

begin;

do $kiem$
begin
  if to_regclass('public.acl_backup_00340') is null then
    raise exception
      'HOANTAC_00340: không có bảng ảnh chụp public.acl_backup_00340 — '
      'không thể hoàn tác chính xác. DỪNG.';
  end if;
end $kiem$;

-- ── Khối 1. Trả lại quyền cho anon ĐÚNG như ảnh chụp ───────────────────────
do $tra_anon$
declare r record; v_n int := 0; v_mat int := 0;
begin
  for r in select ham_oid, chu_ky from public.acl_backup_00340 where anon_goi_duoc loop
    -- Hàm có thể đã bị xoá/đổi chữ ký kể từ lúc chụp.
    if not exists (select 1 from pg_proc where oid = r.ham_oid) then
      v_mat := v_mat + 1;
      continue;
    end if;
    execute format('grant execute on function %s to anon', r.ham_oid::regprocedure::text);
    v_n := v_n + 1;
  end loop;
  raise notice '00340 hoàn tác: trả lại % hàm cho anon (bỏ qua % hàm không còn tồn tại)', v_n, v_mat;
end $tra_anon$;

-- ── Khối 2. Trả lại quyền cho PUBLIC ĐÚNG như ảnh chụp ─────────────────────
do $tra_public$
declare r record; v_n int := 0;
begin
  for r in select ham_oid from public.acl_backup_00340 where public_goi_duoc loop
    if not exists (select 1 from pg_proc where oid = r.ham_oid) then continue; end if;
    execute format('grant execute on function %s to public', r.ham_oid::regprocedure::text);
    v_n := v_n + 1;
  end loop;
  raise notice '00340 hoàn tác: trả lại % hàm cho PUBLIC', v_n;
end $tra_public$;

-- ── Khối 3. Trả lại QUYỀN MẶC ĐỊNH đúng như ảnh chụp ───────────────────────
-- Chỉ cấp lại cho anon ở đúng chủ sở hữu vốn có, và trả PUBLIC về mặc định
-- dựng sẵn của PostgreSQL (mục `=X/`) bằng lệnh phạm vi TOÀN CSDL.
do $tra_mac_dinh$
declare r record; v_n int := 0;
begin
  for r in
    select chu_so_huu, pham_vi, acl_truoc
    from public.default_acl_backup_00340
  loop
    if r.acl_truoc like '%anon=%' and r.pham_vi = 'public' then
      execute format(
        'alter default privileges for role %I in schema public grant execute on functions to anon',
        r.chu_so_huu);
      v_n := v_n + 1;
    end if;
  end loop;
  -- Trả mục PUBLIC dựng sẵn: 00340 đã gỡ bằng lệnh toàn CSDL nên trả lại cũng
  -- phải bằng lệnh toàn CSDL, đúng từng chủ sở hữu đã bị gỡ.
  for r in select distinct chu_so_huu from public.default_acl_backup_00340 loop
    execute format(
      'alter default privileges for role %I grant execute on functions to public',
      r.chu_so_huu);
  end loop;
  alter default privileges grant execute on functions to public;
  raise notice '00340 hoàn tác: trả lại quyền mặc định (% dòng anon + PUBLIC toàn CSDL)', v_n;
end $tra_mac_dinh$;

-- ── Khối 4. Hậu kiểm hoàn tác: phải khớp ảnh chụp, KHÔNG rộng hơn ──────────
do $hau_kiem$
declare v_thieu int; v_thua int;
begin
  select count(*) into v_thieu from public.acl_backup_00340 b
  where b.anon_goi_duoc
    and exists (select 1 from pg_proc where oid = b.ham_oid)
    and not has_function_privilege('anon', b.ham_oid, 'EXECUTE');
  select count(*) into v_thua from public.acl_backup_00340 b
  where not b.anon_goi_duoc
    and exists (select 1 from pg_proc where oid = b.ham_oid)
    and has_function_privilege('anon', b.ham_oid, 'EXECUTE');
  if v_thieu <> 0 then
    raise exception '00340 hoàn tác THẤT BẠI: thiếu % hàm so với ảnh chụp. CUỘN LẠI.', v_thieu;
  end if;
  if v_thua <> 0 then
    raise exception
      '00340 hoàn tác THẤT BẠI: cấp THỪA % hàm cho anon so với trước khi vá — '
      'hoàn tác không được mở rộng hơn trạng thái cũ. CUỘN LẠI.', v_thua;
  end if;
  raise notice '00340 hoàn tác: ĐẠT — khớp đúng ảnh chụp, không thừa không thiếu';
end $hau_kiem$;

commit;

notify pgrst, 'reload schema';

-- Ảnh chụp GIỮ LẠI để đối chiếu. Xoá tay khi đã chắc chắn:
--   drop table public.acl_backup_00340, public.default_acl_backup_00340;
