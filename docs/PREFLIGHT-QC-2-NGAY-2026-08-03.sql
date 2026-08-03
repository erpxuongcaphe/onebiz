-- READ-ONLY preflight for production fixes from the last two days.
-- This file contains SELECT statements only. It does not alter business data.

-- 1. Web-to-database function contracts used by the recent fixes.
with required(area, signature, execute_role) as (
  values
    ('POS', 'public.save_pos_draft_atomic_v3(uuid,uuid,jsonb,text,numeric,numeric,numeric,text,text,boolean,uuid,bigint)', 'authenticated'),
    ('POS', 'public.adopt_pos_draft_session_atomic_v2(uuid,text,bigint)', 'authenticated'),
    ('POS', 'public.complete_draft_atomic_v5(uuid,uuid,jsonb,text,numeric,jsonb,uuid,uuid,text,integer,text,numeric,uuid,text,numeric,numeric,boolean,numeric,numeric,text,bigint,numeric)', 'authenticated'),
    ('POS', 'public.get_pos_invoice_integrity_report(timestamptz,timestamptz,uuid,integer)', 'authenticated'),
    ('POS internal', 'public.pos_prepare_retail_checkout(uuid,uuid,uuid,uuid,jsonb,text,numeric,uuid,text,integer,uuid,numeric,numeric)', 'service_role'),
    ('POS internal', 'public.assert_pos_stock_available(uuid,uuid,jsonb,boolean)', null),
    ('Sales order', 'public.save_sales_order_atomic(uuid,text,uuid,uuid,jsonb,numeric,text,uuid,text,text,text)', 'authenticated'),
    ('Debt', 'public.get_receivable_aging_report(uuid,timestamptz,uuid)', 'authenticated'),
    ('Debt', 'public.get_payable_aging_report(uuid,timestamptz)', 'authenticated'),
    ('Debt', 'public.upsert_debt_opening_balance_atomic(text,uuid,uuid,numeric,date,text)', 'authenticated'),
    ('Documents', 'public.set_input_invoice_state_atomic(uuid,text,text)', 'authenticated'),
    ('Documents', 'public.cancel_internal_sale_atomic(uuid,text)', 'authenticated'),
    ('Shift', 'public.close_shift_atomic(uuid,numeric,text)', 'authenticated'),
    ('Shift', 'public.mark_overdue_shifts_for_branch(uuid)', 'authenticated'),
    ('Shift', 'public.reconcile_pending_shift(uuid,numeric,text,text)', 'authenticated'),
    ('Authorization', 'public.get_user_effective_permissions(uuid)', 'authenticated'),
    ('Authorization', 'public.user_has_permission(uuid,text)', null),
    ('Reports', 'public.assert_report_access(text,uuid)', null)
)
select
  area,
  signature,
  to_regprocedure(signature) is not null as installed,
  case
    when execute_role is null then true
    else coalesce(
      has_function_privilege(execute_role, to_regprocedure(signature), 'EXECUTE'),
      false
    )
  end as execute_permission_ok
from required
order by area, signature;

-- 2. Removed-column and typo scan in the live functions, not migration files.
with live_functions as (
  select p.oid, p.proname, pg_get_functiondef(p.oid) as definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
)
select
  proname as function_name,
  case
    when position('p.status' in definition) > 0
      and position('public.products' in definition) > 0
      then 'REMOVED_PRODUCTS_STATUS'
    when position('num_nonnull(' in definition) > 0
      then 'LEGACY_NUM_NONNULL_TYPO'
  end as problem
from live_functions
where (
  position('p.status' in definition) > 0
  and position('public.products' in definition) > 0
)
or position('num_nonnull(' in definition) > 0
order by function_name;

-- 3. Required columns for POS revision control and shift reconciliation.
with required(table_name, column_name) as (
  values
    ('invoices', 'client_session_id'),
    ('invoices', 'draft_revision'),
    ('invoices', 'order_code'),
    ('invoices', 'deleted_at'),
    ('products', 'is_active'),
    ('products', 'allow_sale'),
    ('shifts', 'auto_marked_pending_at'),
    ('shifts', 'reconciled_by'),
    ('shifts', 'reconciled_at'),
    ('shifts', 'reconcile_reason'),
    ('shifts', 'expected_cash'),
    ('shifts', 'actual_cash'),
    ('shifts', 'cash_difference'),
    ('shifts', 'total_sales'),
    ('shifts', 'total_orders'),
    ('branches', 'shift_cutoff_hour')
)
select
  r.table_name,
  r.column_name,
  c.column_name is not null as installed
from required r
left join information_schema.columns c
  on c.table_schema = 'public'
 and c.table_name = r.table_name
 and c.column_name = r.column_name
order by r.table_name, r.column_name;

-- 4. Shift report/view/RLS dependencies.
select
  to_regclass('public.pending_shifts_view') is not null as pending_view_ok,
  coalesce(
    (select 'security_invoker=true' = any(c.reloptions)
     from pg_class c
     where c.oid = to_regclass('public.pending_shifts_view')),
    false
  ) as pending_view_security_invoker_ok,
  coalesce(
    (select c.relrowsecurity from pg_class c where c.oid = 'public.shifts'::regclass),
    false
  ) as shifts_rls_enabled,
  exists (
    select 1 from pg_policy p
    where p.polrelid = 'public.shifts'::regclass
      and p.polcmd in ('r', '*')
  ) as shifts_select_policy_ok,
  exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.shifts'::regclass
      and c.conname = 'shifts_cashier_id_fkey'
  ) as cashier_fk_ok;

-- 5. Effective permissions for both Huyen Trang accounts mentioned in QC.
with relevant_permissions(permission_code) as (
  values
    ('pos_retail.checkout'),
    ('reports.analytics'),
    ('reports.view_detail'),
    ('reports.view_all_branches'),
    ('shifts.reconcile_any'),
    ('shifts.reconcile_own_branch')
)
select
  p.id as user_id,
  p.full_name,
  p.is_active,
  p.branch_id,
  rp.permission_code,
  public.user_has_permission(p.id, rp.permission_code) as effective_permission
from public.profiles p
cross join relevant_permissions rp
where lower(p.full_name) like '%huyền trang%'
order by p.full_name, rp.permission_code;

-- 6. Branch access configured for those accounts.
select
  p.id as user_id,
  p.full_name,
  p.branch_id as primary_branch_id,
  b.name as primary_branch_name,
  ub.branch_id as additional_branch_id,
  ab.name as additional_branch_name
from public.profiles p
left join public.branches b on b.id = p.branch_id
left join public.user_branches ub on ub.user_id = p.id
left join public.branches ab on ab.id = ub.branch_id
where lower(p.full_name) like '%huyền trang%'
order by p.full_name, ab.name;
