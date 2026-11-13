-- Preserve each existing policy's tenant, branch and independent operation
-- checks while resolving the two cash permissions at the selected branch.
-- The cash-book exception is still not exposed until all consumers are audited.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create function public._staff_my_cash_create(p_branch uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and public._staff_permission_at_scope(auth.uid(),'finance.create_transaction',p_branch)
$$;
revoke all on function public._staff_my_cash_create(uuid) from public,anon;
grant execute on function public._staff_my_cash_create(uuid) to authenticated;

do $migration$
declare item record; source text;
begin
 for item in select * from (values
  ('cash_amendments','cash_amendment_read','finance.view_cash_book'),
  ('money_accounts','money_account_read','finance.create_transaction'),
  ('party_advance_refunds','party_advance_refund_read','finance.view_cash_book')
 ) as expected(table_name,policy_name,permission_anchor) loop
  select p.qual into source from pg_catalog.pg_policies p
   where p.schemaname='public' and p.tablename=item.table_name and p.policyname=item.policy_name and p.cmd='SELECT';
  if source is null or position(item.permission_anchor in source)=0
   or position('user_has_branch_access' in source)=0 then
   raise exception 'STAFF_CASH_READ_POLICY_CHANGED: %.%',item.table_name,item.policy_name;
  end if;
 end loop;
end $migration$;

alter policy cash_amendment_read on public.cash_amendments using (
 exists(select 1 from public.cash_transactions c join public.profiles p
  on p.id=(select auth.uid()) and coalesce(p.is_active,true)
  where c.id=cash_amendments.original_cash_id and c.tenant_id=cash_amendments.tenant_id
   and p.tenant_id=c.tenant_id and public.user_has_branch_access((select auth.uid()),c.branch_id)
   and public._staff_my_cash_book_view(c.branch_id))
);
alter policy money_account_read on public.money_accounts using (
 tenant_id=(select p.tenant_id from public.profiles p where p.id=(select auth.uid()) and coalesce(p.is_active,true))
 and public.user_has_branch_access((select auth.uid()),branch_id)
 and (public._staff_my_cash_book_view(branch_id) or public._staff_my_cash_create(branch_id))
);
alter policy party_advance_refund_read on public.party_advance_refunds using (
 tenant_id=public.get_user_tenant_id() and public.user_has_branch_access((select auth.uid()),branch_id)
 and public._staff_my_cash_book_view(branch_id)
 and public.user_has_permission((select auth.uid()),case mode when 'customer' then 'customers.view_debt' else 'suppliers.view_debt' end)
);
commit;
