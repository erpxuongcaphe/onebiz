begin;
-- Only next_code's owner calls this internal helper, never anonymous/authenticated clients.
do $$ begin
  if to_regprocedure('public.allocate_invoice_code(uuid)') is not null then
    revoke all on function public.allocate_invoice_code(uuid) from public,anon,authenticated;
  end if;
end; $$;
commit;
