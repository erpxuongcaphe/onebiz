-- ============================================================
-- 00290: Durable opening debt balances and complete aging reports
-- ============================================================
-- This migration does not change invoices, purchase orders, payments, cash
-- transactions, stock, or displayed debt totals. Existing aggregate-only
-- differences are preserved as opening ledger rows before recompute formulas
-- are extended.

begin;

create table if not exists public.debt_opening_balances (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  branch_id uuid references public.branches(id) on delete restrict,
  party_type text not null check (party_type in ('customer', 'supplier')),
  customer_id uuid references public.customers(id) on delete restrict,
  supplier_id uuid references public.suppliers(id) on delete restrict,
  amount numeric(15,2) not null,
  opening_date date not null,
  note text,
  created_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint debt_opening_party_check check (
    (party_type = 'customer' and customer_id is not null and supplier_id is null)
    or
    (party_type = 'supplier' and supplier_id is not null and customer_id is null)
  )
);

create unique index if not exists uq_debt_opening_customer_branch
  on public.debt_opening_balances(tenant_id, customer_id, branch_id)
  nulls not distinct
  where customer_id is not null;

create unique index if not exists uq_debt_opening_supplier_branch
  on public.debt_opening_balances(tenant_id, supplier_id, branch_id)
  nulls not distinct
  where supplier_id is not null;

create index if not exists idx_debt_opening_tenant_date
  on public.debt_opening_balances(tenant_id, opening_date, party_type);

alter table public.debt_opening_balances enable row level security;
drop policy if exists debt_opening_balances_select
  on public.debt_opening_balances;
create policy debt_opening_balances_select
  on public.debt_opening_balances
  for select
  using (
    tenant_id = public.get_user_tenant_id()
    and (
      (branch_id is not null and public.user_has_branch_access(auth.uid(), branch_id))
      or (branch_id is null and public.user_has_permission(auth.uid(), 'finance.view_reports'))
    )
  );

revoke insert, update, delete on public.debt_opening_balances
  from public, anon, authenticated;
grant select on public.debt_opening_balances to authenticated;

-- Preserve any customer aggregate difference not already represented by
-- invoices and the existing customer adjustment ledger. NULL branch means
-- legacy company-level balance that cannot be assigned safely to a branch.
insert into public.debt_opening_balances (
  tenant_id, party_type, customer_id, branch_id, amount,
  opening_date, note, created_by
)
select
  c.tenant_id,
  'customer',
  c.id,
  null,
  round(coalesce(c.debt, 0) - coalesce(inv.invoice_debt, 0) - coalesce(adj.adjustment, 0), 2),
  current_date,
  'Số dư chuyển tiếp chưa xác định chi nhánh trước migration 00290',
  null
from public.customers c
left join lateral (
  select coalesce(sum(greatest(0, i.debt)), 0) as invoice_debt
  from public.invoices i
  where i.tenant_id = c.tenant_id
    and i.customer_id = c.id
    and i.status = 'completed'
    and i.deleted_at is null
) inv on true
left join lateral (
  select coalesce(sum(a.amount), 0) as adjustment
  from public.customer_debt_adjustments a
  where a.tenant_id = c.tenant_id
    and a.customer_id = c.id
) adj on true
where abs(
  coalesce(c.debt, 0) - coalesce(inv.invoice_debt, 0) - coalesce(adj.adjustment, 0)
) > 0.01
on conflict do nothing;

-- Preserve the same aggregate-only difference for suppliers.
insert into public.debt_opening_balances (
  tenant_id, party_type, supplier_id, branch_id, amount,
  opening_date, note, created_by
)
select
  s.tenant_id,
  'supplier',
  s.id,
  null,
  round(coalesce(s.debt, 0) - coalesce(po.purchase_debt, 0), 2),
  current_date,
  'Số dư chuyển tiếp chưa xác định chi nhánh trước migration 00290',
  null
from public.suppliers s
left join lateral (
  select coalesce(sum(greatest(0, po.debt)), 0) as purchase_debt
  from public.purchase_orders po
  where po.tenant_id = s.tenant_id
    and po.supplier_id = s.id
    and po.status in ('completed', 'partial')
) po on true
where abs(coalesce(s.debt, 0) - coalesce(po.purchase_debt, 0)) > 0.01
on conflict do nothing;

create or replace function public.recompute_customer_debt(p_customer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_invoice_debt numeric;
  v_adjustment numeric;
  v_opening numeric;
begin
  if p_customer_id is null then return; end if;

  select c.tenant_id into v_tenant_id
  from public.customers c
  where c.id = p_customer_id;
  if not found then return; end if;

  select coalesce(sum(greatest(0, i.debt)), 0)
  into v_invoice_debt
  from public.invoices i
  where i.tenant_id = v_tenant_id
    and i.customer_id = p_customer_id
    and i.status = 'completed'
    and i.deleted_at is null;

  select coalesce(sum(a.amount), 0)
  into v_adjustment
  from public.customer_debt_adjustments a
  where a.tenant_id = v_tenant_id
    and a.customer_id = p_customer_id;

  select coalesce(sum(o.amount), 0)
  into v_opening
  from public.debt_opening_balances o
  where o.tenant_id = v_tenant_id
    and o.customer_id = p_customer_id;

  update public.customers
  set debt = v_invoice_debt + v_adjustment + v_opening,
      updated_at = now()
  where id = p_customer_id
    and tenant_id = v_tenant_id;
end;
$$;

create or replace function public.recompute_supplier_debt(p_supplier_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_purchase_debt numeric;
  v_opening numeric;
begin
  if p_supplier_id is null then return; end if;

  select s.tenant_id into v_tenant_id
  from public.suppliers s
  where s.id = p_supplier_id;
  if not found then return; end if;

  select coalesce(sum(greatest(0, po.debt)), 0)
  into v_purchase_debt
  from public.purchase_orders po
  where po.tenant_id = v_tenant_id
    and po.supplier_id = p_supplier_id
    and po.status in ('completed', 'partial');

  select coalesce(sum(o.amount), 0)
  into v_opening
  from public.debt_opening_balances o
  where o.tenant_id = v_tenant_id
    and o.supplier_id = p_supplier_id;

  update public.suppliers
  set debt = v_purchase_debt + v_opening,
      updated_at = now()
  where id = p_supplier_id
    and tenant_id = v_tenant_id;
end;
$$;

revoke all on function public.recompute_customer_debt(uuid)
  from public, anon, authenticated;
revoke all on function public.recompute_supplier_debt(uuid)
  from public, anon, authenticated;
grant execute on function public.recompute_customer_debt(uuid) to service_role;
grant execute on function public.recompute_supplier_debt(uuid) to service_role;

create or replace function public.trg_sync_debt_opening_balance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.party_type = 'customer' then
      perform public.recompute_customer_debt(old.customer_id);
    else
      perform public.recompute_supplier_debt(old.supplier_id);
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE'
     and (old.customer_id is distinct from new.customer_id
          or old.supplier_id is distinct from new.supplier_id) then
    if old.party_type = 'customer' then
      perform public.recompute_customer_debt(old.customer_id);
    else
      perform public.recompute_supplier_debt(old.supplier_id);
    end if;
  end if;

  if new.party_type = 'customer' then
    perform public.recompute_customer_debt(new.customer_id);
  else
    perform public.recompute_supplier_debt(new.supplier_id);
  end if;
  return new;
end;
$$;

revoke all on function public.trg_sync_debt_opening_balance()
  from public, anon, authenticated;

drop trigger if exists trg_debt_opening_balances_sync
  on public.debt_opening_balances;
create trigger trg_debt_opening_balances_sync
after insert or update or delete on public.debt_opening_balances
for each row execute function public.trg_sync_debt_opening_balance();

create or replace function public.upsert_debt_opening_balance_atomic(
  p_party_type text,
  p_party_id uuid,
  p_branch_id uuid,
  p_amount numeric,
  p_opening_date date,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_party_type text := lower(trim(coalesce(p_party_type, '')));
  v_required_permission text;
  v_balance_id uuid;
  v_old record;
  v_current_debt numeric;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  select p.tenant_id into v_tenant_id
  from public.profiles p
  where p.id = v_actor and coalesce(p.is_active, true);
  if v_tenant_id is null then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;

  if v_party_type = 'customer' then
    v_required_permission := 'customers.import';
  elsif v_party_type = 'supplier' then
    v_required_permission := 'suppliers.import';
  else
    raise exception using errcode = '22023', message = 'DEBT_OPENING_PARTY_TYPE_INVALID';
  end if;
  if not public.user_has_permission(v_actor, v_required_permission) then
    raise exception using errcode = '42501', message = 'DEBT_OPENING_PERMISSION_DENIED';
  end if;
  if p_branch_id is null
     or not exists (
       select 1 from public.branches b
       where b.id = p_branch_id and b.tenant_id = v_tenant_id
     )
     or not public.user_has_branch_access(v_actor, p_branch_id) then
    raise exception using errcode = '42501', message = 'DEBT_OPENING_BRANCH_DENIED';
  end if;
  if p_opening_date is null or p_opening_date > current_date then
    raise exception using errcode = '22023', message = 'DEBT_OPENING_DATE_INVALID';
  end if;
  if p_amount is null
     or p_amount::text in ('NaN', 'Infinity', '-Infinity')
     or abs(p_amount) > 9999999999999.99
  then
    raise exception using errcode = '22023', message = 'DEBT_OPENING_AMOUNT_INVALID';
  end if;

  if v_party_type = 'customer' then
    if not exists (
      select 1 from public.customers c
      where c.id = p_party_id and c.tenant_id = v_tenant_id
    ) then
      raise exception using errcode = '22023', message = 'DEBT_OPENING_CUSTOMER_NOT_FOUND';
    end if;
    select o.* into v_old
    from public.debt_opening_balances o
    where o.tenant_id = v_tenant_id
      and o.customer_id = p_party_id
      and o.branch_id = p_branch_id
    for update;

    insert into public.debt_opening_balances (
      tenant_id, branch_id, party_type, customer_id, amount,
      opening_date, note, created_by
    ) values (
      v_tenant_id, p_branch_id, 'customer', p_party_id, round(p_amount, 2),
      p_opening_date, nullif(trim(coalesce(p_note, '')), ''), v_actor
    )
    on conflict (tenant_id, customer_id, branch_id)
      where customer_id is not null
    do update set
      amount = excluded.amount,
      opening_date = excluded.opening_date,
      note = excluded.note,
      updated_at = now()
    returning id into v_balance_id;

    select c.debt into v_current_debt
    from public.customers c where c.id = p_party_id;
  else
    if not exists (
      select 1 from public.suppliers s
      where s.id = p_party_id and s.tenant_id = v_tenant_id
    ) then
      raise exception using errcode = '22023', message = 'DEBT_OPENING_SUPPLIER_NOT_FOUND';
    end if;
    select o.* into v_old
    from public.debt_opening_balances o
    where o.tenant_id = v_tenant_id
      and o.supplier_id = p_party_id
      and o.branch_id = p_branch_id
    for update;

    insert into public.debt_opening_balances (
      tenant_id, branch_id, party_type, supplier_id, amount,
      opening_date, note, created_by
    ) values (
      v_tenant_id, p_branch_id, 'supplier', p_party_id, round(p_amount, 2),
      p_opening_date, nullif(trim(coalesce(p_note, '')), ''), v_actor
    )
    on conflict (tenant_id, supplier_id, branch_id)
      where supplier_id is not null
    do update set
      amount = excluded.amount,
      opening_date = excluded.opening_date,
      note = excluded.note,
      updated_at = now()
    returning id into v_balance_id;

    select s.debt into v_current_debt
    from public.suppliers s where s.id = p_party_id;
  end if;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_tenant_id, v_actor, 'opening_debt_upserted', v_party_type, p_party_id,
    case when v_old.id is null then null else jsonb_build_object(
      'amount', v_old.amount, 'opening_date', v_old.opening_date,
      'branch_id', v_old.branch_id, 'note', v_old.note
    ) end,
    jsonb_build_object(
      'balance_id', v_balance_id, 'amount', round(p_amount, 2),
      'opening_date', p_opening_date, 'branch_id', p_branch_id,
      'note', nullif(trim(coalesce(p_note, '')), ''),
      'current_debt', v_current_debt, 'atomic', true
    )
  );

  return jsonb_build_object(
    'id', v_balance_id,
    'party_type', v_party_type,
    'party_id', p_party_id,
    'branch_id', p_branch_id,
    'amount', round(p_amount, 2),
    'opening_date', p_opening_date,
    'current_debt', v_current_debt
  );
end;
$$;

revoke all on function public.upsert_debt_opening_balance_atomic(
  text, uuid, uuid, numeric, date, text
) from public, anon, authenticated;
grant execute on function public.upsert_debt_opening_balance_atomic(
  text, uuid, uuid, numeric, date, text
) to authenticated;

create or replace function public.get_receivable_aging_report(
  p_branch_id uuid default null,
  p_as_of_date timestamptz default null,
  p_tenant_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_as_of timestamptz := coalesce(p_as_of_date, now());
begin
  perform public.assert_report_access('reports.analytics', p_branch_id);
  perform public.assert_report_access('reports.view_detail', p_branch_id);

  select p.tenant_id into v_tenant_id
  from public.profiles p
  where p.id = v_actor and coalesce(p.is_active, true);
  if v_tenant_id is null then
    raise exception using errcode = '42501', message = 'REPORT_PROFILE_INACTIVE';
  end if;
  if p_tenant_id is not null and p_tenant_id <> v_tenant_id then
    raise exception using errcode = '42501', message = 'REPORT_TENANT_SPOOF_BLOCKED';
  end if;

  return jsonb_build_object(
    'generated_at', now(),
    'as_of_date', v_as_of,
    'tenant_id', v_tenant_id,
    'branch_id', p_branch_id,
    'rows', (
      with debt_documents as (
        select
          i.customer_id,
          coalesce(nullif(trim(i.customer_name), ''), 'Khách lẻ') as customer_name,
          greatest(coalesce(i.debt, 0), 0) as outstanding,
          i.created_at as debt_date
        from public.invoices i
        where i.tenant_id = v_tenant_id
          and i.status = 'completed'
          and i.deleted_at is null
          and coalesce(i.debt, 0) > 0
          and i.created_at <= v_as_of
          and (p_branch_id is null or i.branch_id = p_branch_id)

        union all

        select
          o.customer_id,
          c.name,
          o.amount,
          (o.opening_date::timestamp at time zone 'Asia/Ho_Chi_Minh')
        from public.debt_opening_balances o
        join public.customers c on c.id = o.customer_id
        where o.tenant_id = v_tenant_id
          and o.party_type = 'customer'
          and o.amount <> 0
          and o.opening_date <= v_as_of::date
          and (
            (p_branch_id is null)
            or o.branch_id = p_branch_id
          )

        union all

        select
          a.customer_id,
          c.name,
          a.amount,
          a.created_at
        from public.customer_debt_adjustments a
        join public.customers c on c.id = a.customer_id
        left join public.invoices ai on ai.id = a.invoice_id
        where a.tenant_id = v_tenant_id
          and a.amount <> 0
          and a.created_at <= v_as_of
          and (
            p_branch_id is null
            or ai.branch_id = p_branch_id
          )
      ),
      aged as (
        select
          d.*,
          greatest(
            0, floor(extract(epoch from (v_as_of - d.debt_date)) / 86400)::int
          ) as days_old
        from debt_documents d
      )
      select coalesce(
        jsonb_agg(to_jsonb(t) order by t.outstanding desc, t.customer_name),
        '[]'::jsonb
      )
      from (
        select
          coalesce(customer_id::text, 'walk-in:' || md5(customer_name)) as customer_id,
          customer_name,
          count(*) filter (where outstanding <> 0)::int as invoice_count,
          sum(outstanding) as outstanding,
          sum(outstanding) filter (where days_old <= 30) as bucket_0_30,
          sum(outstanding) filter (where days_old between 31 and 60) as bucket_31_60,
          sum(outstanding) filter (where days_old between 61 and 90) as bucket_61_90,
          sum(outstanding) filter (where days_old > 90) as bucket_91_plus,
          max(days_old)::int as oldest_days,
          min(debt_date) as oldest_invoice_date
        from aged
        group by customer_id, customer_name
        having sum(outstanding) > 0.01
      ) t
    )
  );
end;
$$;

create or replace function public.get_payable_aging_report(
  p_branch_id uuid default null,
  p_as_of_date timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_as_of timestamptz := coalesce(p_as_of_date, now());
begin
  perform public.assert_report_access('reports.analytics', p_branch_id);
  perform public.assert_report_access('reports.view_detail', p_branch_id);

  select p.tenant_id into v_tenant_id
  from public.profiles p
  where p.id = v_actor and coalesce(p.is_active, true);
  if v_tenant_id is null then
    raise exception using errcode = '42501', message = 'REPORT_PROFILE_INACTIVE';
  end if;

  return jsonb_build_object(
    'generated_at', now(),
    'as_of_date', v_as_of,
    'tenant_id', v_tenant_id,
    'branch_id', p_branch_id,
    'rows', (
      with first_receipt as (
        select sm.reference_id as purchase_order_id, min(sm.created_at) as first_received_at
        from public.stock_movements sm
        where sm.tenant_id = v_tenant_id
          and sm.reference_type = 'purchase_order'
          and sm.type = 'in'
          and sm.created_at <= v_as_of
          and (p_branch_id is null or sm.branch_id = p_branch_id)
        group by sm.reference_id
      ),
      debt_documents as (
        select
          po.supplier_id,
          coalesce(nullif(trim(po.supplier_name), ''), 'Nhà cung cấp') as supplier_name,
          greatest(coalesce(po.debt, 0), 0) as outstanding,
          coalesce(fr.first_received_at, po.created_at) as debt_date
        from public.purchase_orders po
        left join first_receipt fr on fr.purchase_order_id = po.id
        where po.tenant_id = v_tenant_id
          and po.status in ('partial', 'completed')
          and coalesce(po.debt, 0) > 0
          and coalesce(fr.first_received_at, po.created_at) <= v_as_of
          and (p_branch_id is null or po.branch_id = p_branch_id)

        union all

        select
          o.supplier_id,
          s.name,
          o.amount,
          (o.opening_date::timestamp at time zone 'Asia/Ho_Chi_Minh')
        from public.debt_opening_balances o
        join public.suppliers s on s.id = o.supplier_id
        where o.tenant_id = v_tenant_id
          and o.party_type = 'supplier'
          and o.amount <> 0
          and o.opening_date <= v_as_of::date
          and (
            (p_branch_id is null)
            or o.branch_id = p_branch_id
          )
      ),
      aged as (
        select
          d.*,
          greatest(
            0, floor(extract(epoch from (v_as_of - d.debt_date)) / 86400)::int
          ) as days_old
        from debt_documents d
      )
      select coalesce(
        jsonb_agg(to_jsonb(t) order by t.outstanding desc, t.supplier_name),
        '[]'::jsonb
      )
      from (
        select
          supplier_id::text as supplier_id,
          supplier_name,
          count(*) filter (where outstanding <> 0)::int as document_count,
          sum(outstanding) as outstanding,
          sum(outstanding) filter (where days_old <= 30) as bucket_0_30,
          sum(outstanding) filter (where days_old between 31 and 60) as bucket_31_60,
          sum(outstanding) filter (where days_old between 61 and 90) as bucket_61_90,
          sum(outstanding) filter (where days_old > 90) as bucket_91_plus,
          max(days_old)::int as oldest_days,
          min(debt_date) as oldest_document_date
        from aged
        group by supplier_id, supplier_name
        having sum(outstanding) > 0.01
      ) t
    )
  );
end;
$$;

revoke all on function public.get_receivable_aging_report(
  uuid, timestamptz, uuid
) from public, anon;
grant execute on function public.get_receivable_aging_report(
  uuid, timestamptz, uuid
) to authenticated;

revoke all on function public.get_payable_aging_report(
  uuid, timestamptz
) from public, anon;
grant execute on function public.get_payable_aging_report(
  uuid, timestamptz
) to authenticated;

commit;

-- Read-only postflight. All booleans must be true. Snapshot rows only preserve
-- existing aggregate differences; no business document is changed.
select
  to_regclass('public.debt_opening_balances') is not null as opening_table_ok,
  to_regprocedure(
    'public.upsert_debt_opening_balance_atomic(text,uuid,uuid,numeric,date,text)'
  ) is not null as opening_rpc_ok,
  pg_get_functiondef(
    'public.recompute_customer_debt(uuid)'::regprocedure
  ) like '%debt_opening_balances%' as customer_formula_ok,
  pg_get_functiondef(
    'public.recompute_supplier_debt(uuid)'::regprocedure
  ) like '%debt_opening_balances%' as supplier_formula_ok,
  pg_get_functiondef(
    'public.get_receivable_aging_report(uuid,timestamptz,uuid)'::regprocedure
  ) like '%customer_debt_adjustments%' as receivable_adjustment_ok,
  pg_get_functiondef(
    'public.get_payable_aging_report(uuid,timestamptz)'::regprocedure
  ) like '%debt_opening_balances%' as payable_opening_ok,
  (
    select count(*)::int
    from public.customers c
    left join lateral (
      select coalesce(sum(greatest(0, i.debt)), 0) as invoice_debt
      from public.invoices i
      where i.tenant_id = c.tenant_id
        and i.customer_id = c.id
        and i.status = 'completed'
        and i.deleted_at is null
    ) inv on true
    left join lateral (
      select coalesce(sum(a.amount), 0) as adjustment
      from public.customer_debt_adjustments a
      where a.tenant_id = c.tenant_id and a.customer_id = c.id
    ) adj on true
    left join lateral (
      select coalesce(sum(o.amount), 0) as opening
      from public.debt_opening_balances o
      where o.tenant_id = c.tenant_id and o.customer_id = c.id
    ) op on true
    where abs(
      coalesce(c.debt, 0) - coalesce(inv.invoice_debt, 0)
      - coalesce(adj.adjustment, 0) - coalesce(op.opening, 0)
    ) > 0.01
  ) as customer_debt_drift,
  (
    select count(*)::int
    from public.suppliers s
    left join lateral (
      select coalesce(sum(greatest(0, po.debt)), 0) as purchase_debt
      from public.purchase_orders po
      where po.tenant_id = s.tenant_id
        and po.supplier_id = s.id
        and po.status in ('completed', 'partial')
    ) po on true
    left join lateral (
      select coalesce(sum(o.amount), 0) as opening
      from public.debt_opening_balances o
      where o.tenant_id = s.tenant_id and o.supplier_id = s.id
    ) op on true
    where abs(
      coalesce(s.debt, 0) - coalesce(po.purchase_debt, 0)
      - coalesce(op.opening, 0)
    ) > 0.01
  ) as supplier_debt_drift;
