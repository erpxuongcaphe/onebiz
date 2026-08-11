-- Read-only preflight for 00311. This query does not change business data.
select
  to_regclass('public.cash_transactions') is not null as cash_transactions_ok,
  to_regprocedure('public.get_user_tenant_id()') is not null as tenant_rpc_ok,
  to_regprocedure('public.user_has_permission(uuid,text)') is not null as permission_rpc_ok,
  to_regprocedure('public.user_has_branch_access(uuid,uuid)') is not null as branch_access_rpc_ok,
  to_regprocedure('public.get_user_accessible_branches(uuid)') is not null as accessible_branches_rpc_ok,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'cash_transactions'
      and column_name = 'transaction_date'
  ) as transaction_date_ok,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'cash_transactions'
      and column_name = 'status'
  ) as status_ok,
  exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'cash_transactions'
      and indexdef ilike '%tenant_id%status%transaction_date%'
  ) as list_index_ok,
  exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'cash_transactions'
      and c.relrowsecurity
  ) as rls_enabled,
  not exists (
    select 1 from public.cash_transactions ct
    where ct.type not in ('receipt', 'payment')
       or ct.payment_method not in ('cash', 'transfer', 'card', 'ewallet')
       or ct.status not in ('draft', 'completed', 'cancelled')
       or ct.transaction_date is null
  ) as existing_rows_contract_ok;
