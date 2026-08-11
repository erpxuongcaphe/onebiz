-- Rollback for 00312. No business rows are changed.
drop function if exists public.get_purchase_order_list_workspace(
  integer, integer, text, text, text, timestamptz, timestamptz, numeric, numeric, uuid
);

notify pgrst, 'reload schema';
