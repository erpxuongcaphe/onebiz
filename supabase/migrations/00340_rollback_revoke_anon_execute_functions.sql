-- ============================================================================
-- 00340 HOÀN TÁC — khôi phục ĐÚNG ảnh chụp quyền trước khi vá
--
-- ⚠️ MỞ LẠI LỖ HỔNG: `anon` gọi lại được RPC như trước, trong đó có 16 hàm ghi
-- dữ liệu không kiểm danh tính. Chỉ chạy khi có luồng CHƯA ĐĂNG NHẬP thật sự
-- hỏng và cần khôi phục dịch vụ ngay.
--
-- CÁCH ÍT RỦI RO HƠN — THỬ TRƯỚC KHI HOÀN TÁC TOÀN BỘ:
--   cấp lại đúng routine đang bị chặn, theo chữ ký đầy đủ:
--       grant execute on function public.<ten>(<chu_ky>) to anon;
--   rồi thêm vào Khối 0 của 00340 để lần sau không mất.
--
-- KHÔI PHỤC CHÍNH XÁC, KHÔNG CẤP BỪA:
--   · Chỉ trả lại đúng những mục ACL đã bị lấy đi (anon và PUBLIC), đọc từ cột
--     acl_anon_public — giữ nguyên grantor và WITH GRANT OPTION.
--   · Đặt lại vai trò về đúng GRANTOR trước khi GRANT, để mục ACL dựng lại
--     khớp cả người cấp chứ không phải chỉ người nhận.
--   · Dùng đúng từ khoá FUNCTION/PROCEDURE theo prokind.
--   · Quyền mặc định chỉ trả cho ĐÚNG chủ sở hữu mà ảnh chụp ghi là có — không
--     GRANT PUBLIC tràn cho mọi chủ.
--   · TUYỆT ĐỐI không `grant execute on all functions ... to anon`.
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

-- ── Khối 1. Trả lại từng mục ACL của anon và PUBLIC ĐÚNG như ảnh chụp ──────
do $tra_acl$
declare
  r      record;
  m      jsonb;
  v_role text;
  v_gr   text;
  v_opt  text;
  v_n    int := 0;
  v_mat  int := 0;
  v_kho  int := 0;
begin
  for r in
    select ham_oid, chu_ky, tu_khoa, acl_anon_public
    from public.acl_backup_00340
    where acl_anon_public is not null
  loop
    if not exists (select 1 from pg_proc where oid = r.ham_oid) then
      v_mat := v_mat + 1;
      continue;
    end if;
    for m in select jsonb_array_elements(r.acl_anon_public) loop
      v_role := m->>'grantee';
      v_gr   := m->>'grantor';
      v_opt  := case when (m->>'grantable')::boolean then ' with grant option' else '' end;
      -- Đặt vai trò về đúng người đã cấp để mục ACL dựng lại khớp grantor.
      -- Không đặt được thì cấp bằng vai trò hiện tại và BÁO RÕ, không im lặng.
      begin
        execute format('set local role %I', v_gr);
      exception when others then
        v_kho := v_kho + 1;
        raise warning
          'HOANTAC_00340: không set role được về % — mục ACL của % trên % sẽ mang grantor khác',
          v_gr, v_role, r.chu_ky;
      end;
      if v_role = 'PUBLIC' then
        execute format('grant execute on %s %s to public%s', r.tu_khoa, r.chu_ky, v_opt);
      else
        execute format('grant execute on %s %s to %I%s', r.tu_khoa, r.chu_ky, v_role, v_opt);
      end if;
      reset role;
      v_n := v_n + 1;
    end loop;
  end loop;
  raise notice
    '00340 hoàn tác: trả lại % mục ACL (bỏ qua % routine không còn tồn tại, % mục không set role được)',
    v_n, v_mat, v_kho;
end $tra_acl$;

-- ── Khối 2. Trả lại QUYỀN MẶC ĐỊNH đúng như ảnh chụp, không tràn ───────────
do $tra_mac_dinh$
declare r record; v_a int := 0; v_p int := 0;
begin
  for r in select chu_so_huu, pham_vi, co_anon, co_public
           from public.default_acl_backup_00340
  loop
    if r.co_anon and r.pham_vi = 'public' then
      execute format(
        'alter default privileges for role %I in schema public grant execute on functions to anon',
        r.chu_so_huu);
      v_a := v_a + 1;
    end if;
    -- Mục PUBLIC dựng sẵn bị gỡ bằng lệnh TOÀN CSDL nên trả lại cũng phải
    -- bằng lệnh toàn CSDL — và CHỈ cho chủ sở hữu mà ảnh chụp ghi là có.
    if r.co_public then
      execute format(
        'alter default privileges for role %I grant execute on functions to public',
        r.chu_so_huu);
      v_p := v_p + 1;
    end if;
  end loop;
  raise notice '00340 hoàn tác: trả quyền mặc định — % dòng anon, % dòng PUBLIC', v_a, v_p;
end $tra_mac_dinh$;

-- ── Khối 3. Chủ sở hữu KHÔNG có dòng ảnh chụp: trả về mặc định dựng sẵn ────
-- 00340 đã gỡ PUBLIC cho MỌI chủ sở hữu routine, kể cả chủ trước đó không có
-- dòng pg_default_acl nào. Với những chủ đó, trạng thái cũ = mặc định dựng sẵn
-- của PostgreSQL (PUBLIC có EXECUTE) ⇒ trả lại đúng bằng cách gỡ chính dòng
-- mà 00340 đã tạo ra, chứ không GRANT thêm gì.
do $don_dong_thua$
declare r record; v_n int := 0;
begin
  for r in
    select d.defaclrole::regrole::text as chu
    from pg_default_acl d
    left join pg_namespace n on n.oid = d.defaclnamespace
    where d.defaclobjtype = 'f' and d.defaclnamespace = 0
      and d.defaclrole::regrole::text not in (
        select chu_so_huu from public.default_acl_backup_00340 where co_public
      )
  loop
    execute format(
      'alter default privileges for role %I grant execute on functions to public',
      r.chu);
    v_n := v_n + 1;
  end loop;
  raise notice '00340 hoàn tác: trả mặc định dựng sẵn cho % chủ sở hữu không có ảnh chụp', v_n;
end $don_dong_thua$;

-- ── Khối 4. Hậu kiểm hoàn tác: phải KHỚP ảnh chụp, không thiếu không thừa ──
do $hau_kiem$
declare v_thieu int; v_thua int; v_pub_thieu int;
begin
  select count(*) into v_thieu from public.acl_backup_00340 b
  where b.anon_goi_duoc
    and exists (select 1 from pg_proc where oid = b.ham_oid)
    and not has_function_privilege('anon', b.ham_oid, 'EXECUTE');
  select count(*) into v_thua from public.acl_backup_00340 b
  where not b.anon_goi_duoc
    and exists (select 1 from pg_proc where oid = b.ham_oid)
    and has_function_privilege('anon', b.ham_oid, 'EXECUTE');
  select count(*) into v_pub_thieu from public.acl_backup_00340 b
  where b.public_goi_duoc
    and exists (select 1 from pg_proc where oid = b.ham_oid)
    and not exists (
      select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid = b.ham_oid and a.privilege_type = 'EXECUTE' and a.grantee = 0);

  if v_thieu <> 0 then
    raise exception '00340 hoàn tác THẤT BẠI: thiếu % routine cho anon so với ảnh chụp. CUỘN LẠI.', v_thieu;
  end if;
  if v_thua <> 0 then
    raise exception
      '00340 hoàn tác THẤT BẠI: cấp THỪA % routine cho anon so với trước khi vá — '
      'hoàn tác không được mở rộng hơn trạng thái cũ. CUỘN LẠI.', v_thua;
  end if;
  if v_pub_thieu <> 0 then
    raise exception '00340 hoàn tác THẤT BẠI: thiếu % routine cho PUBLIC so với ảnh chụp. CUỘN LẠI.', v_pub_thieu;
  end if;
  raise notice '00340 hoàn tác: ĐẠT — khớp đúng ảnh chụp, không thừa không thiếu';
end $hau_kiem$;

commit;

notify pgrst, 'reload schema';

-- Ảnh chụp GIỮ LẠI để đối chiếu. Xoá tay khi đã chắc chắn:
--   drop table public.acl_backup_00340, public.default_acl_backup_00340;
