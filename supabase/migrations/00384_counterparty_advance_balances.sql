-- 00384: Visible customer deposits and supplier advances.
--
-- This migration does not create financial transactions or rewrite existing
-- balances. It adds atomic entry points and a read-only management summary.

begin;

alter table public.customer_debt_adjustments
  add column if not exists branch_id uuid references public.branches(id) on delete restrict,
  add column if not exists cash_transaction_id uuid references public.cash_transactions(id) on delete restrict;

create unique index if not exists uq_customer_debt_adjustments_cash
  on public.customer_debt_adjustments(cash_transaction_id)
  where cash_transaction_id is not null;

update public.customer_debt_adjustments a
set branch_id = i.branch_id
from public.invoices i
where a.branch_id is null
  and a.invoice_id = i.id
  and a.tenant_id = i.tenant_id;

alter table public.supplier_advances
  alter column source_purchase_order_id drop not null;

create or replace function public.record_customer_advance(
  p_customer_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_note text,
  p_branch_id uuid,
  p_user_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_tenant_id uuid;
  v_customer record;
  v_amount numeric(15,2);
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_cash_id uuid;
  v_cash_code text;
begin
  v_actor := case
    when coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
      then p_user_id
    else auth.uid()
  end;
  if v_actor is null then
    raise exception using errcode = '42501', message = 'UNAUTHENTICATED';
  end if;
  select p.tenant_id into v_tenant_id
  from public.profiles p
  where p.id = v_actor and coalesce(p.is_active, true);
  if v_tenant_id is null then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if not public.user_has_permission(v_actor, 'finance.create_transaction') then
    raise exception using errcode = '42501', message = 'INSUFFICIENT_PERMISSION';
  end if;
  if p_branch_id is null or not public.user_has_branch_access(v_actor, p_branch_id) then
    raise exception using errcode = '42501', message = 'ADVANCE_BRANCH_REQUIRED_OR_DENIED';
  end if;
  select c.id, c.name into v_customer
  from public.customers c
  where c.id = p_customer_id and c.tenant_id = v_tenant_id
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'CUSTOMER_NOT_FOUND';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 9999999999999.99 then
    raise exception using errcode = '22023', message = 'INVALID_ADVANCE_AMOUNT';
  end if;
  if p_payment_method not in ('cash', 'transfer', 'card', 'ewallet') then
    raise exception using errcode = '22023', message = 'INVALID_PAYMENT_METHOD';
  end if;
  if v_note is null or length(v_note) < 3 then
    raise exception using errcode = '22023', message = 'CUSTOMER_ADVANCE_NOTE_REQUIRED';
  end if;

  v_amount := round(p_amount, 2);
  v_cash_code := public.next_cash_code(v_tenant_id, 'receipt');
  insert into public.cash_transactions (
    tenant_id, branch_id, code, type, category, amount, counterparty,
    payment_method, customer_id, note, created_by, status, transaction_date
  ) values (
    v_tenant_id, p_branch_id, v_cash_code, 'receipt', 'customer_advance',
    v_amount, v_customer.name, p_payment_method, p_customer_id,
    v_note, v_actor, 'completed', current_date
  ) returning id into v_cash_id;

  insert into public.customer_debt_adjustments (
    tenant_id, branch_id, customer_id, amount, reason, idempotency_key,
    cash_transaction_id, created_by
  ) values (
    v_tenant_id, p_branch_id, p_customer_id, -v_amount, v_note,
    'customer-advance:' || v_cash_id::text, v_cash_id, v_actor
  );

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_tenant_id, v_actor, 'customer_advance_recorded', 'cash_transaction', v_cash_id,
    jsonb_build_object('customer_id', p_customer_id, 'branch_id', p_branch_id,
      'amount', v_amount, 'cash_code', v_cash_code)
  );

  return jsonb_build_object(
    'cash_transaction_id', v_cash_id, 'cash_code', v_cash_code,
    'advance_amount', v_amount
  );
end;
$$;

revoke all on function public.record_customer_advance(uuid,numeric,text,text,uuid,uuid)
  from public, anon;
grant execute on function public.record_customer_advance(uuid,numeric,text,text,uuid,uuid)
  to authenticated, service_role;

create or replace function public.record_supplier_advance(
  p_supplier_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_note text,
  p_branch_id uuid,
  p_user_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_tenant_id uuid;
  v_supplier record;
  v_amount numeric(15,2);
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_cash_id uuid;
  v_cash_code text;
begin
  v_actor := case
    when coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
      then p_user_id
    else auth.uid()
  end;
  if v_actor is null then
    raise exception using errcode = '42501', message = 'UNAUTHENTICATED';
  end if;
  select p.tenant_id into v_tenant_id
  from public.profiles p
  where p.id = v_actor and coalesce(p.is_active, true);
  if v_tenant_id is null then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if not public.user_has_permission(v_actor, 'finance.create_transaction') then
    raise exception using errcode = '42501', message = 'INSUFFICIENT_PERMISSION';
  end if;
  if p_branch_id is null or not public.user_has_branch_access(v_actor, p_branch_id) then
    raise exception using errcode = '42501', message = 'ADVANCE_BRANCH_REQUIRED_OR_DENIED';
  end if;
  select s.id, s.name into v_supplier
  from public.suppliers s
  where s.id = p_supplier_id and s.tenant_id = v_tenant_id
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'SUPPLIER_NOT_FOUND';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 9999999999999.99 then
    raise exception using errcode = '22023', message = 'INVALID_ADVANCE_AMOUNT';
  end if;
  if p_payment_method not in ('cash', 'transfer', 'card', 'ewallet') then
    raise exception using errcode = '22023', message = 'INVALID_PAYMENT_METHOD';
  end if;
  if v_note is null or length(v_note) < 3 then
    raise exception using errcode = '22023', message = 'SUPPLIER_ADVANCE_NOTE_REQUIRED';
  end if;

  v_amount := round(p_amount, 2);
  v_cash_code := public.next_cash_code(v_tenant_id, 'payment');
  insert into public.cash_transactions (
    tenant_id, branch_id, code, type, category, amount, counterparty,
    payment_method, supplier_id, note, created_by, status, transaction_date
  ) values (
    v_tenant_id, p_branch_id, v_cash_code, 'payment', 'supplier_advance',
    v_amount, v_supplier.name, p_payment_method, p_supplier_id,
    v_note, v_actor, 'completed', current_date
  ) returning id into v_cash_id;

  insert into public.supplier_advances (
    tenant_id, branch_id, supplier_id, cash_transaction_id,
    source_purchase_order_id, original_amount, remaining_amount,
    note, created_by
  ) values (
    v_tenant_id, p_branch_id, p_supplier_id, v_cash_id,
    null, v_amount, v_amount, v_note, v_actor
  );

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_tenant_id, v_actor, 'supplier_advance_recorded', 'cash_transaction', v_cash_id,
    jsonb_build_object('supplier_id', p_supplier_id, 'branch_id', p_branch_id,
      'amount', v_amount, 'cash_code', v_cash_code)
  );

  return jsonb_build_object(
    'cash_transaction_id', v_cash_id, 'cash_code', v_cash_code,
    'advance_amount', v_amount
  );
end;
$$;

revoke all on function public.record_supplier_advance(uuid,numeric,text,text,uuid,uuid)
  from public, anon;
grant execute on function public.record_supplier_advance(uuid,numeric,text,text,uuid,uuid)
  to authenticated, service_role;

-- Existing cancel_cash_transaction accepts standalone cash rows with no
-- document reference. Reverse their advance ledgers when the cash row is
-- cancelled so cash and counterparty balances cannot diverge.
create or replace function public.trg_reverse_direct_advance_on_cash_cancel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_adjustment record;
begin
  if old.status = 'completed' and new.status = 'cancelled' then
    update public.supplier_advances a
    set remaining_amount = 0,
        status = 'cancelled',
        cancelled_by = auth.uid(),
        cancelled_at = now(),
        updated_at = now()
    where a.cash_transaction_id = new.id
      and a.source_purchase_order_id is null
      and a.status = 'active'
      and a.remaining_amount = a.original_amount;

    select a.* into v_customer_adjustment
    from public.customer_debt_adjustments a
    where a.cash_transaction_id = new.id
      and a.amount < 0;

    if found then
      insert into public.customer_debt_adjustments (
        tenant_id, branch_id, customer_id, invoice_id, amount, reason,
        idempotency_key, created_by
      ) values (
        v_customer_adjustment.tenant_id,
        v_customer_adjustment.branch_id,
        v_customer_adjustment.customer_id,
        v_customer_adjustment.invoice_id,
        -v_customer_adjustment.amount,
        'Đảo tiền khách trả trước do hủy ' || new.code,
        'cancel-customer-advance:' || new.id::text,
        auth.uid()
      ) on conflict (tenant_id, idempotency_key) do nothing;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.trg_reverse_direct_advance_on_cash_cancel()
  from public, anon, authenticated;

drop trigger if exists trg_cash_cancel_reverse_direct_advance
  on public.cash_transactions;
create trigger trg_cash_cancel_reverse_direct_advance
after update of status on public.cash_transactions
for each row execute function public.trg_reverse_direct_advance_on_cash_cancel();

-- A management summary keeps gross debt and money held on behalf of either
-- party separate. Net balance is presentation data, never a negative document.
create or replace function public.get_counterparty_balance_summary(
  p_branch_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
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
    'customers', (
      with invoice_debt as (
        select i.customer_id,
          sum(greatest(coalesce(i.debt, 0), 0)) as amount
        from public.invoices i
        where i.tenant_id = v_tenant_id and i.status = 'completed'
          and i.deleted_at is null and i.customer_id is not null
          and (p_branch_id is null or i.branch_id = p_branch_id)
        group by i.customer_id
      ), adjustments as (
        select a.customer_id,
          sum(greatest(a.amount, 0)) as debit,
          sum(greatest(-a.amount, 0)) as credit
        from public.customer_debt_adjustments a
        where a.tenant_id = v_tenant_id
          and (p_branch_id is null or a.branch_id = p_branch_id)
        group by a.customer_id
      ), opening as (
        select o.customer_id,
          sum(greatest(o.amount, 0)) as debit,
          sum(greatest(-o.amount, 0)) as credit
        from public.debt_opening_balances o
        where o.tenant_id = v_tenant_id and o.party_type = 'customer'
          and (p_branch_id is null or o.branch_id = p_branch_id)
        group by o.customer_id
      )
      select coalesce(jsonb_agg(jsonb_build_object(
        'party_id', c.id,
        'debt', round(coalesce(i.amount, 0) + coalesce(a.debit, 0) + coalesce(o.debit, 0), 2),
        'advance', round(coalesce(a.credit, 0) + coalesce(o.credit, 0), 2)
      ) order by c.name), '[]'::jsonb)
      from public.customers c
      left join invoice_debt i on i.customer_id = c.id
      left join adjustments a on a.customer_id = c.id
      left join opening o on o.customer_id = c.id
      where c.tenant_id = v_tenant_id
        and (coalesce(i.amount, 0) + coalesce(a.debit, 0) + coalesce(o.debit, 0)
          + coalesce(a.credit, 0) + coalesce(o.credit, 0)) > 0.01
    ),
    'suppliers', (
      with purchase_debt as (
        select po.supplier_id,
          sum(greatest(coalesce(po.debt, 0), 0)) as amount
        from public.purchase_orders po
        where po.tenant_id = v_tenant_id and po.status in ('completed', 'partial')
          and po.supplier_id is not null
          and (p_branch_id is null or po.branch_id = p_branch_id)
        group by po.supplier_id
      ), advances as (
        select a.supplier_id, sum(a.remaining_amount) as amount
        from public.supplier_advances a
        where a.tenant_id = v_tenant_id and a.status = 'active'
          and a.remaining_amount > 0
          and (p_branch_id is null or a.branch_id = p_branch_id)
        group by a.supplier_id
      ), opening as (
        select o.supplier_id,
          sum(greatest(o.amount, 0)) as debit,
          sum(greatest(-o.amount, 0)) as credit
        from public.debt_opening_balances o
        where o.tenant_id = v_tenant_id and o.party_type = 'supplier'
          and (p_branch_id is null or o.branch_id = p_branch_id)
        group by o.supplier_id
      )
      select coalesce(jsonb_agg(jsonb_build_object(
        'party_id', s.id,
        'debt', round(coalesce(p.amount, 0) + coalesce(o.debit, 0), 2),
        'advance', round(coalesce(a.amount, 0) + coalesce(o.credit, 0), 2)
      ) order by s.name), '[]'::jsonb)
      from public.suppliers s
      left join purchase_debt p on p.supplier_id = s.id
      left join advances a on a.supplier_id = s.id
      left join opening o on o.supplier_id = s.id
      where s.tenant_id = v_tenant_id
        and (coalesce(p.amount, 0) + coalesce(o.debit, 0)
          + coalesce(a.amount, 0) + coalesce(o.credit, 0)) > 0.01
    )
  );
end;
$$;

revoke all on function public.get_counterparty_balance_summary(uuid)
  from public, anon;
grant execute on function public.get_counterparty_balance_summary(uuid)
  to authenticated;

commit;

-- Read-only postflight. Every boolean must be true.
select
  to_regprocedure('public.record_customer_advance(uuid,numeric,text,text,uuid,uuid)') is not null
    as customer_advance_rpc_ok,
  to_regprocedure('public.record_supplier_advance(uuid,numeric,text,text,uuid,uuid)') is not null
    as supplier_advance_rpc_ok,
  to_regprocedure('public.get_counterparty_balance_summary(uuid)') is not null
    as balance_summary_rpc_ok,
  to_regprocedure('public.trg_reverse_direct_advance_on_cash_cancel()') is not null
    as cancel_reversal_ok,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'customer_debt_adjustments'
      and column_name = 'branch_id'
  ) as customer_adjustment_branch_ok,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'customer_debt_adjustments'
      and column_name = 'cash_transaction_id'
  ) as customer_adjustment_cash_ok;
