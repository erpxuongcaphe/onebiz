-- ============================================================================
-- 00340 HOÀN TÁC — đưa ACL về ĐÚNG ảnh chụp, không thừa không thiếu
--
-- ⚠️ MỞ LẠI LỖ HỔNG: `anon` gọi lại được RPC như trước, trong đó có 16 hàm ghi
-- dữ liệu không kiểm danh tính. Chỉ chạy khi có luồng CHƯA ĐĂNG NHẬP thật sự
-- hỏng và cần khôi phục dịch vụ ngay.
--
-- CÁCH ÍT RỦI RO HƠN — THỬ TRƯỚC:
--   grant execute on function public.<ten>(<chu_ky>) to anon;
--   rồi thêm vào Khối 0 của 00340 để lần sau không mất.
--
-- ── VÌ SAO PHẢI HỘI TỤ CẢ ACL, KHÔNG CHỈ anon/PUBLIC ─────────────────────────
-- 00340 không chỉ THU HỒI của anon/PUBLIC; nó còn CẤP TRỰC TIẾP cho
-- authenticated và service_role (Khối 4). Trước khi vá, hai vai đó có thể chỉ
-- có quyền NHỜ PUBLIC, không hề có mục ACL trực tiếp nào. Nếu hoàn tác chỉ trả
-- anon/PUBLIC thì ACL sẽ THỪA những mục do chính migration tạo ra.
--
-- Nên hoàn tác làm hai chiều cho MỌI grantee:
--   · GỠ mục đang có mà ảnh chụp KHÔNG có
--   · CẤP mục ảnh chụp có mà hiện KHÔNG có (đúng grantor + grant option)
-- Không SET ROLE được về grantor ⇒ RAISE EXCEPTION, cuộn lại toàn transaction.
--
-- TUYỆT ĐỐI không `grant execute on all functions ... to anon`.
-- ============================================================================

begin;

do $kiem$
begin
  if to_regclass('public.acl_backup_00340') is null then
    raise exception
      'HOANTAC_00340: không có bảng ảnh chụp public.acl_backup_00340 — '
      'không thể hoàn tác chính xác. DỪNG.';
  end if;
  if to_regclass('public.default_acl_backup_00340') is null then
    raise exception
      'HOANTAC_00340: không có bảng ảnh chụp quyền mặc định. DỪNG.';
  end if;
end $kiem$;

-- ── Hàm phụ: đặt vai trò về đúng grantor, không được thì DỪNG ──────────────
create function pg_temp.dat_vai(p_grantor text) returns void language plpgsql as $dv$
begin
  execute format('set local role %I', p_grantor);
exception when others then
  raise exception
    'HOANTAC_00340: KHÔNG đặt được vai trò về % — không dựng lại đúng người cấp '
    'nên ACL sẽ lệch ảnh chụp. CUỘN LẠI. (Cần chạy bằng vai trò là thành viên của %.)',
    p_grantor, p_grantor;
end $dv$;

-- ── Khối 1. Hội tụ ACL của TỪNG routine về đúng ảnh chụp ───────────────────
do $hoi_tu$
declare
  r      record;
  m      jsonb;
  v_role text;
  v_gr   text;
  v_opt  text;
  v_go   int := 0;
  v_cap  int := 0;
  v_mat  int := 0;
begin
  for r in select ham_oid, chu_ky, tu_khoa, acl_execute from public.acl_backup_00340 loop
    if not exists (select 1 from pg_proc where oid = r.ham_oid) then
      v_mat := v_mat + 1;
      continue;
    end if;

    -- (a) GỠ mục đang có mà ảnh chụp không có.
    for m in
      select jsonb_build_object(
               'grantee', case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end,
               'grantor', a.grantor::regrole::text,
               'grantable', a.is_grantable)
      from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid = r.ham_oid and a.privilege_type = 'EXECUTE'
    loop
      if coalesce(r.acl_execute, '[]'::jsonb) @> jsonb_build_array(m) then
        continue;  -- đã khớp ảnh chụp, giữ nguyên
      end if;
      v_role := m->>'grantee';
      perform pg_temp.dat_vai(m->>'grantor');
      if v_role = 'PUBLIC' then
        execute format('revoke execute on %s %s from public', r.tu_khoa, r.chu_ky);
      else
        execute format('revoke execute on %s %s from %I', r.tu_khoa, r.chu_ky, v_role);
      end if;
      reset role;
      v_go := v_go + 1;
    end loop;

    -- (b) CẤP mục ảnh chụp có mà hiện chưa có (đúng grantor + grant option).
    for m in select jsonb_array_elements(coalesce(r.acl_execute, '[]'::jsonb)) loop
      if exists (
        select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.oid = r.ham_oid and a.privilege_type = 'EXECUTE'
          and (case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end) = (m->>'grantee')
          and a.grantor::regrole::text = (m->>'grantor')
          and a.is_grantable = (m->>'grantable')::boolean
      ) then
        continue;
      end if;
      v_role := m->>'grantee';
      v_gr   := m->>'grantor';
      v_opt  := case when (m->>'grantable')::boolean then ' with grant option' else '' end;
      perform pg_temp.dat_vai(v_gr);
      if v_role = 'PUBLIC' then
        execute format('grant execute on %s %s to public%s', r.tu_khoa, r.chu_ky, v_opt);
      else
        execute format('grant execute on %s %s to %I%s', r.tu_khoa, r.chu_ky, v_role, v_opt);
      end if;
      reset role;
      v_cap := v_cap + 1;
    end loop;
  end loop;
  raise notice
    '00340 hoàn tác: gỡ % mục thừa, cấp lại % mục thiếu (bỏ qua % routine không còn tồn tại)',
    v_go, v_cap, v_mat;
end $hoi_tu$;

-- ── Khối 2. Hội tụ QUYỀN MẶC ĐỊNH về đúng ảnh chụp ────────────────────────
do $mac_dinh$
declare
  r      record;
  m      jsonb;
  v_role text;
  v_opt  text;
  v_pv   text;
  v_n    int := 0;
begin
  -- (a) Chủ sở hữu CÓ trong ảnh chụp: dựng lại từng mục.
  for r in select chu_so_huu, pham_vi, acl_items from public.default_acl_backup_00340 loop
    v_pv := case when r.pham_vi = 'public' then ' in schema public' else '' end;
    for m in select jsonb_array_elements(coalesce(r.acl_items, '[]'::jsonb)) loop
      v_role := m->>'grantee';
      v_opt  := case when (m->>'grantable')::boolean then ' with grant option' else '' end;
      perform pg_temp.dat_vai(m->>'grantor');
      if v_role = 'PUBLIC' then
        execute format('alter default privileges for role %I%s grant execute on functions to public%s',
                       r.chu_so_huu, v_pv, v_opt);
      else
        execute format('alter default privileges for role %I%s grant execute on functions to %I%s',
                       r.chu_so_huu, v_pv, v_role, v_opt);
      end if;
      reset role;
      v_n := v_n + 1;
    end loop;
  end loop;

  -- (b) Chủ sở hữu KHÔNG có trong ảnh chụp: trước khi vá họ không có dòng nào,
  --     tức dùng mặc định dựng sẵn (PUBLIC có EXECUTE). 00340 đã tạo dòng cho
  --     họ ⇒ trả PUBLIC lại để dòng đó tự tiêu và về đúng mặc định dựng sẵn.
  for r in
    select d.defaclrole::regrole::text as chu,
           coalesce(n.nspname, '(toan_csdl)') as pham_vi
    from pg_default_acl d
    left join pg_namespace n on n.oid = d.defaclnamespace
    where d.defaclobjtype = 'f' and (n.nspname = 'public' or d.defaclnamespace = 0)
      and not exists (
        select 1 from public.default_acl_backup_00340 b
        where b.chu_so_huu = d.defaclrole::regrole::text
          and b.pham_vi = coalesce(n.nspname, '(toan_csdl)')
      )
  loop
    if r.pham_vi = '(toan_csdl)' then
      perform pg_temp.dat_vai(r.chu);
      execute format('alter default privileges for role %I grant execute on functions to public', r.chu);
      reset role;
      v_n := v_n + 1;
    end if;
  end loop;

  raise notice '00340 hoàn tác: dựng lại % mục quyền mặc định', v_n;
end $mac_dinh$;

drop function if exists pg_temp.dat_vai(text);

-- ── Khối 3. HẬU KIỂM: ACL phải KHỚP ẢNH CHỤP từng mục, cả trực tiếp lẫn hiệu lực
do $hau_kiem$
declare v_lech int; v_role text; v_n int;
begin
  -- (1) ACL TRỰC TIẾP: từng mục EXECUTE phải trùng khớp ảnh chụp.
  select count(*) into v_lech
  from public.acl_backup_00340 b
  join pg_proc p on p.oid = b.ham_oid
  where coalesce(b.acl_execute, '[]'::jsonb) is distinct from coalesce((
          select jsonb_agg(jsonb_build_object(
                   'grantee', case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end,
                   'grantor', a.grantor::regrole::text,
                   'grantable', a.is_grantable)
                 order by case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end)
          from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where a.privilege_type = 'EXECUTE'), '[]'::jsonb);
  if v_lech <> 0 then
    raise exception
      '00340 hoàn tác THẤT BẠI: % routine có ACL TRỰC TIẾP lệch ảnh chụp. CUỘN LẠI.', v_lech;
  end if;

  -- (2) QUYỀN HIỆU LỰC của cả bốn vai phải khớp ảnh chụp — không thiếu, không thừa.
  foreach v_role in array array['anon','authenticated','service_role'] loop
    execute format($q$
      select count(*) from public.acl_backup_00340 b
      where exists (select 1 from pg_proc where oid = b.ham_oid)
        and (case %L when 'anon' then b.anon_goi_duoc
                     when 'authenticated' then b.authenticated_goi_duoc
                     else b.service_role_goi_duoc end)
            is distinct from has_function_privilege(%L, b.ham_oid, 'EXECUTE')
    $q$, v_role, v_role) into v_n;
    if v_n <> 0 then
      raise exception
        '00340 hoàn tác THẤT BẠI: quyền HIỆU LỰC của % lệch ảnh chụp ở % routine. CUỘN LẠI.',
        v_role, v_n;
    end if;
  end loop;

  -- (3) PUBLIC: so mục trực tiếp grantee = 0.
  select count(*) into v_lech
  from public.acl_backup_00340 b
  join pg_proc p on p.oid = b.ham_oid
  where b.public_goi_duoc is distinct from exists (
    select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where a.privilege_type = 'EXECUTE' and a.grantee = 0);
  if v_lech <> 0 then
    raise exception
      '00340 hoàn tác THẤT BẠI: PUBLIC lệch ảnh chụp ở % routine. CUỘN LẠI.', v_lech;
  end if;

  -- (4) QUYỀN MẶC ĐỊNH phải khớp nguyên văn ảnh chụp.
  select count(*) into v_lech
  from public.default_acl_backup_00340 b
  left join (
    select d.defaclrole::regrole::text as chu,
           coalesce(n.nspname, '(toan_csdl)') as pv,
           d.defaclacl::text as acl
    from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace
    where d.defaclobjtype = 'f' and (n.nspname = 'public' or d.defaclnamespace = 0)
  ) h on h.chu = b.chu_so_huu and h.pv = b.pham_vi
  where coalesce(h.acl, '') is distinct from coalesce(b.acl_truoc, '');
  if v_lech <> 0 then
    raise exception
      '00340 hoàn tác THẤT BẠI: % dòng quyền mặc định lệch ảnh chụp. CUỘN LẠI.', v_lech;
  end if;

  raise notice
    '00340 hoàn tác: ĐẠT — ACL trực tiếp, quyền hiệu lực 4 vai, PUBLIC và quyền mặc định đều khớp ảnh chụp';
end $hau_kiem$;

commit;

notify pgrst, 'reload schema';

-- Ảnh chụp GIỮ LẠI để đối chiếu. Xoá tay khi đã chắc chắn:
--   drop table public.acl_backup_00340, public.default_acl_backup_00340;
