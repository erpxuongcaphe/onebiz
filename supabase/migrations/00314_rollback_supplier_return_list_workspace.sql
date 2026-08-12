drop function if exists public.get_supplier_return_list_workspace(
  integer,integer,text,text,text,timestamptz,timestamptz,numeric,numeric,uuid
);
notify pgrst,'reload schema';
