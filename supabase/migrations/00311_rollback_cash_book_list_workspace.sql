-- Rollback for 00311. No business rows are changed.
drop function if exists public.get_cash_book_list_workspace(
  integer, integer, text, text, text[], text[], text[], text[], date, date, numeric, numeric, uuid
);

notify pgrst, 'reload schema';
