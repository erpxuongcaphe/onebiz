-- Synchronize the management API release version; this file does not grant rights.
do $$declare x record;begin
 if not exists(select 1 from public.staff_branch_permission_catalog where permission_code='finance.export_cash_journal') then
  raise exception 'FINANCE_EXPORT_SCOPE_NOT_APPLIED';end if;
 for x in select * from (values
  ('public.cash_journal_list_v1(date,date,uuid,text,text,text,text,boolean,integer,boolean,text)','29b75a1c33238cd64ca639b14c0132f7'),
  ('public.cash_journal_list_v2(date,date,uuid,text,text,text,text,boolean,integer,boolean,text)','cbe85e6a0e83cabdd1cd4eded54677db'),
  ('public.export_b2_plan_v1(uuid,date)','0ac66a6f8efeac17c108759739f03654'),
  ('public.get_store_finance_reporting_source(text,date,date,uuid,text,boolean)','9e8ec0c6f4d72925a4038ba94bb8b2ab')) v(signature,hash)
 loop if not exists(select 1 from pg_proc p where p.oid=to_regprocedure(x.signature) and md5(replace(p.prosrc,chr(13),''))=x.hash) then
  raise exception 'FINANCE_EXPORT_RELEASE_CHANGED: %',x.signature;end if;end loop;
end$$;
