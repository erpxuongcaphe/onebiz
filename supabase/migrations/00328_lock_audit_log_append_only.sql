-- ============================================================================
-- 00328 — Đợt A1: sổ nhật ký chỉ được THÊM, không được sửa/xoá
--
-- HIỆN TRẠNG (preflight F7b 15/08): `authenticated` có đủ DELETE / INSERT /
-- SELECT / UPDATE / TRUNCATE trên `public.audit_log` → bất kỳ ai đăng nhập
-- cũng sửa hoặc xoá được dấu vết thao tác của chính mình. Sổ nhật ký mà sửa
-- được thì không còn giá trị đối chiếu.
--
-- 00328 làm: giữ SELECT + INSERT (client còn ghi audit trực tiếp và các màn
-- Lịch sử / Hồ sơ còn đọc), thu hồi UPDATE + DELETE + TRUNCATE.
--
-- KHÔNG đụng RLS, bảng, cột, dữ liệu. Không gộp với F1b (3 bảng cấu hình bàn).
-- ============================================================================

revoke update, delete, truncate on public.audit_log from authenticated;
revoke update, delete, truncate on public.audit_log from anon;

-- ── Hậu kiểm ──
do $$
declare
  v_sua int;
  v_giu int;
begin
  select count(*) into v_sua
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'audit_log'
    and grantee in ('authenticated','anon')
    and privilege_type in ('UPDATE','DELETE','TRUNCATE');
  if v_sua <> 0 then
    raise exception '00328 that bai: van con % quyen sua/xoa nhat ky', v_sua;
  end if;

  -- SELECT + INSERT phải còn, nếu mất thì trang Lịch sử trắng và app hết ghi audit
  select count(*) into v_giu
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'audit_log'
    and grantee = 'authenticated'
    and privilege_type in ('SELECT','INSERT');
  if v_giu <> 2 then
    raise exception '00328 that bai: mat quyen doc/ghi nhat ky (con % / 2)', v_giu;
  end if;

  raise notice '00328: OK — nhat ky chi con THEM va DOC, khong sua/xoa duoc';
end $$;
