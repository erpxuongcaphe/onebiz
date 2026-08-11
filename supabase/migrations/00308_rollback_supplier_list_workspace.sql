-- Rollback for 00308. Drops only the read-only list RPC.
drop function if exists public.get_supplier_list_workspace(
  integer, integer, text, text, text[], timestamptz, timestamptz, text,
  numeric, numeric, numeric, numeric
);

notify pgrst, 'reload schema';
