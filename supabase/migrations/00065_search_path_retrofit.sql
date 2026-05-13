-- ============================================================
-- 00065: Retrofit `set search_path` cho mọi SECURITY DEFINER function
--
-- CEO 12/05/2026 audit phát hiện cùng class bug như 00063:
--   00063 phải fix runtime cho hash_manager_otp vì search_path = public
--   không thấy extensions.digest() của pgcrypto. Bug 42883.
--
--   20+ RPC SECURITY DEFINER cũ (00007, 00011, 00027, 00055) thiếu
--   `set search_path` → cùng class bug, chờ explode khi extension call.
--
-- Fix: scan pg_proc tìm tất cả SECURITY DEFINER chưa có search_path,
-- ALTER FUNCTION ... SET search_path = public, extensions.
--
-- ALTER chỉ thay metadata, KHÔNG rewrite body → instant, reversible,
-- không ảnh hưởng business logic.
--
-- Idempotent: chạy lại không break (skip function đã có search_path).
-- ============================================================

do $$
declare
  func_sig text;
  cnt int := 0;
begin
  for func_sig in
    select p.oid::regprocedure::text
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prosecdef = true  -- chỉ SECURITY DEFINER
      and (
        p.proconfig is null
        or not exists (
          select 1 from unnest(p.proconfig) as cfg
          where cfg like 'search_path=%'
        )
      )
  loop
    execute format(
      'alter function %s set search_path = public, extensions',
      func_sig
    );
    cnt := cnt + 1;
    raise notice '  ✓ search_path hardened: %', func_sig;
  end loop;

  raise notice 'Tổng cộng % function đã retrofit search_path.', cnt;
end $$;

-- ────────────────────────────────────────────────────────────────
-- Verify: sau khi chạy, query này phải trả 0 row
-- ────────────────────────────────────────────────────────────────
-- select p.oid::regprocedure::text
-- from pg_proc p
-- where p.pronamespace = 'public'::regnamespace
--   and p.prosecdef = true
--   and (
--     p.proconfig is null
--     or not exists (
--       select 1 from unnest(p.proconfig) as cfg
--       where cfg like 'search_path=%'
--     )
--   );

-- ────────────────────────────────────────────────────────────────
-- Rollback: nếu cần revert (KHÔNG khuyến nghị)
-- ────────────────────────────────────────────────────────────────
-- do $$
-- declare func_sig text;
-- begin
--   for func_sig in
--     select p.oid::regprocedure::text
--     from pg_proc p
--     where p.pronamespace = 'public'::regnamespace
--       and p.prosecdef = true
--   loop
--     execute format('alter function %s reset search_path', func_sig);
--   end loop;
-- end $$;

notify pgrst, 'reload schema';
