-- 00357 rollback: remove only the new write entry point.
-- Existing variants, BOMs, recipes, orders and stock data are untouched.

begin;

drop function if exists public.save_fnb_size_setup_atomic(uuid, jsonb);

commit;

notify pgrst, 'reload schema';
