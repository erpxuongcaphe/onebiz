-- ============================================================================
-- 00340 — ĐÓNG LỖ HỔNG: `anon` và `PUBLIC` gọi được RPC — 21/08/2026
--
-- Nối tiếp 00239 (bản đó chỉ đóng phần BẢNG + SEQUENCE, bỏ sót FUNCTIONS).
-- Đo trên production 20/08: 136/420 hàm anon gọi được; 55 là SECURITY DEFINER
-- không kiểm auth.uid(); 16 hàm trong đó GHI dữ liệu. Đã thử thật bằng khoá
-- công khai: gọi user_has_branch_access → HTTP 200.
--
-- BỐN ĐIỂM KHÁC BẢN NHÁP TRƯỚC (CEO chỉ ra):
--   1. Đo bằng QUYỀN HIỆU LỰC has_function_privilege(), không chỉ ACL trực
--      tiếp của anon — quyền qua PUBLIC không hiện trong ACL của anon.
--   2. Thu hồi CẢ PUBLIC. Thu hồi riêng anon là chưa đủ vì mặc định của
--      PostgreSQL là EXECUTE cho PUBLIC.
--   3. Còn sót là RAISE EXCEPTION ⇒ cuộn lại toàn bộ, KHÔNG cảnh báo rồi commit.
--   4. Cấp lại theo CHỮ KÝ ĐẦY ĐỦ, không theo tên (tránh trúng mọi overload).
--
-- GIỮ NGUYÊN QUYỀN CỦA authenticated / service_role, KHÔNG mở rộng:
-- thu hồi PUBLIC có thể cắt oan hai vai này nếu chúng chỉ có quyền NHỜ PUBLIC.
-- Nên trước khi thu hồi, chụp lại đúng tập hàm mà mỗi vai đang gọi được, rồi
-- cấp lại đúng tập đó — không thừa một hàm.
--
-- KHÔNG đụng: schema auth/storage/graphql_public; không đụng bảng, dữ liệu.
-- Chạy trong 1 transaction. Rollback: 00340_rollback_revoke_anon_execute_functions.sql
-- ============================================================================

begin;

-- ── Khối 0. Danh sách hàm CÔNG KHAI được phép, theo CHỮ KÝ ĐẦY ĐỦ ──────────
-- Vì sao đúng 2 hàm này: quét toàn bộ `src/` ngày 21/08 — chỉ hai đường chạy
-- khi CHƯA đăng nhập là `app/api/auth/sign-in/route.ts` (dùng khoá anon) và
-- trang `app/(auth)/quen-mat-khau/page.tsx`, và cả hai chỉ gọi
-- get_email_by_phone. normalize_phone giữ theo đúng danh sách 00239 đã chốt.
create temporary table _cho_phep_00340(chu_ky text) on commit drop;
insert into _cho_phep_00340(chu_ky) values
  ('public.get_email_by_phone(text)'),
  ('public.normalize_phone(text)');

do $kiem_danh_sach$
declare r record; v_n int;
begin
  for r in select chu_ky from _cho_phep_00340 loop
    if to_regprocedure(r.chu_ky) is null then
      raise exception
        'GUARD_00340: không tìm thấy % — DỪNG, nếu chạy tiếp là hỏng đăng nhập bằng SĐT. '
        'Chạy BƯỚC 1 để lấy chữ ký đúng rồi sửa danh sách.', r.chu_ky;
    end if;
    -- Cấm cấp mù cho mọi overload: có overload khác là dừng để người quyết định.
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

-- ── Khối 1. Chụp trạng thái TRƯỚC (để hoàn tác đúng, không mở toang) ───────
drop table if exists public.acl_backup_00340;
create table public.acl_backup_00340 (
  ham_oid      oid  primary key,
  chu_ky       text not null,
  proacl_truoc text,
  -- Quyền HIỆU LỰC trước khi vá — đây mới là thứ phải giữ nguyên cho
  -- authenticated/service_role và phải triệt tiêu cho anon/PUBLIC.
  anon_goi_duoc          boolean not null,
  public_goi_duoc        boolean not null,
  authenticated_goi_duoc boolean not null,
  service_role_goi_duoc  boolean not null,
  chup_luc     timestamptz not null default now()
);
comment on table public.acl_backup_00340 is
  '00340: ảnh chụp quyền EXECUTE trên hàm public TRƯỚC khi thu hồi anon/PUBLIC. Dùng cho rollback. Không cấp quyền cho ai ngoài chủ sở hữu.';
revoke all on table public.acl_backup_00340 from public, anon, authenticated;

insert into public.acl_backup_00340
  (ham_oid, chu_ky, proacl_truoc,
   anon_goi_duoc, public_goi_duoc, authenticated_goi_duoc, service_role_goi_duoc)
select p.oid,
       p.oid::regprocedure::text,
       p.proacl::text,
       has_function_privilege('anon',          p.oid, 'EXECUTE'),
       -- PUBLIC không phải một role nên phải đọc thẳng ACL: mục có grantee = 0.
       exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
               where a.privilege_type = 'EXECUTE' and a.grantee = 0),
       has_function_privilege('authenticated', p.oid, 'EXECUTE'),
       has_function_privilege('service_role',  p.oid, 'EXECUTE')
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind in ('f', 'p', 'a', 'w');

-- Chụp cả quyền mặc định (nguồn gốc của lỗ hổng).
-- Lấy CẢ dòng phạm vi toàn CSDL (defaclnamespace = 0), không chỉ schema public:
-- mục `=X/` (PUBLIC) dựng sẵn của PostgreSQL KHÔNG thuộc schema nào.
drop table if exists public.default_acl_backup_00340;
create table public.default_acl_backup_00340 as
select d.defaclrole::regrole::text          as chu_so_huu,
       coalesce(n.nspname, '(toan_csdl)')   as pham_vi,
       d.defaclacl::text                    as acl_truoc
from pg_default_acl d
left join pg_namespace n on n.oid = d.defaclnamespace
where d.defaclobjtype = 'f'
  and (n.nspname = 'public' or d.defaclnamespace = 0);
revoke all on table public.default_acl_backup_00340 from public, anon, authenticated;

-- ── Khối 2. Thu hồi anon VÀ PUBLIC trên toàn bộ hàm hiện có ────────────────
revoke execute on all functions in schema public from anon, public;
revoke execute on all routines  in schema public from anon, public;

-- ── Khối 3. Chặn TẬN GỐC: hàm tạo sau này không tự mở ──────────────────────
-- Đây mới là chỗ 00239 bỏ sót; thiếu bước này thì mỗi migration mới lại mở
-- thêm một cửa.
--
-- ⚠️ HAI LỆNH KHÁC NHAU, THIẾU MỘT LÀ HỞ (đã đo trên PostgreSQL 16.4):
--   · anon có quyền do một dòng mặc định THEO SCHEMA cấp thẳng
--       → gỡ bằng `... IN SCHEMA public REVOKE ... FROM anon`.
--   · anon còn quyền GIÁN TIẾP vì là thành viên của PUBLIC, và mục `=X/`
--     dựng sẵn của PostgreSQL KHÔNG thuộc schema nào
--       → lệnh có `IN SCHEMA` KHÔNG gỡ nổi; phải dùng dạng TOÀN CSDL.
--     Đo được: sau khi chỉ gỡ theo schema, hàm mới vẫn ra `{=X/postgres,…}`
--     và `has_function_privilege('anon', …)` vẫn TRUE.
--
-- Dạng toàn CSDL ảnh hưởng tới hàm tạo MỚI ở mọi schema do chính vai trò đó
-- tạo — đó chính là điều mong muốn (bỏ EXECUTE mặc định cho PUBLIC). Hàm của
-- extension do vai trò khác (supabase_admin) tạo nên không bị đụng.
do $mac_dinh$
declare r record; v_da int := 0;
begin
  for r in
    select distinct d.defaclrole::regrole::text as chu
    from pg_default_acl d
    left join pg_namespace n on n.oid = d.defaclnamespace
    where d.defaclobjtype = 'f'
      and (n.nspname = 'public' or d.defaclnamespace = 0)
  loop
    execute format(
      'alter default privileges for role %I in schema public revoke execute on functions from anon',
      r.chu);
    execute format(
      'alter default privileges for role %I revoke execute on functions from public',
      r.chu);
    v_da := v_da + 1;
    raise notice '00340: đã gỡ quyền mặc định anon + PUBLIC cho hàm do % tạo', r.chu;
  end loop;
  -- Áp thêm cho chính vai trò đang chạy (phòng khi nó chưa có dòng mặc định).
  alter default privileges in schema public revoke execute on functions from anon;
  alter default privileges revoke execute on functions from public;
  if v_da = 0 then
    raise notice '00340: không có dòng mặc định nào sẵn — chỉ áp cho vai trò đang chạy';
  end if;
end $mac_dinh$;

-- ── Khối 4. Trả lại ĐÚNG quyền hiệu lực cho authenticated / service_role ───
-- Khối 2 cắt cả PUBLIC nên hai vai này có thể mất quyền vốn có NHỜ PUBLIC.
-- Cấp lại theo đúng ảnh chụp — không thừa một hàm nào.
do $tra_lai$
declare r record; v_a int := 0; v_s int := 0;
begin
  for r in select chu_ky from public.acl_backup_00340 where authenticated_goi_duoc loop
    execute format('grant execute on function %s to authenticated', r.chu_ky);
    v_a := v_a + 1;
  end loop;
  for r in select chu_ky from public.acl_backup_00340 where service_role_goi_duoc loop
    execute format('grant execute on function %s to service_role', r.chu_ky);
    v_s := v_s + 1;
  end loop;
  raise notice '00340: trả lại % hàm cho authenticated, % hàm cho service_role', v_a, v_s;
end $tra_lai$;

-- ── Khối 5. Cấp lại ĐÚNG danh sách công khai, theo chữ ký đầy đủ ───────────
do $cong_khai$
declare r record;
begin
  for r in select chu_ky from _cho_phep_00340 loop
    execute format('grant execute on function %s to anon', r.chu_ky);
    raise notice '00340: giữ công khai %', r.chu_ky;
  end loop;
end $cong_khai$;

-- ── Khối 6. HẬU KIỂM TRONG TRANSACTION — sai là cuộn lại toàn bộ ───────────
do $hau_kiem$
declare
  v_n     int;
  v_ten   text;
  v_moi   oid;
begin
  -- K1. anon chỉ còn gọi được ĐÚNG danh sách công khai (đo quyền HIỆU LỰC).
  --     So bằng OID, KHÔNG so chuỗi: `oid::regprocedure::text` bỏ tiền tố
  --     schema khi public nằm trong search_path nên so chuỗi lệch oan.
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and has_function_privilege('anon', p.oid, 'EXECUTE')
    and p.oid not in (select to_regprocedure(chu_ky)::oid from _cho_phep_00340);
  if v_n <> 0 then
    select string_agg(x, ', ') into v_ten from (
      select p.oid::regprocedure::text as x
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and has_function_privilege('anon', p.oid, 'EXECUTE')
        and p.oid not in (select to_regprocedure(chu_ky)::oid from _cho_phep_00340)
      limit 10) t;
    raise exception
      '00340 THẤT BẠI: còn % hàm anon gọi được ngoài danh sách (ví dụ: %). '
      'Thường do hàm thuộc chủ sở hữu mà vai trò đang chạy không gỡ được. CUỘN LẠI.',
      v_n, v_ten;
  end if;

  -- K2. PUBLIC không còn gọi được hàm nào.
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
  lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where n.nspname = 'public' and a.privilege_type = 'EXECUTE' and a.grantee = 0;
  if v_n <> 0 then
    raise exception '00340 THẤT BẠI: còn % hàm cấp EXECUTE cho PUBLIC. CUỘN LẠI.', v_n;
  end if;

  -- K3. Quyền mặc định không còn anon và không còn PUBLIC (mục `=X/`).
  select count(*) into v_n
  from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace
  where d.defaclobjtype = 'f'
    and (n.nspname = 'public' or d.defaclnamespace = 0)
    and (d.defaclacl::text like '%anon=%' or d.defaclacl::text ~ '[{,]=[a-zA-Z]');
  if v_n <> 0 then
    raise exception '00340 THẤT BẠI: quyền mặc định vẫn cấp cho anon/PUBLIC. CUỘN LẠI.';
  end if;

  -- K4. authenticated và service_role KHÔNG mất quyền nào so với ảnh chụp.
  select count(*) into v_n from public.acl_backup_00340 b
  where b.authenticated_goi_duoc
    and not has_function_privilege('authenticated', b.ham_oid, 'EXECUTE');
  if v_n <> 0 then
    raise exception '00340 THẤT BẠI: authenticated mất quyền ở % hàm. CUỘN LẠI.', v_n;
  end if;
  select count(*) into v_n from public.acl_backup_00340 b
  where b.service_role_goi_duoc
    and not has_function_privilege('service_role', b.ham_oid, 'EXECUTE');
  if v_n <> 0 then
    raise exception '00340 THẤT BẠI: service_role mất quyền ở % hàm. CUỘN LẠI.', v_n;
  end if;

  -- K5. Và cũng KHÔNG được mở rộng thêm cho hai vai đó.
  select count(*) into v_n from public.acl_backup_00340 b
  where not b.authenticated_goi_duoc
    and has_function_privilege('authenticated', b.ham_oid, 'EXECUTE');
  if v_n <> 0 then
    raise exception '00340 THẤT BẠI: authenticated được mở rộng thêm % hàm. CUỘN LẠI.', v_n;
  end if;

  -- K6. Hàm tạo MỚI sau migration không tự mở cho anon/PUBLIC.
  --     Dựng thật một hàm trong chính transaction này rồi bỏ đi.
  create function public._kiem_00340_ham_moi() returns int language sql as $ktr$ select 1 $ktr$;
  select p.oid into v_moi from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = '_kiem_00340_ham_moi';
  if has_function_privilege('anon', v_moi, 'EXECUTE') then
    raise exception '00340 THẤT BẠI: hàm tạo mới VẪN tự mở cho anon. CUỘN LẠI.';
  end if;
  if exists (select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
             where p.oid = v_moi and a.privilege_type = 'EXECUTE' and a.grantee = 0) then
    raise exception '00340 THẤT BẠI: hàm tạo mới VẪN tự mở cho PUBLIC. CUỘN LẠI.';
  end if;
  drop function public._kiem_00340_ham_moi();

  -- K7. Hai hàm công khai vẫn gọi được (đăng nhập bằng SĐT không hỏng).
  select count(*) into v_n from _cho_phep_00340 c
  where not has_function_privilege('anon', to_regprocedure(c.chu_ky)::oid, 'EXECUTE');
  if v_n <> 0 then
    raise exception '00340 THẤT BẠI: % hàm công khai KHÔNG gọi được. CUỘN LẠI.', v_n;
  end if;

  raise notice '00340: ĐẠT — anon chỉ còn 2 hàm đăng nhập, PUBLIC sạch, authenticated/service_role nguyên vẹn, hàm mới không tự mở';
end $hau_kiem$;

commit;

notify pgrst, 'reload schema';
