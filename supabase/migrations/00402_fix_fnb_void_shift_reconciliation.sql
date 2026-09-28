-- Reconcile F&B invoice-void refunds with the shift that owns the sale.
-- Retail behavior is intentionally unchanged: automatic shift inheritance and
-- invoice_void netting below are both guarded by invoices.source = 'fnb'.
-- Function-only migration; applying it does not mutate business rows.

create or replace function public._void_completed_invoice_atomic_v2_impl_00250(
  p_invoice_id uuid,
  p_reason text,
  p_refund_method text default null,
  p_shift_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_invoice record;
  v_effective_shift_id uuid;
  v_result jsonb;
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;

  select p.tenant_id into v_tenant_id
    from public.profiles p
   where p.id = v_actor
     and coalesce(p.is_active, true);
  if not found then
    raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode = 'P0001';
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'VOID_REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if p_refund_method is not null
     and p_refund_method not in ('cash', 'transfer', 'card') then
    raise exception 'INVALID_REFUND_METHOD' using errcode = 'P0001';
  end if;

  select i.id, i.code, i.branch_id, i.source, i.status, i.total,
         i.paid, i.debt, i.customer_id, i.customer_name, i.shift_id
    into v_invoice
    from public.invoices i
   where i.id = p_invoice_id
     and i.tenant_id = v_tenant_id
   for update;
  if not found then
    raise exception 'INVOICE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not public.user_has_branch_access(v_actor, v_invoice.branch_id) then
    raise exception 'BRANCH_ACCESS_DENIED' using errcode = 'P0001';
  end if;
  if coalesce(v_invoice.source, '') = 'fnb' then
    if not public.user_has_permission(v_actor, 'pos_fnb.void_paid_bill') then
      raise exception 'INSUFFICIENT_PERMISSION' using errcode = 'P0001';
    end if;
  elsif not public.user_has_permission(v_actor, 'pos_retail.void') then
    raise exception 'INSUFFICIENT_PERMISSION' using errcode = 'P0001';
  end if;

  if p_shift_id is not null then
    if not exists (
      select 1 from public.shifts s
       where s.id = p_shift_id
         and s.tenant_id = v_tenant_id
         and s.branch_id = v_invoice.branch_id
         and s.cashier_id = v_actor
         and s.status = 'open'
    ) then
      raise exception 'SHIFT_NOT_OPEN_FOR_USER_BRANCH' using errcode = 'P0001';
    end if;
    v_effective_shift_id := p_shift_id;
  elsif coalesce(v_invoice.source, '') = 'fnb' then
    -- Invoice-list voids have no POS context. Reuse the original F&B shift
    -- only while it can still be reconciled; never rewrite a closed shift.
    select s.id into v_effective_shift_id
      from public.shifts s
     where s.id = v_invoice.shift_id
       and s.tenant_id = v_tenant_id
       and s.branch_id = v_invoice.branch_id
       and s.status in ('open', 'pending_reconcile');
  end if;

  v_result := public._void_completed_invoice_impl_00161(
    v_tenant_id,
    v_invoice.id,
    v_actor,
    trim(p_reason),
    v_effective_shift_id
  );

  if p_refund_method is not null then
    update public.cash_transactions
       set payment_method = p_refund_method
     where tenant_id = v_tenant_id
       and reference_type = 'invoice_void'
       and reference_id = v_invoice.id
       and type = 'payment';
  end if;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_tenant_id,
    v_actor,
    'cancel',
    'invoice',
    v_invoice.id,
    jsonb_build_object(
      'code', v_invoice.code,
      'status', v_invoice.status,
      'total', v_invoice.total,
      'paid', v_invoice.paid,
      'debt', v_invoice.debt,
      'customer_id', v_invoice.customer_id,
      'customer_name', v_invoice.customer_name
    ),
    jsonb_build_object(
      'status', 'cancelled',
      'reason', trim(p_reason),
      'refund_method', p_refund_method,
      'shift_id', v_effective_shift_id,
      'result', v_result,
      'atomic', true
    )
  );

  return v_result;
end;
$$;

-- Keep the 00380 public wrapper intact so an F&B invoice void still closes
-- its linked kitchen order. Only the private implementation gains shift
-- inheritance.
revoke all on function public._void_completed_invoice_atomic_v2_impl_00250(
  uuid,text,text,uuid
) from public, anon, authenticated;

create or replace function public._finalize_shift_atomic_00298(
  p_shift_id uuid,
  p_actual_cash numeric,
  p_note text,
  p_required_status text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shift record;
  v_cash_in numeric := 0;
  v_cash_out numeric := 0;
  v_expected numeric;
  v_variance numeric;
  v_total_sales numeric := 0;
  v_total_orders integer := 0;
  v_sales_by_method jsonb := '{}'::jsonb;
  r record;
begin
  if p_required_status not in ('open', 'pending_reconcile') then
    raise exception using errcode = '22023', message = 'SHIFT_STATUS_INVALID';
  end if;
  if p_actual_cash is null or p_actual_cash < 0 then
    raise exception using errcode = '22023', message = 'SHIFT_ACTUAL_CASH_INVALID';
  end if;

  select *
    into v_shift
    from public.shifts s
   where s.id = p_shift_id
     and s.status = p_required_status
   for update;
  if not found then
    raise exception using errcode = 'PT409', message = 'SHIFT_STATE_CHANGED';
  end if;

  select
    coalesce(sum(case when ct.type = 'receipt' then ct.amount else 0 end), 0),
    coalesce(sum(case when ct.type = 'payment' then ct.amount else 0 end), 0)
    into v_cash_in, v_cash_out
    from public.cash_transactions ct
   where ct.shift_id = p_shift_id
     and coalesce(ct.status, 'completed') <> 'cancelled'
     and coalesce(ct.payment_method, 'cash') = 'cash';

  v_expected := coalesce(v_shift.starting_cash, 0) + v_cash_in - v_cash_out;
  v_variance := p_actual_cash - v_expected;

  select count(*)::integer
    into v_total_orders
    from public.invoices i
   where i.shift_id = p_shift_id
     and i.status = 'completed';

  for r in
    select method, sum(net_amount) as amount
      from (
        select
          coalesce(ct.payment_method, 'cash') as method,
          case
            when ct.type = 'receipt' and ct.reference_type = 'invoice'
              then coalesce(ct.amount, 0)
            when ct.type = 'payment'
                 and ct.reference_type in ('invoice', 'sales_return')
              then -coalesce(ct.amount, 0)
            when ct.type = 'payment'
                 and ct.reference_type = 'invoice_void'
                 and voided_invoice.source = 'fnb'
              then -coalesce(ct.amount, 0)
            else 0
          end as net_amount
        from public.cash_transactions ct
        left join public.invoices voided_invoice
          on ct.reference_type = 'invoice_void'
         and voided_invoice.id = ct.reference_id
         and voided_invoice.tenant_id = ct.tenant_id
       where ct.shift_id = p_shift_id
         and coalesce(ct.status, 'completed') <> 'cancelled'
         and (
           ct.reference_type in ('invoice', 'sales_return')
           or (
             ct.reference_type = 'invoice_void'
             and voided_invoice.source = 'fnb'
           )
         )
      ) movements
     group by method
    having sum(net_amount) <> 0
  loop
    v_sales_by_method := jsonb_set(
      v_sales_by_method,
      array[r.method],
      to_jsonb(r.amount),
      true
    );
    v_total_sales := v_total_sales + r.amount;
  end loop;

  update public.shifts
     set status = 'closed',
         closed_at = now(),
         expected_cash = v_expected,
         actual_cash = p_actual_cash,
         cash_difference = v_variance,
         total_sales = v_total_sales,
         total_orders = v_total_orders,
         sales_by_method = v_sales_by_method,
         note = p_note
   where id = p_shift_id
     and status = p_required_status;
  if not found then
    raise exception using errcode = 'PT409', message = 'SHIFT_STATE_CHANGED';
  end if;

  return jsonb_build_object(
    'shift_id', p_shift_id,
    'starting_cash', v_shift.starting_cash,
    'cash_in', v_cash_in,
    'cash_out', v_cash_out,
    'expected_cash', v_expected,
    'actual_cash', p_actual_cash,
    'cash_difference', v_variance,
    'total_sales', v_total_sales,
    'total_orders', v_total_orders,
    'sales_by_method', v_sales_by_method,
    'opened_at', v_shift.opened_at,
    'closed_at', now()
  );
end;
$$;

revoke all on function public._finalize_shift_atomic_00298(
  uuid, numeric, text, text
) from public, anon, authenticated;

select
  position('v_effective_shift_id' in void_impl_def) > 0 as fnb_void_shift_ok,
  position('fnb_kitchen_orders_cancelled' in void_wrapper_def) > 0
    as fnb_kds_wrapper_preserved,
  position('voided_invoice.source = ''fnb''' in finalize_def) > 0 as fnb_only_ok,
  position('''PT409''' in finalize_def) > 0 as retry_guard_ok
from (
  select
    pg_get_functiondef(
      to_regprocedure(
        'public._void_completed_invoice_atomic_v2_impl_00250(uuid,text,text,uuid)'
      )
    ) as void_impl_def,
    pg_get_functiondef(
      to_regprocedure('public.void_completed_invoice_atomic_v2(uuid,text,text,uuid)')
    ) as void_wrapper_def,
    pg_get_functiondef(
      to_regprocedure('public._finalize_shift_atomic_00298(uuid,numeric,text,text)')
    ) as finalize_def
) defs;
