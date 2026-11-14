-- Marker for the management API release; the preceding migration does the work.
do $$begin
 if (select count(*) from public.staff_branch_permission_catalog where permission_code in ('orders.export','invoices.export')) <> 2 then
  raise exception 'DOCUMENT_EXPORT_RELEASE_INCOMPLETE';
 end if;
end$$;
