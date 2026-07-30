-- ============================================================
-- 00239 — 🔴 GẤP: khoá lại dữ liệu đang đọc được mà không cần đăng nhập
-- ============================================================
-- PHÁT HIỆN 30/07/2026, đã xác minh bằng chính chìa khoá công khai của web
-- (chìa nhúng sẵn trong trang, ai xem mã nguồn cũng lấy được):
--
--   invoices           255 dòng   đọc được
--   cash_transactions  324 dòng   đọc được
--   customers           98 dòng   đọc được  ← tên + điện thoại khách
--   products           772 dòng   đọc được  ← giá vốn
--   bom_items          714 dòng   đọc được  ← công thức
--   profiles            13 dòng   đọc được  ← nhân sự
--   tenants             10 dòng   đọc được  ← CẢ CÁC TENANT KHÁC
--
-- Thử GHI bằng chìa công khai: bị chặn bởi ràng buộc NOT NULL (23502),
-- KHÔNG phải bởi quyền (42501) → nghĩa là tầng quyền cho qua, điền đủ
-- trường là ghi được. (Không dòng nào được tạo trong lúc thử — payload rỗng.)
--
-- ═══ NGUYÊN NHÂN GỐC ═══
-- Migration 00010_dev_disable_rls.sql tắt Row Level Security trên 54 bảng.
-- Chính file đó ghi ở đầu:
--     "⚠️ DEV-ONLY — KHÔNG ĐƯỢC CHẠY TRÊN PRODUCTION"
--     "Khi nào ROLLBACK (BẮT BUỘC trước khi production)"
-- Bước bật lại chưa bao giờ được làm. Các bảng MKT thêm sau (00196+) có bật
-- RLS đầy đủ — đó là lý do `shifts` và `user_permission_overrides` vẫn kín.
--
-- ═══ CÁCH VÁ — HAI LỚP, LỚP 1 GẦN NHƯ KHÔNG THỂ GÂY HỎNG ═══
--
-- LỚP 1 (phần chính của file này): thu hồi quyền của vai trò `anon`.
--   `anon` = người CHƯA đăng nhập. Web thật không bao giờ đọc dữ liệu bằng
--   vai trò này — người dùng đăng nhập xong thì mọi câu lệnh đi bằng vai trò
--   `authenticated`. Nên thu hồi `anon` KHÔNG đổi gì với nhân viên đang dùng,
--   mà đóng hẳn lỗ công khai.
--   Đăng nhập vẫn chạy: nó dùng schema `auth`, không phải `public`.
--
-- LỚP 2 (KHÔNG làm trong file này): bật lại RLS trên 54 bảng để cách ly giữa
--   các tenant. Việc đó rủi ro hơn — bảng nào chưa có policy mà bật RLS là
--   khoá luôn cả nhân viên. Phải rà từng bảng trước. Xem cuối file.
--
-- ⚠️ KHÔNG đụng một dòng dữ liệu nào. Chỉ đổi quyền.
-- ⚠️ Có đường lùi ở cuối file nếu web hỏng sau khi chạy.
-- ============================================================

-- ── 1. Chặn vai trò chưa-đăng-nhập đọc/ghi dữ liệu ──
revoke all privileges on all tables    in schema public from anon;
revoke all privileges on all sequences in schema public from anon;

-- Bảng mới tạo sau này cũng mặc định không cấp cho anon
alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- ── 2. Giữ đúng 2 hàm mà trang ĐĂNG NHẬP cần khi chưa có phiên ──
-- Đăng nhập bằng số điện thoại phải tra email trước khi có phiên (00036/00191).
-- Không mở lại thì nhân viên đăng nhập bằng SĐT sẽ hỏng.
do $$
begin
  if to_regprocedure('public.get_email_by_phone(text)') is not null then
    execute 'grant execute on function public.get_email_by_phone(text) to anon';
  end if;
  if to_regprocedure('public.normalize_phone(text)') is not null then
    execute 'grant execute on function public.normalize_phone(text) to anon';
  end if;
end $$;

-- ── 3. Chắc chắn vai trò đã đăng nhập vẫn đủ quyền (không đổi hiện trạng) ──
grant usage on schema public to authenticated;
grant all privileges on all tables    in schema public to authenticated;
grant all privileges on all sequences in schema public to authenticated;

-- ── 4. Đối soát ngay trong migration ──
do $$
declare
  v_con int;
begin
  select count(*) into v_con
    from information_schema.role_table_grants
   where grantee = 'anon' and table_schema = 'public';

  if v_con > 0 then
    raise exception '00239 FAIL: vai trò anon vẫn còn quyền trên % bảng', v_con;
  end if;
  raise notice '00239 OK: anon không còn quyền trên bảng nào trong schema public.';
  raise notice '00239: vai trò authenticated giữ nguyên quyền — nhân viên dùng bình thường.';
end $$;

notify pgrst, 'reload schema';

-- ============================================================
-- ĐỐI CHIẾU SAU KHI CHẠY (làm cả 3 bước)
-- ============================================================
-- 1) Từ máy CEO, thử đọc bằng chìa công khai — phải KHÔNG ra dòng nào:
--    Mở trình duyệt ẩn danh, dán vào thanh địa chỉ (thay <ANON_KEY>):
--    https://<project>.supabase.co/rest/v1/invoices?select=id&apikey=<ANON_KEY>
--    Mong đợi: lỗi permission denied. Nếu vẫn ra dữ liệu → gọi em ngay.
--
-- 2) Mở web bình thường, đăng nhập, xem 5 trang: Hàng hoá · Hoá đơn · Sổ quỹ ·
--    Tồn kho · Báo cáo. Mọi thứ phải hiện y như trước.
--
-- 3) Thử đăng nhập bằng SỐ ĐIỆN THOẠI (nếu có nhân viên dùng cách này).
--
-- ============================================================
-- ĐƯỜNG LÙI — chỉ dùng nếu web hỏng sau khi chạy
-- ============================================================
-- grant usage on schema public to anon;
-- grant select on all tables in schema public to anon;
--
-- ============================================================
-- LỚP 2 — VIỆC CÒN LẠI (cần rà trước, đừng chạy vội)
-- ============================================================
-- Sau khi lớp 1 đóng lỗ công khai, còn việc cách ly giữa các tenant cho vai
-- trò đã đăng nhập. Trước khi bật lại RLS, chạy câu này để biết bảng nào
-- CHƯA CÓ POLICY — bật RLS lên những bảng đó là khoá luôn nhân viên:
--
-- select c.relname as bang,
--        c.relrowsecurity as rls_dang_bat,
--        count(p.polname) as so_policy
--   from pg_class c
--   join pg_namespace n on n.oid = c.relnamespace
--   left join pg_policy p on p.polrelid = c.oid
--  where n.nspname = 'public' and c.relkind = 'r'
--  group by 1, 2
--  order by so_policy asc, bang;
--
-- Bảng nào so_policy = 0 → phải viết policy TRƯỚC, rồi mới bật RLS.
