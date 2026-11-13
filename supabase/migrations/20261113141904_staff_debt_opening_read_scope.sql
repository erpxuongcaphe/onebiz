-- Existing branch membership is necessary but not sufficient to read an
-- individual party's opening debt. Keep the existing branch/tenant policies
-- and the separate legacy company-wide unassigned-balance report rule.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
begin
 if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname='debt_opening_balances' and c.relrowsecurity)
  or not exists(select 1 from pg_policies p where p.schemaname='public' and p.tablename='debt_opening_balances'
   and p.policyname='debt_opening_balances_select' and p.cmd='SELECT')
  or not exists(select 1 from pg_policies p where p.schemaname='public' and p.tablename='debt_opening_balances'
   and p.policyname='transaction_branch_read_00567' and p.permissive='RESTRICTIVE' and p.cmd='SELECT') then
  raise exception 'STAFF_DEBT_OPENING_BASE_SCOPE_MISSING';
 end if;
end
$migration$;
create policy staff_debt_opening_permission_read on public.debt_opening_balances as restrictive
 for select to authenticated using (
  case when branch_id is null then (select public.user_has_permission((select auth.uid()),'finance.view_reports'))
   when party_type='customer' then (select public.user_has_permission((select auth.uid()),'customers.view_debt'))
    or (select public.user_has_permission((select auth.uid()),'customers.import'))
   when party_type='supplier' then (select public.user_has_permission((select auth.uid()),'suppliers.view_debt'))
    or (select public.user_has_permission((select auth.uid()),'suppliers.import'))
   else false end
 );
commit;
