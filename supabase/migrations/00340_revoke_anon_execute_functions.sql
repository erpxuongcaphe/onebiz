-- ============================================================================
-- 00340 — ĐÓNG LỖ HỔNG: `anon` và `PUBLIC` gọi được RPC — 21/08/2026
--
-- Nối tiếp 00239 (bản đó chỉ đóng BẢNG + SEQUENCE, bỏ sót ROUTINES).
-- Đo prod 20/08: 136/420 hàm anon gọi được; 55 SECURITY DEFINER không kiểm
-- auth.uid(); 16 hàm trong đó GHI dữ liệu. Thử thật bằng khoá công khai:
-- gọi user_has_branch_access → HTTP 200.
--
-- ── NGUYÊN TẮC ──────────────────────────────────────────────────────────────
--  1. Đo bằng QUYỀN HIỆU LỰC has_function_privilege(), không chỉ ACL của anon.
--  2. Thu hồi CẢ PUBLIC — anon là thành viên PUBLIC.
--  3. Bao phủ MỌI loại routine: function, procedure, aggregate, window.
--  4. Còn sót là RAISE EXCEPTION ⇒ cuộn lại toàn bộ. Không cảnh báo rồi commit.
--  5. Danh sách công khai theo CHỮ KÝ ĐẦY ĐỦ, không theo tên.
--  6. ẢNH CHỤP BẤT BIẾN: chỉ tạo MỘT LẦN. Chạy lần hai KHÔNG chụp đè trạng
--     thái đã vá — nếu đè thì hoàn tác sẽ khôi phục về chính bản đã vá, tức
--     là mất đường lùi.
--
-- ── HAI BẪY ĐÃ ĐO ĐƯỢC TRÊN PostgreSQL 16.4 ────────────────────────────────
--  · Mục `=X/` (PUBLIC) dựng sẵn KHÔNG thuộc schema nào ⇒ lệnh
--    `ALTER DEFAULT PRIVILEGES ... IN SCHEMA public REVOKE ... FROM PUBLIC`
--    là no-op. Phải dùng thêm dạng TOÀN CSDL.
--  · `GRANT ... ON FUNCTION` KHÔNG dùng được cho PROCEDURE. Phải chọn từ khoá
--    theo prokind: 'p' → PROCEDURE, còn lại → FUNCTION.
--
-- KHÔNG đụng: schema auth/storage/graphql_public; không đụng bảng, dữ liệu.
-- Chạy trong 1 transaction. Rollback: 00340_rollback_revoke_anon_execute_functions.sql
-- ============================================================================

begin;

-- ── Khối 0. Danh sách CÔNG KHAI được phép, theo CHỮ KÝ ĐẦY ĐỦ ──────────────
-- Quét toàn `src/` ngày 21/08: chỉ hai đường chạy khi CHƯA đăng nhập là
-- `app/api/auth/sign-in/route.ts` (dùng khoá anon) và `app/(auth)/quen-mat-khau`,
-- cả hai chỉ gọi get_email_by_phone. normalize_phone giữ theo 00239 đã chốt.
create temporary table _cho_phep_00340(chu_ky text) on commit drop;
insert into _cho_phep_00340(chu_ky) values
  ('public.get_email_by_phone(text)'),
  ('public.normalize_phone(text)');

-- ── Khối 0b. NGOÀI TẦM — routine thuộc chủ sở hữu mà vai trò đang chạy KHÔNG
-- sửa được. Trên Supabase, `postgres` không phải superuser và không là thành
-- viên của `supabase_admin`; quyền của những routine đó do chính supabase_admin
-- cấp (anon=X/supabase_admin) nên REVOKE chạy bằng postgres KHÔNG có tác dụng.
--
-- Không giả vờ đóng được. Thay vào đó: liệt kê rõ, CHỐT SỐ LƯỢNG kỳ vọng (số
-- thực tế khác là DỪNG để người rà lại), và vẫn đóng bằng hết phần trong tầm.
--
-- Số dưới đây lấy từ BƯỚC 1 chạy trên production 22/08/2026.
create temporary table _ngoai_tam_00340 on commit drop as
select p.oid,
       p.oid::regprocedure::text     as chu_ky,
       p.proowner::regrole::text     as chu_so_huu,
       p.prosecdef                   as security_definer,
       e.extname                     as extension
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
left join pg_depend d on d.objid = p.oid and d.deptype = 'e'
left join pg_extension e on e.oid = d.refobjid
where n.nspname = 'public' and p.prokind in ('f','p','a','w')
  and not pg_has_role(current_user, p.proowner, 'USAGE');

-- GUARD THEO BẢN CHẤT, không chỉ theo số lượng.
--
-- BƯỚC 1B chạy trên production 22/08 cho thấy cả 31 routine ngoài tầm đều:
--   · thuộc extension `pg_trgm` (hàm hỗ trợ chỉ mục/toán tử tìm gần đúng)
--   · viết bằng C, KHÔNG phải SECURITY DEFINER
--   · nằm ở nhóm `4_ham_thuong` — nhận text, trả số; không đọc/ghi bảng nào
-- Nên để chúng mở cho anon là chấp nhận được.
--
-- Điều KHÔNG chấp nhận được là một hàm NGUY HIỂM lọt vào nhóm ngoài tầm mà ta
-- không hay. Vì thế guard dưới đây kiểm BẢN CHẤT chứ không đếm:
--   · mọi routine ngoài tầm PHẢI thuộc một extension
--   · và PHẢI không phải SECURITY DEFINER
-- Sai một điều kiện là DỪNG toàn bộ. Con số chỉ dùng để báo, không dùng để chốt.
do $chot_ngoai_tam$
declare
  v_tong int;
  v_xau  int;
  v_ten  text;
  v_chu  text;
  v_ext  text;
begin
  select count(*) into v_tong from _ngoai_tam_00340;
  select string_agg(distinct chu_so_huu, ', ') into v_chu from _ngoai_tam_00340;
  select string_agg(distinct coalesce(extension, '(khong thuoc extension)'), ', ')
    into v_ext from _ngoai_tam_00340;

  select count(*) into v_xau from _ngoai_tam_00340
  where extension is null or security_definer;

  if v_xau > 0 then
    select string_agg(chu_ky, ', ') into v_ten from (
      select chu_ky from _ngoai_tam_00340
      where extension is null or security_definer limit 10) t;
    raise exception
      '00340 DUNG: % routine NGOAI TAM khong dat dieu kien an toan '
      '(phai thuoc extension VA khong phai SECURITY DEFINER). Vi du: %. '
      'De nguyen la de ho that su - phai xu ly rieng nhom nay truoc.',
      v_xau, v_ten;
  end if;

  if v_tong > 0 then
    raise warning
      '00340: % routine ngoai tam (chu: %; extension: %) VAN mo cho anon. '
      'Da kiem: deu thuoc extension va khong phai SECURITY DEFINER nen chap nhan duoc. '
      'Day la gioi han da biet, khong phai bo sot.',
      v_tong, v_chu, v_ext;
  end if;
end $chot_ngoai_tam$;

do $kiem_danh_sach$
declare r record; v_n int;
begin
  for r in select chu_ky from _cho_phep_00340 loop
    if to_regprocedure(r.chu_ky) is null then
      raise exception
        'GUARD_00340: không tìm thấy % — DỪNG, chạy tiếp là hỏng đăng nhập bằng SĐT. '
        'Chạy BƯỚC 1 lấy chữ ký đúng rồi sửa Khối 0.', r.chu_ky;
    end if;
    select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = split_part(split_part(r.chu_ky, '.', 2), '(', 1);
    if v_n <> 1 then
      raise exception
        'GUARD_00340: % có % overload — DỪNG, phải nêu rõ chữ ký nào được công khai',
        r.chu_ky, v_n;
    end if;
  end loop;
end $kiem_danh_sach$;

-- ── Khối 1. ẢNH CHỤP BẤT BIẾN — chỉ tạo MỘT LẦN ───────────────────────────
do $chup$
begin
  if to_regclass('public.acl_backup_00340') is not null then
    raise notice
      '00340: đã có ảnh chụp public.acl_backup_00340 — GIỮ NGUYÊN (bất biến). '
      'Muốn chụp lại phải tự tay DROP hai bảng ảnh chụp.';
    return;
  end if;

  create table public.acl_backup_00340 (
    ham_oid      oid  primary key,
    chu_ky       text not null,
    prokind      "char" not null,
    tu_khoa      text not null,     -- FUNCTION / PROCEDURE cho lệnh GRANT
    chu_so_huu   text not null,
    proacl_truoc text,
    -- Quyền HIỆU LỰC trước khi vá.
    anon_goi_duoc          boolean not null,
    public_goi_duoc        boolean not null,
    authenticated_goi_duoc boolean not null,
    service_role_goi_duoc  boolean not null,
    -- TOÀN BỘ mục EXECUTE của routine: grantee, grantor, grant option.
    -- Phải lưu ĐỦ MỌI grantee (không chỉ anon/PUBLIC) vì migration còn CẤP
    -- TRỰC TIẾP cho authenticated/service_role ở Khối 4 — hai vai này trước đó
    -- có thể chỉ có quyền NHỜ PUBLIC, không có mục trực tiếp nào. Hoàn tác phải
    -- gỡ luôn các mục do chính migration tạo ra thì ACL mới khớp ảnh chụp.
    acl_execute jsonb,
    chup_luc     timestamptz not null default now()
  );
  comment on table public.acl_backup_00340 is
    '00340: ảnh chụp BẤT BIẾN quyền EXECUTE trên routine schema public TRƯỚC khi thu hồi anon/PUBLIC. Dùng cho rollback. Không chụp đè.';
  revoke all on table public.acl_backup_00340 from public, anon, authenticated;

  insert into public.acl_backup_00340
    (ham_oid, chu_ky, prokind, tu_khoa, chu_so_huu, proacl_truoc,
     anon_goi_duoc, public_goi_duoc, authenticated_goi_duoc, service_role_goi_duoc,
     acl_execute)
  select p.oid,
         p.oid::regprocedure::text,
         p.prokind,
         case p.prokind when 'p' then 'PROCEDURE' else 'FUNCTION' end,
         p.proowner::regrole::text,
         p.proacl::text,
         has_function_privilege('anon',          p.oid, 'EXECUTE'),
         exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 where a.privilege_type = 'EXECUTE' and a.grantee = 0),
         has_function_privilege('authenticated', p.oid, 'EXECUTE'),
         has_function_privilege('service_role',  p.oid, 'EXECUTE'),
         (select jsonb_agg(jsonb_build_object(
                   'grantee', case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end,
                   'grantor', a.grantor::regrole::text,
                   'grantable', a.is_grantable)
                 order by case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end)
          from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where a.privilege_type = 'EXECUTE')
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind in ('f', 'p', 'a', 'w');

  -- Lưu NGUYÊN VĂN acl + TỪNG MỤC (grantee/grantor/grant option). Không dùng
  -- cờ có/không: cờ không đủ để dựng lại đúng người cấp và quyền uỷ quyền.
  create table public.default_acl_backup_00340 as
  select d.defaclrole::regrole::text        as chu_so_huu,
         coalesce(n.nspname, '(toan_csdl)') as pham_vi,
         d.defaclacl::text                  as acl_truoc,
         (select jsonb_agg(jsonb_build_object(
                   'grantee', case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end,
                   'grantor', a.grantor::regrole::text,
                   'grantable', a.is_grantable)
                 order by case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end)
          from aclexplode(d.defaclacl) a
          where a.privilege_type = 'EXECUTE') as acl_items
  from pg_default_acl d
  left join pg_namespace n on n.oid = d.defaclnamespace
  where d.defaclobjtype = 'f'
    and (n.nspname = 'public' or d.defaclnamespace = 0);
  revoke all on table public.default_acl_backup_00340 from public, anon, authenticated;

  raise notice '00340: đã chụp ảnh trạng thái trước khi vá';
end $chup$;

-- ── Khối 2. Thu hồi anon VÀ PUBLIC trên toàn bộ routine hiện có ────────────
revoke execute on all functions in schema public from anon, public;
revoke execute on all routines  in schema public from anon, public;

-- ── Khối 3. Chặn TẬN GỐC cho MỌI chủ sở hữu có thể tạo routine mới ────────
-- Không chỉ chủ đã có dòng pg_default_acl: chủ CHƯA có dòng nào vẫn tạo được
-- routine mới và routine đó sẽ nhận mặc định dựng sẵn (PUBLIC có EXECUTE).
-- Nên lấy HỢP của: chủ sở hữu routine hiện có ∪ chủ có dòng default ACL.
do $mac_dinh$
declare r record; v_da int := 0; v_bo_qua int := 0;
begin
  for r in
    select distinct chu from (
      select p.proowner::regrole::text as chu
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind in ('f','p','a','w')
      union
      select d.defaclrole::regrole::text
      from pg_default_acl d
      left join pg_namespace n on n.oid = d.defaclnamespace
      where d.defaclobjtype = 'f' and (n.nspname = 'public' or d.defaclnamespace = 0)
      union
      select current_user
    ) t
    where chu is not null
  loop
    -- Chủ sở hữu NGOÀI TẦM đã chốt ở Khối 0b: bỏ qua CÓ CHỦ ĐÍCH. Nổ ở đây thì
    -- migration vĩnh viễn không chạy được trên Supabase, và 105 routine trong
    -- tầm cũng không đóng nổi — tệ hơn là đóng được phần lớn rồi ghi rõ phần dư.
    if not pg_has_role(current_user, r.chu::regrole, 'USAGE') then
      v_bo_qua := v_bo_qua + 1;
      continue;
    end if;
    begin
      execute format(
        'alter default privileges for role %I in schema public revoke execute on functions from anon',
        r.chu);
      -- Dạng TOÀN CSDL: chỉ dạng này mới gỡ được mục `=X/` dựng sẵn.
      execute format(
        'alter default privileges for role %I revoke execute on functions from public',
        r.chu);
      v_da := v_da + 1;
    exception when insufficient_privilege then
      raise exception
        '00340 THAT BAI: chu so huu % nam TRONG tam (pg_has_role = true) ma van '
        'khong sua duoc quyen mac dinh - mau thuan, phai ra lai. CUON LAI.', r.chu;
    end;
  end loop;
  raise notice '00340: da go quyen mac dinh anon + PUBLIC cho % chu so huu (bo qua % chu ngoai tam)', v_da, v_bo_qua;
end $mac_dinh$;

-- ── Khối 4. Trả lại ĐÚNG quyền hiệu lực cho authenticated / service_role ───
-- Khối 2 cắt cả PUBLIC nên hai vai này có thể mất quyền vốn có NHỜ PUBLIC.
-- Cấp lại theo đúng ảnh chụp — không thừa một routine nào. Dùng ĐÚNG từ khoá
-- theo prokind: GRANT ... ON FUNCTION không dùng được cho PROCEDURE.
do $tra_lai$
declare r record; v_a int := 0; v_s int := 0;
begin
  for r in select chu_ky, tu_khoa from public.acl_backup_00340 where authenticated_goi_duoc loop
    if not exists (select 1 from pg_proc where oid = (select ham_oid from public.acl_backup_00340 b where b.chu_ky = r.chu_ky limit 1)) then
      continue;
    end if;
    execute format('grant execute on %s %s to authenticated', r.tu_khoa, r.chu_ky);
    v_a := v_a + 1;
  end loop;
  for r in select chu_ky, tu_khoa from public.acl_backup_00340 where service_role_goi_duoc loop
    execute format('grant execute on %s %s to service_role', r.tu_khoa, r.chu_ky);
    v_s := v_s + 1;
  end loop;
  raise notice '00340: trả lại % routine cho authenticated, % cho service_role', v_a, v_s;
end $tra_lai$;

-- ── Khối 5. Cấp lại ĐÚNG danh sách công khai, theo chữ ký đầy đủ ───────────
do $cong_khai$
declare r record; v_tk text;
begin
  for r in select chu_ky from _cho_phep_00340 loop
    select case p.prokind when 'p' then 'PROCEDURE' else 'FUNCTION' end into v_tk
    from pg_proc p where p.oid = to_regprocedure(r.chu_ky)::oid;
    execute format('grant execute on %s %s to anon', v_tk, r.chu_ky);
    raise notice '00340: giữ công khai %', r.chu_ky;
  end loop;
end $cong_khai$;

-- ── Khối 6. HẬU KIỂM TRONG TRANSACTION — sai là cuộn lại toàn bộ ───────────
do $hau_kiem$
declare
  v_n   int;
  v_ten text;
  v_oid oid;
begin
  -- K1. anon chỉ còn gọi được ĐÚNG danh sách công khai, xét MỌI loại routine.
  --     So bằng OID: oid::regprocedure::text bỏ tiền tố schema khi public nằm
  --     trong search_path nên so chuỗi lệch oan.
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind in ('f','p','a','w')
    and has_function_privilege('anon', p.oid, 'EXECUTE')
    and p.oid not in (select to_regprocedure(chu_ky)::oid from _cho_phep_00340)
    and p.oid not in (select oid from _ngoai_tam_00340);
  if v_n <> 0 then
    select string_agg(x, ', ') into v_ten from (
      select p.oid::regprocedure::text as x
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind in ('f','p','a','w')
        and has_function_privilege('anon', p.oid, 'EXECUTE')
        and p.oid not in (select to_regprocedure(chu_ky)::oid from _cho_phep_00340)
        and p.oid not in (select oid from _ngoai_tam_00340)
      limit 10) t;
    raise exception
      '00340 THẤT BẠI: còn % routine anon gọi được ngoài danh sách (ví dụ: %). '
      'Thường do routine thuộc chủ sở hữu mà vai trò đang chạy không gỡ được. CUỘN LẠI.',
      v_n, v_ten;
  end if;

  -- K2. PUBLIC không còn gọi được routine nào.
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
  lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where n.nspname = 'public' and p.prokind in ('f','p','a','w')
    and a.privilege_type = 'EXECUTE' and a.grantee = 0
    and p.oid not in (select oid from _ngoai_tam_00340);
  if v_n <> 0 then
    raise exception '00340 THAT BAI: con % routine TRONG TAM cap EXECUTE cho PUBLIC. CUON LAI.', v_n;
  end if;

  -- K3. Quyền mặc định không còn anon và không còn PUBLIC.
  select count(*) into v_n
  from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace
  where d.defaclobjtype = 'f'
    and (n.nspname = 'public' or d.defaclnamespace = 0)
    and (d.defaclacl::text like '%anon=%' or d.defaclacl::text ~ '[{,]=[a-zA-Z]')
    and pg_has_role(current_user, d.defaclrole, 'USAGE');
  if v_n <> 0 then
    raise exception '00340 THAT BAI: quyen mac dinh cua chu TRONG TAM van cap cho anon/PUBLIC. CUON LAI.';
  end if;

  -- K4. authenticated và service_role KHÔNG mất quyền nào so với ảnh chụp.
  select count(*) into v_n from public.acl_backup_00340 b
  where b.authenticated_goi_duoc and exists (select 1 from pg_proc where oid = b.ham_oid)
    and not has_function_privilege('authenticated', b.ham_oid, 'EXECUTE');
  if v_n <> 0 then
    raise exception '00340 THẤT BẠI: authenticated mất quyền ở % routine. CUỘN LẠI.', v_n;
  end if;
  select count(*) into v_n from public.acl_backup_00340 b
  where b.service_role_goi_duoc and exists (select 1 from pg_proc where oid = b.ham_oid)
    and not has_function_privilege('service_role', b.ham_oid, 'EXECUTE');
  if v_n <> 0 then
    raise exception '00340 THẤT BẠI: service_role mất quyền ở % routine. CUỘN LẠI.', v_n;
  end if;

  -- K5. Và cũng KHÔNG được mở rộng thêm cho hai vai đó.
  select count(*) into v_n from public.acl_backup_00340 b
  where not b.authenticated_goi_duoc and exists (select 1 from pg_proc where oid = b.ham_oid)
    and has_function_privilege('authenticated', b.ham_oid, 'EXECUTE');
  if v_n <> 0 then
    raise exception '00340 THẤT BẠI: authenticated được mở rộng thêm % routine. CUỘN LẠI.', v_n;
  end if;

  -- K6. Routine tạo MỚI không tự mở — kiểm CẢ function LẪN procedure.
  create function public._kiem_00340_ham_moi() returns int language sql as $ktr$ select 1 $ktr$;
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = '_kiem_00340_ham_moi';
  if has_function_privilege('anon', v_oid, 'EXECUTE') then
    raise exception '00340 THẤT BẠI: FUNCTION tạo mới VẪN tự mở cho anon. CUỘN LẠI.';
  end if;
  if exists (select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
             where p.oid = v_oid and a.privilege_type = 'EXECUTE' and a.grantee = 0) then
    raise exception '00340 THẤT BẠI: FUNCTION tạo mới VẪN tự mở cho PUBLIC. CUỘN LẠI.';
  end if;
  drop function public._kiem_00340_ham_moi();

  create procedure public._kiem_00340_thu_tuc_moi() language sql as $ktr$ select 1 $ktr$;
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = '_kiem_00340_thu_tuc_moi';
  if has_function_privilege('anon', v_oid, 'EXECUTE') then
    raise exception '00340 THẤT BẠI: PROCEDURE tạo mới VẪN tự mở cho anon. CUỘN LẠI.';
  end if;
  drop procedure public._kiem_00340_thu_tuc_moi();

  -- K7. Hai routine công khai vẫn gọi được (đăng nhập bằng SĐT không hỏng).
  select count(*) into v_n from _cho_phep_00340 c
  where not has_function_privilege('anon', to_regprocedure(c.chu_ky)::oid, 'EXECUTE');
  if v_n <> 0 then
    raise exception '00340 THẤT BẠI: % routine công khai KHÔNG gọi được. CUỘN LẠI.', v_n;
  end if;

  -- K8. ACL TRỰC TIẾP của anon: chỉ được còn đúng danh sách công khai.
  --     Đo riêng với quyền hiệu lực để bắt cả trường hợp mục trực tiếp còn sót
  --     mà hiệu lực lại bị che (và ngược lại).
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
  lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where n.nspname = 'public' and p.prokind in ('f','p','a','w')
    and a.privilege_type = 'EXECUTE' and a.grantee = 'anon'::regrole
    and p.oid not in (select to_regprocedure(chu_ky)::oid from _cho_phep_00340)
    and p.oid not in (select oid from _ngoai_tam_00340);
  if v_n <> 0 then
    raise exception '00340 THAT BAI: con % muc ACL TRUC TIEP cua anon TRONG TAM ma ngoai danh sach. CUON LAI.', v_n;
  end if;

  -- K9. service_role KHÔNG được mở rộng thêm so với ảnh chụp (đối xứng với K5).
  select count(*) into v_n from public.acl_backup_00340 b
  where not b.service_role_goi_duoc and exists (select 1 from pg_proc where oid = b.ham_oid)
    and has_function_privilege('service_role', b.ham_oid, 'EXECUTE');
  if v_n <> 0 then
    raise exception '00340 THẤT BẠI: service_role được mở rộng thêm % routine. CUỘN LẠI.', v_n;
  end if;

  select count(*) into v_n from _ngoai_tam_00340;
  raise notice
    '00340: DAT - TRONG TAM: anon chi con 2 routine dang nhap, PUBLIC sach, '
    'authenticated/service_role nguyen ven, routine moi khong tu mo. '
    'NGOAI TAM: % routine van mo cho anon (gioi han da biet, xem BUOC 1B).', v_n;
end $hau_kiem$;

commit;

notify pgrst, 'reload schema';
