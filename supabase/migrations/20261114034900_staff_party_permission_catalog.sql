-- Expose these four controls only when every supporting read/write guard is in
-- place. This creates no staff overrides and preserves all existing grants.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$declare item record;begin
 for item in select * from (values
  ('_party_directory_scope_private','578d5bdcab481859617640148801e8a3'),
  ('_staff_party_directory_scope_v2_private','d60815d91887f9749bbea9ca602e7235'),
  ('get_customer_list_workspace_scoped_v2','821290dd568b878c9c89924a6c3b6fc1'),
  ('get_supplier_list_workspace_scoped_v2','99696e806b85e1f1ef91e34f3a2c51f9'),
  ('get_party_history_scoped_v2','97963e12022c6d3a2ddfbfb7a78b4952'),
  ('get_supplier_receipt_workspace_v2','8650ce8f9b06570196cdc5f81a9c276c'),
  ('get_party_debt_movements','2e5e98b53d96473105afe804bba94593'),
  ('get_document_payment_history_scoped','1e807d9f87bcab2b8c7a8797236c0632'),
  ('get_customer_report_balances_v1','15cc85c486f6fb5cd2c8c3a2c62de82b'),
  ('get_party_advance_ledger_00553','088befcf009bafe5fa703ddd49f44ca5'),
  ('get_party_cash_history_detail_00553','e22032f60ee4594f0d735dfdef094834'),
  ('settle_party_documents_atomic','5fe1321c7bc9edd04bbb83ace1407d5c'),
  ('refund_party_advance','8706427a34e2a4d531cc4cb849506e69'),
  ('cancel_party_advance_refund','cda64af63255e88890b483d6ca92a630'),
  ('staff_my_party_debt_branches','6188bbbce55fb880e4b30499f8882fef')
 ) x(name,hash) loop
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname=item.name and p.prosecdef and md5(replace(p.prosrc,chr(13),''))=item.hash)<>1 then
    raise exception 'PARTY_SCOPE_RELEASE_GUARD_FAILED: %',item.name;end if;
 end loop;
 for item in select * from (values
  ('customer_advance_allocations','customer_advance_allocations_select','4416175c35a1160ba5f1e837b14aae99'),
  ('customer_advances','customer_advances_select','4416175c35a1160ba5f1e837b14aae99'),
  ('supplier_advance_allocations','supplier_advance_allocations_select','625f6e5b8272ddd7d5f354d0306c110c'),
  ('supplier_advances','supplier_advances_select','625f6e5b8272ddd7d5f354d0306c110c'),
  ('party_advance_refunds','party_advance_refund_read','a7065a26419aab012b6ef22c104981dd'),
  ('debt_opening_balances','staff_debt_opening_permission_read','2fec40e8ae593e71bede9b05a5b09af9')
 ) x(tab,pol,hash) loop
  if not exists(select 1 from pg_policies where schemaname='public' and tablename=item.tab and policyname=item.pol and md5(qual)=item.hash) then
   raise exception 'PARTY_SCOPE_POLICY_RELEASE_GUARD_FAILED: %',item.pol;end if;
 end loop;
 if exists(select 1 from public.staff_branch_permission_catalog where permission_code in ('customers.view_sales','customers.view_debt','suppliers.view_purchases','suppliers.view_debt'))
  or exists(select 1 from public.user_branch_permission_overrides where permission_code in ('customers.view_sales','customers.view_debt','suppliers.view_purchases','suppliers.view_debt')) then
  raise exception 'PARTY_SCOPE_UNEXPECTED_EXISTING_OVERRIDES';end if;
end$$;
insert into public.staff_branch_permission_catalog(permission_code,enforcement_version) values
 ('customers.view_sales',1),('customers.view_debt',1),('suppliers.view_purchases',1),('suppliers.view_debt',1);
commit;
