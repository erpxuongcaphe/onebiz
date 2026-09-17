-- ============================================================
-- 00379: Supplier overpayment becomes a branch-scoped advance
-- ============================================================
-- A purchase order must never carry negative debt. When a supplier payment is
-- greater than the selected PO debt, the PO is settled at zero and the excess
-- is kept in a separate, auditable supplier-advance ledger.

begin;

create table if not exists public.supplier_advances (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  cash_transaction_id uuid not null unique
    references public.cash_transactions(id) on delete restrict,
  source_purchase_order_id uuid not null
    references public.purchase_orders(id) on delete restrict,
  original_amount numeric(15,2) not null check (original_amount > 0),
  remaining_amount numeric(15,2) not null
    check (remaining_amount >= 0 and remaining_amount <= original_amount),
  status text not null default 'active'
    check (status in ('active', 'exhausted', 'cancelled')),
  note text not null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  cancelled_by uuid references public.profiles(id) on delete restrict,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_supplier_advances_available
  on public.supplier_advances(tenant_id, branch_id, supplier_id, created_at)
  where status = 'active' and remaining_amount > 0;

alter table public.supplier_advances enable row level security;
drop policy if exists supplier_advances_select on public.supplier_advances;
create policy supplier_advances_select
  on public.supplier_advances
  for select
  using (
    tenant_id = public.get_user_tenant_id()
    and public.user_has_branch_access(auth.uid(), branch_id)
    and public.user_has_permission(auth.uid(), 'suppliers.view_debt')
  );

revoke insert, update, delete on public.supplier_advances
  from public, anon, authenticated;
grant select on public.supplier_advances to authenticated;

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
  v_advance numeric;
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

  select coalesce(sum(a.remaining_amount), 0)
  into v_advance
  from public.supplier_advances a
  where a.tenant_id = v_tenant_id
    and a.supplier_id = p_supplier_id
    and a.status = 'active'
    and a.remaining_amount > 0;

  update public.suppliers
  set debt = round(v_purchase_debt + v_opening - v_advance, 2),
      updated_at = now()
  where id = p_supplier_id
    and tenant_id = v_tenant_id;
end;
$$;

revoke all on function public.recompute_supplier_debt(uuid)
  from public, anon, authenticated;
grant execute on function public.recompute_supplier_debt(uuid) to service_role;

create or replace function public.trg_sync_supplier_advance_debt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.recompute_supplier_debt(old.supplier_id);
    return old;
  end if;
  if tg_op = 'UPDATE' and old.supplier_id is distinct from new.supplier_id then
    perform public.recompute_supplier_debt(old.supplier_id);
  end if;
  perform public.recompute_supplier_debt(new.supplier_id);
  return new;
end;
$$;

revoke all on function public.trg_sync_supplier_advance_debt()
  from public, anon, authenticated;

drop trigger if exists trg_supplier_advances_sync_debt
  on public.supplier_advances;
create trigger trg_supplier_advances_sync_debt
after insert or update or delete on public.supplier_advances
for each row execute function public.trg_sync_supplier_advance_debt();

create or replace function public.record_purchase_payment(
  p_purchase_order_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_note text default null,
  p_branch_id uuid default null,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_actor_tenant uuid;
  v_is_service_role boolean :=
    coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role';
  v_po record;
  v_cash_id uuid;
  v_cash_code text;
  v_amount numeric(15,2);
  v_applied numeric(15,2);
  v_advance numeric(15,2);
  v_new_paid numeric(15,2);
  v_new_debt numeric(15,2);
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  v_actor := case when v_is_service_role then p_user_id else auth.uid() end;

  if v_actor is null then
    raise exception using errcode = '42501', message = 'UNAUTHENTICATED';
  end if;
  if not v_is_service_role and p_user_id is not null and p_user_id <> v_actor then
    raise exception using errcode = '42501', message = 'ACTOR_SPOOF_BLOCKED';
  end if;

  select p.tenant_id into v_actor_tenant
  from public.profiles p
  where p.id = v_actor and coalesce(p.is_active, true);
  if v_actor_tenant is null then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if not public.user_has_permission(v_actor, 'finance.create_transaction') then
    raise exception using errcode = '42501', message = 'INSUFFICIENT_PERMISSION';
  end if;

  select po.id, po.tenant_id, po.branch_id, po.code, po.supplier_id,
         po.supplier_name, po.total, po.paid, po.debt, po.status
  into v_po
  from public.purchase_orders po
  where po.id = p_purchase_order_id
    and po.tenant_id = v_actor_tenant
  for update;

  if not found then
    raise exception using errcode = '22023', message = 'PURCHASE_ORDER_NOT_FOUND';
  end if;
  if v_po.supplier_id is null then
    raise exception using errcode = '22023', message = 'PURCHASE_ORDER_SUPPLIER_REQUIRED';
  end if;
  if p_branch_id is not null and p_branch_id <> v_po.branch_id then
    raise exception using errcode = '42501', message = 'BRANCH_SPOOF_BLOCKED';
  end if;
  if not public.user_has_branch_access(v_actor, v_po.branch_id) then
    raise exception using errcode = '42501', message = 'BRANCH_ACCESS_DENIED';
  end if;
  if v_po.status not in ('completed', 'partial') then
    raise exception using errcode = '22023', message = 'PURCHASE_ORDER_NOT_RECEIVED';
  end if;
  if p_amount is null
     or p_amount::text in ('NaN', 'Infinity', '-Infinity')
     or p_amount <= 0
     or p_amount > 9999999999999.99 then
    raise exception using errcode = '22023', message = 'INVALID_PAYMENT_AMOUNT';
  end if;
  if coalesce(v_po.debt, 0) <= 0 then
    raise exception using errcode = '22023', message = 'PURCHASE_ORDER_HAS_NO_DEBT';
  end if;
  if p_payment_method not in ('cash', 'transfer', 'card', 'ewallet') then
    raise exception using errcode = '22023', message = 'INVALID_PAYMENT_METHOD';
  end if;

  v_amount := round(p_amount, 2);
  v_applied := least(v_amount, round(v_po.debt, 2));
  v_advance := v_amount - v_applied;
  if v_advance > 0 and (v_note is null or length(v_note) < 3) then
    raise exception using errcode = '22023', message = 'SUPPLIER_ADVANCE_NOTE_REQUIRED';
  end if;

  v_new_paid := round(coalesce(v_po.paid, 0) + v_applied, 2);
  v_new_debt := greatest(0, round(v_po.debt - v_applied, 2));
  v_cash_code := public.next_cash_code(v_actor_tenant, 'payment');

  insert into public.cash_transactions (
    tenant_id, branch_id, code, type, category, amount, counterparty,
    payment_method, reference_type, reference_id, supplier_id,
    note, created_by, status, transaction_date
  ) values (
    v_actor_tenant, v_po.branch_id, v_cash_code, 'payment',
    'supplier_payment', v_amount, v_po.supplier_name,
    p_payment_method, 'purchase_order', v_po.id, v_po.supplier_id,
    coalesce(v_note, 'Trả nợ đơn nhập hàng ' || v_po.code),
    v_actor, 'completed', current_date
  ) returning id into v_cash_id;

  update public.purchase_orders
  set paid = v_new_paid,
      debt = v_new_debt,
      updated_at = now()
  where id = v_po.id and tenant_id = v_actor_tenant;

  if v_advance > 0 then
    insert into public.supplier_advances (
      tenant_id, branch_id, supplier_id, cash_transaction_id,
      source_purchase_order_id, original_amount, remaining_amount,
      note, created_by
    ) values (
      v_actor_tenant, v_po.branch_id, v_po.supplier_id, v_cash_id,
      v_po.id, v_advance, v_advance, v_note, v_actor
    );
  end if;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_actor_tenant, v_actor, 'payment', 'purchase_order', v_po.id,
    jsonb_build_object(
      'cash_transaction_id', v_cash_id,
      'cash_code', v_cash_code,
      'amount', v_amount,
      'applied_amount', v_applied,
      'advance_amount', v_advance,
      'payment_method', p_payment_method,
      'new_paid', v_new_paid,
      'new_debt', v_new_debt,
      'atomic', true
    )
  );

  return jsonb_build_object(
    'cash_transaction_id', v_cash_id,
    'cash_code', v_cash_code,
    'new_paid', v_new_paid,
    'new_debt', v_new_debt,
    'applied_amount', v_applied,
    'advance_amount', v_advance
  );
end;
$$;

revoke all on function public.record_purchase_payment(
  uuid, numeric, text, text, uuid, uuid
) from public, anon;
grant execute on function public.record_purchase_payment(
  uuid, numeric, text, text, uuid, uuid
) to authenticated, service_role;

create or replace function public.cancel_cash_transaction(
  p_cash_id uuid,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_cash record;
  v_advance record;
  v_document_amount numeric(15,2);
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_old_data jsonb;
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
  if not public.user_has_permission(v_actor, 'finance.void_transaction') then
    raise exception using errcode = '42501', message = 'CASH_CANCEL_DENIED';
  end if;
  if v_reason is null or length(v_reason) < 3 then
    raise exception using errcode = '22023', message = 'CASH_CANCEL_REASON_REQUIRED';
  end if;

  select ct.* into v_cash
  from public.cash_transactions ct
  where ct.id = p_cash_id and ct.tenant_id = v_tenant_id
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'CASH_TRANSACTION_NOT_FOUND';
  end if;
  if not public.user_has_branch_access(v_actor, v_cash.branch_id) then
    raise exception using errcode = '42501', message = 'CASH_BRANCH_DENIED';
  end if;
  if v_cash.status = 'cancelled' then
    return jsonb_build_object(
      'cash_id', v_cash.id, 'cash_code', v_cash.code,
      'reversed_amount', 0, 'idempotent', true
    );
  end if;
  if v_cash.status <> 'completed' then
    raise exception using errcode = '22023', message = 'CASH_STATUS_NOT_CANCELLABLE';
  end if;

  select a.* into v_advance
  from public.supplier_advances a
  where a.cash_transaction_id = v_cash.id
    and a.tenant_id = v_tenant_id
  for update;

  if found and (
    v_advance.status <> 'active'
    or v_advance.remaining_amount <> v_advance.original_amount
  ) then
    raise exception using errcode = '22023', message = 'SUPPLIER_ADVANCE_ALREADY_APPLIED';
  end if;

  v_old_data := jsonb_build_object(
    'status', v_cash.status, 'amount', v_cash.amount,
    'reference_type', v_cash.reference_type, 'reference_id', v_cash.reference_id,
    'advance_amount', coalesce(v_advance.original_amount, 0)
  );

  if v_cash.reference_type = 'invoice' and v_cash.reference_id is not null then
    update public.invoices i
    set paid = greatest(0, coalesce(i.paid, 0) - v_cash.amount),
        debt = greatest(0, coalesce(i.total, 0) - greatest(0, coalesce(i.paid, 0) - v_cash.amount)),
        updated_at = now()
    where i.id = v_cash.reference_id
      and i.tenant_id = v_tenant_id
      and i.branch_id = v_cash.branch_id;
    if not found then
      raise exception using errcode = '22023', message = 'CASH_REFERENCE_INVOICE_INVALID';
    end if;
  elsif v_cash.reference_type = 'purchase_order' and v_cash.reference_id is not null then
    v_document_amount := v_cash.amount - coalesce(v_advance.original_amount, 0);
    update public.purchase_orders po
    set paid = greatest(0, coalesce(po.paid, 0) - v_document_amount),
        debt = greatest(0, coalesce(po.total, 0) - greatest(0, coalesce(po.paid, 0) - v_document_amount)),
        updated_at = now()
    where po.id = v_cash.reference_id
      and po.tenant_id = v_tenant_id
      and po.branch_id = v_cash.branch_id;
    if not found then
      raise exception using errcode = '22023', message = 'CASH_REFERENCE_PURCHASE_INVALID';
    end if;

    if v_advance.id is not null then
      update public.supplier_advances
      set remaining_amount = 0,
          status = 'cancelled',
          cancelled_by = v_actor,
          cancelled_at = now(),
          updated_at = now()
      where id = v_advance.id;
    end if;
  elsif v_cash.reference_id is not null or v_cash.reference_type is not null then
    raise exception using errcode = '22023', message = 'CASH_REFERENCE_TYPE_UNSUPPORTED';
  end if;

  update public.cash_transactions
  set status = 'cancelled',
      note = concat_ws(E'\n', nullif(note, ''), '[HỦY] ' || v_reason),
      updated_at = now()
  where id = v_cash.id and tenant_id = v_tenant_id;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_tenant_id, v_actor, 'cash_transaction_cancelled', 'cash_transaction', v_cash.id,
    v_old_data,
    jsonb_build_object(
      'status', 'cancelled', 'reason', v_reason,
      'reversed_amount', v_cash.amount, 'atomic', true
    )
  );

  return jsonb_build_object(
    'cash_id', v_cash.id, 'cash_code', v_cash.code,
    'reversed_amount', v_cash.amount, 'idempotent', false
  );
end;
$$;

revoke all on function public.cancel_cash_transaction(uuid, text)
  from public, anon;
grant execute on function public.cancel_cash_transaction(uuid, text)
  to authenticated;

-- Payable totals and aging must use the same net balance as suppliers.debt.
-- The advance is shown in the newest bucket because it is a credit, not an
-- overdue document; this keeps total outstanding equal to the bucket sum.
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
          and (p_branch_id is null or o.branch_id = p_branch_id)

        union all

        select
          a.supplier_id,
          s.name,
          -a.remaining_amount,
          a.created_at
        from public.supplier_advances a
        join public.suppliers s on s.id = a.supplier_id
        where a.tenant_id = v_tenant_id
          and a.status = 'active'
          and a.remaining_amount > 0
          and a.created_at <= v_as_of
          and (p_branch_id is null or a.branch_id = p_branch_id)
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
          count(*) filter (where outstanding > 0)::int as document_count,
          sum(outstanding) as outstanding,
          coalesce(sum(outstanding) filter (where days_old <= 30), 0) as bucket_0_30,
          coalesce(sum(outstanding) filter (where days_old between 31 and 60), 0) as bucket_31_60,
          coalesce(sum(outstanding) filter (where days_old between 61 and 90), 0) as bucket_61_90,
          coalesce(sum(outstanding) filter (where days_old > 90), 0) as bucket_91_plus,
          max(days_old) filter (where outstanding > 0)::int as oldest_days,
          min(debt_date) filter (where outstanding > 0) as oldest_document_date
        from aged
        group by supplier_id, supplier_name
        having sum(outstanding) > 0.01
      ) t
    )
  );
end;
$$;

revoke all on function public.get_payable_aging_report(uuid, timestamptz)
  from public, anon;
grant execute on function public.get_payable_aging_report(uuid, timestamptz)
  to authenticated;

commit;

-- Read-only postflight. Every boolean must be true.
select
  to_regclass('public.supplier_advances') is not null as advance_table_ok,
  pg_get_functiondef('public.record_purchase_payment(uuid,numeric,text,text,uuid,uuid)'::regprocedure)
    like '%advance_amount%' as payment_split_ok,
  pg_get_functiondef('public.record_purchase_payment(uuid,numeric,text,text,uuid,uuid)'::regprocedure)
    not like '%PAYMENT_EXCEEDS_DEBT%' as old_guard_removed,
  pg_get_functiondef('public.cancel_cash_transaction(uuid,text)'::regprocedure)
    like '%SUPPLIER_ADVANCE_ALREADY_APPLIED%' as cancel_guard_ok,
  pg_get_functiondef('public.recompute_supplier_debt(uuid)'::regprocedure)
    like '%supplier_advances%' as supplier_total_includes_advance,
  pg_get_functiondef('public.get_payable_aging_report(uuid,timestamptz)'::regprocedure)
    like '%supplier_advances%' as payable_report_includes_advance;
