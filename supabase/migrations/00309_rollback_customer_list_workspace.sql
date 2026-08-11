drop function if exists public.get_customer_list_workspace(
  integer, integer, text, text, uuid[], text, text, text, text, text, text,
  integer, text[], timestamptz, timestamptz, text
);

notify pgrst, 'reload schema';
