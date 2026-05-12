-- ============================================================
-- 00063: Fix hash_manager_otp — pgcrypto.digest search_path
--
-- CEO 12/05/2026 test thực tế phát hiện lỗi runtime:
--   issue_manager_otp() POST 404
--   { "code":"42883",
--     "message":"function digest(text, unknown) does not exist",
--     "hint":"No function matches the given name and argument types..." }
--
-- Root cause:
--   - Supabase cài pgcrypto vào schema `extensions`, không phải `public`
--   - 00061 set search_path = public cho hash_manager_otp → không thấy
--     digest() → 42883
--   - Đồng thời 'sha256' bị infer là `unknown` thay vì `text`
--
-- Fix:
--   - Thêm `extensions` vào search_path
--   - Cast input sang bytea + 'sha256'::text rõ ràng để tránh unknown type
-- ============================================================

create or replace function public.hash_manager_otp(
  p_code text,
  p_tenant_id uuid,
  p_issued_by uuid
) returns text
language sql
immutable
set search_path = public, extensions
as $$
  select encode(
    digest(
      (p_code || ':' || p_tenant_id::text || ':' || p_issued_by::text)::bytea,
      'sha256'::text
    ),
    'hex'
  );
$$;

comment on function public.hash_manager_otp is
  'sha256(code || tenant || issued_by) → hex. Search_path bao gồm extensions để thấy pgcrypto.digest.';

-- Notify PostgREST reload (no-op nếu chạy ngoài migration, an toàn)
notify pgrst, 'reload schema';
