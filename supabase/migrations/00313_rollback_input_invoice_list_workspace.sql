drop function if exists public.get_input_invoice_list_workspace(
  integer, integer, text, text, text, timestamptz, timestamptz, numeric, numeric, uuid
);

notify pgrst, 'reload schema';
