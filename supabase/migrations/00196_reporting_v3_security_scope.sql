-- ============================================================
-- 00196: Reporting V3 security, scope, and cost snapshots
-- ============================================================

-- Capability migration keeps current users working without tying access to titles.
insert into public.role_permissions (role_id, permission_code)
select distinct rp.role_id, mapped.permission_code
from public.role_permissions rp
cross join lateral (
  values (
    case
      when rp.permission_code in ('reports.analytics', 'reports.fnb')
        then 'reports.view_detail'
      when rp.permission_code = 'reports.export'
        then 'reports.export_detail'
      when rp.permission_code = 'system.manage_branches'
        then 'reports.view_all_branches'
    end
  )
) mapped(permission_code)
where mapped.permission_code is not null
on conflict (role_id, permission_code) do nothing;

with mapped as (
  select
    o.tenant_id,
    o.user_id,
    case
      when o.permission_code in ('reports.analytics', 'reports.fnb')
        then 'reports.view_detail'
      when o.permission_code = 'reports.export'
        then 'reports.export_detail'
      when o.permission_code = 'system.manage_branches'
        then 'reports.view_all_branches'
    end as permission_code,
    o.override_type,
    o.created_by
  from public.user_permission_overrides o
  where o.override_type in ('grant', 'revoke')
)
insert into public.user_permission_overrides (
  tenant_id, user_id, permission_code, override_type, note, created_by
)
select
  tenant_id,
  user_id,
  permission_code,
  override_type,
  'Migrated from an equivalent explicit override by 00196',
  created_by
from mapped
where permission_code is not null
on conflict (tenant_id, user_id, permission_code) do nothing;

-- Server authorization derives the actor from auth.uid().
create or replace function public.assert_report_access(
  p_permission_code text,
  p_branch_id uuid default null
) returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_tenant_id uuid;
begin
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'REPORT_AUTH_REQUIRED';
  end if;

  select p.tenant_id into v_tenant_id
  from public.profiles p
  where p.id = v_actor_id
    and coalesce(p.is_active, true);

  if v_tenant_id is null then
    raise exception using errcode = '42501', message = 'REPORT_PROFILE_INACTIVE';
  end if;

  if not public.user_has_permission(v_actor_id, p_permission_code) then
    raise exception using errcode = '42501', message = 'REPORT_PERMISSION_DENIED';
  end if;

  if p_branch_id is null then
    if not (
      public.user_has_permission(v_actor_id, 'reports.view_all_branches')
      or public.user_has_permission(v_actor_id, 'system.manage_branches')
    ) then
      raise exception using errcode = '42501', message = 'REPORT_ALL_BRANCHES_DENIED';
    end if;
  elsif not exists (
    select 1
    from public.branches b
    where b.id = p_branch_id
      and b.tenant_id = v_tenant_id
      and public.user_has_branch_access(v_actor_id, b.id)
  ) then
    raise exception using errcode = '42501', message = 'REPORT_BRANCH_DENIED';
  end if;
end;
$$;

revoke all on function public.assert_report_access(text, uuid) from public, anon;
grant execute on function public.assert_report_access(text, uuid) to authenticated;

-- Snapshot cost only for new sales. Legacy history is intentionally not backfilled.
alter table public.invoice_items
  add column if not exists unit_cost numeric(15,4);

comment on column public.invoice_items.unit_cost is
  'Cost snapshot at sale time. NULL means legacy/unknown and must be labelled estimated in reports.';

create or replace function public.set_invoice_item_unit_cost()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.unit_cost is null then
    select p.cost_price into new.unit_cost
    from public.products p
    where p.id = new.product_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_invoice_items_cost_snapshot on public.invoice_items;
create trigger trg_invoice_items_cost_snapshot
before insert on public.invoice_items
for each row execute function public.set_invoice_item_unit_cost();

revoke all on function public.set_invoice_item_unit_cost()
  from public, anon, authenticated;

-- Read-path indexes; these statements do not rewrite business rows.
create index if not exists idx_invoices_report_branch_date
  on public.invoices (tenant_id, branch_id, created_at desc)
  where status = 'completed';

create index if not exists idx_invoices_report_customer_date
  on public.invoices (tenant_id, customer_id, created_at)
  where status = 'completed' and customer_id is not null;

create index if not exists idx_invoice_items_report_product
  on public.invoice_items (product_id, invoice_id);

create index if not exists idx_cash_report_branch_date
  on public.cash_transactions (tenant_id, branch_id, created_at desc, type);

create index if not exists idx_product_lots_report_scope
  on public.product_lots (tenant_id, branch_id, status, expiry_date);

-- Preserve audited calculations privately and regenerate guarded public wrappers.
do $migration$
declare
  r record;
  v_legacy_name text;
begin
  for r in
    select *
    from (values
      (
        'get_inventory_aging_report',
        'uuid, uuid',
        'p_tenant_id uuid default null, p_branch_id uuid default null',
        'p_branch_id',
        'reports.analytics',
        'p_tenant_id, p_branch_id'
      ),
      (
        'get_disposal_loss_report',
        'timestamptz, timestamptz, uuid, uuid',
        'p_date_from timestamptz default null, p_date_to timestamptz default null, p_branch_id uuid default null, p_tenant_id uuid default null',
        'p_branch_id',
        'reports.analytics',
        'p_date_from, p_date_to, p_branch_id, p_tenant_id'
      ),
      (
        'get_inventory_variance_report',
        'timestamptz, timestamptz, uuid, uuid',
        'p_date_from timestamptz default null, p_date_to timestamptz default null, p_branch_id uuid default null, p_tenant_id uuid default null',
        'p_branch_id',
        'reports.analytics',
        'p_date_from, p_date_to, p_branch_id, p_tenant_id'
      ),
      (
        'get_sales_return_report',
        'timestamptz, timestamptz, uuid, uuid',
        'p_date_from timestamptz default null, p_date_to timestamptz default null, p_branch_id uuid default null, p_tenant_id uuid default null',
        'p_branch_id',
        'reports.analytics',
        'p_date_from, p_date_to, p_branch_id, p_tenant_id'
      ),
      (
        'get_staff_revenue_report',
        'timestamptz, timestamptz, text, uuid, uuid',
        'p_date_from timestamptz default null, p_date_to timestamptz default null, p_source text default null, p_branch_id uuid default null, p_tenant_id uuid default null',
        'p_branch_id',
        'reports.analytics',
        'p_date_from, p_date_to, p_source, p_branch_id, p_tenant_id'
      ),
      (
        'get_platform_commission_report',
        'timestamptz, timestamptz, uuid, uuid',
        'p_date_from timestamptz default null, p_date_to timestamptz default null, p_branch_id uuid default null, p_tenant_id uuid default null',
        'p_branch_id',
        'reports.analytics',
        'p_date_from, p_date_to, p_branch_id, p_tenant_id'
      ),
      (
        'get_receivable_aging_report',
        'uuid, timestamptz, uuid',
        'p_branch_id uuid default null, p_as_of_date timestamptz default null, p_tenant_id uuid default null',
        'p_branch_id',
        'reports.analytics',
        'p_branch_id, p_as_of_date, p_tenant_id'
      ),
      (
        'get_vat_report',
        'timestamptz, timestamptz, uuid, uuid',
        'p_date_from timestamptz default null, p_date_to timestamptz default null, p_branch_id uuid default null, p_tenant_id uuid default null',
        'p_branch_id',
        'reports.analytics',
        'p_date_from, p_date_to, p_branch_id, p_tenant_id'
      ),
      (
        'get_rfm_report',
        'timestamptz, timestamptz, uuid, uuid',
        'p_date_from timestamptz default null, p_date_to timestamptz default null, p_branch_id uuid default null, p_tenant_id uuid default null',
        'p_branch_id',
        'reports.analytics',
        'p_date_from, p_date_to, p_branch_id, p_tenant_id'
      ),
      (
        'get_fnb_serve_time_report',
        'timestamptz, timestamptz, uuid, uuid',
        'p_date_from timestamptz default null, p_date_to timestamptz default null, p_branch_id uuid default null, p_tenant_id uuid default null',
        'p_branch_id',
        'reports.fnb',
        'p_date_from, p_date_to, p_branch_id, p_tenant_id'
      )
    ) definitions(
      function_name,
      identity_args,
      declaration_args,
      branch_expression,
      base_permission,
      call_args
    )
  loop
    v_legacy_name := r.function_name || '_unsecured_legacy';

    if to_regprocedure(
      format('public.%I(%s)', r.function_name, r.identity_args)
    ) is not null and to_regprocedure(
      format('public.%I(%s)', v_legacy_name, r.identity_args)
    ) is null then
      execute format(
        'alter function public.%I(%s) rename to %I',
        r.function_name,
        r.identity_args,
        v_legacy_name
      );
    end if;

    execute format(
      'revoke all on function public.%I(%s) from public, anon, authenticated',
      v_legacy_name,
      r.identity_args
    );

    execute format(
      $wrapper$
      create or replace function public.%I(%s)
      returns jsonb
      language plpgsql
      security definer
      set search_path = ''
      as $body$
      begin
        perform public.assert_report_access(%L, %s);
        perform public.assert_report_access('reports.view_detail', %s);
        return public.%I(%s);
      end;
      $body$;
      $wrapper$,
      r.function_name,
      r.declaration_args,
      r.base_permission,
      r.branch_expression,
      r.branch_expression,
      v_legacy_name,
      r.call_args
    );

    execute format(
      'revoke all on function public.%I(%s) from public, anon',
      r.function_name,
      r.identity_args
    );
    execute format(
      'grant execute on function public.%I(%s) to authenticated',
      r.function_name,
      r.identity_args
    );
  end loop;
end;
$migration$;

-- These obsolete overloads have no branch parameter and must not bypass scope.
-- Production databases created after 00082 may no longer contain them, so only
-- revoke privileges when an overload is actually present.
do $migration$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.get_staff_revenue_report(timestamptz,timestamptz,text,uuid)',
    'public.get_receivable_aging_report(uuid)',
    'public.get_vat_report(timestamptz,timestamptz,uuid)',
    'public.get_rfm_report(timestamptz,timestamptz,uuid)'
  ]
  loop
    if to_regprocedure(v_signature) is not null then
      execute format(
        'revoke all on function %s from public, anon, authenticated',
        v_signature
      );
    end if;
  end loop;
end;
$migration$;
