-- Enable branch configuration only when the already-scoped document-line
-- reader and permission resolvers match the audited implementation.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$declare item record; begin
  for item in select * from (values
    ('public._staff_invoice_item_read(uuid,uuid,text)','af2d1bf3e2ba62b7554ab078d4cfe1ef'),
    ('public._staff_permission_at_scope(uuid,text,uuid)','0f22741487c3afa2ef7db89315b4fcfb'),
    ('public.user_has_permission_at_branch(uuid,text,uuid)','abd7622d7c37e24e2f8132042da93023')
  ) as required(signature, expected_hash) loop
    if not exists(select 1 from pg_proc p where p.oid=to_regprocedure(item.signature)
      and p.prosecdef and md5(replace(p.prosrc,chr(13),''))=item.expected_hash) then
      raise exception 'DOCUMENT_EXPORT_SCOPE_BASELINE_CHANGED: %',item.signature;
    end if;
  end loop;
end$$;
insert into public.staff_branch_permission_catalog(permission_code,enforcement_version)
values ('orders.export',1),('invoices.export',1);
commit;
