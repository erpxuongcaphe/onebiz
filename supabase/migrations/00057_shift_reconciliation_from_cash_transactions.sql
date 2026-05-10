-- 00057 - Shift reconciliation from cash_transactions
-- Fix: mixed payments/refunds must be reconciled from cash_transactions,
-- not from invoices.payment_method, otherwise cash/transfer/card totals drift.

create index if not exists idx_cash_tx_shift_reconcile
  on public.cash_transactions(shift_id, status, reference_type, payment_method)
  where shift_id is not null;

create or replace function public.close_shift_atomic(
  p_shift_id uuid,
  p_actual_cash numeric,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift record;
  v_cash_in numeric := 0;
  v_cash_out numeric := 0;
  v_expected numeric;
  v_variance numeric;
  v_total_sales numeric := 0;
  v_total_orders int := 0;
  v_sales_by_method jsonb := '{}'::jsonb;
  r record;
begin
  select * into v_shift
  from public.shifts
  where id = p_shift_id
    and status = 'open'
  for update;

  if not found then
    raise exception 'Shift % does not exist or is already closed', p_shift_id;
  end if;

  -- Physical cash reconciliation: every completed cash receipt/payment inside the shift.
  select
    coalesce(sum(case when type = 'receipt' then amount else 0 end), 0),
    coalesce(sum(case when type = 'payment' then amount else 0 end), 0)
  into v_cash_in, v_cash_out
  from public.cash_transactions
  where shift_id = p_shift_id
    and coalesce(status, 'completed') <> 'cancelled'
    and coalesce(payment_method, 'cash') = 'cash';

  v_expected := coalesce(v_shift.starting_cash, 0) + v_cash_in - v_cash_out;
  v_variance := p_actual_cash - v_expected;

  -- Completed order count stays invoice-based.
  select count(*)::int
  into v_total_orders
  from public.invoices
  where shift_id = p_shift_id
    and status = 'completed';

  -- Sales collected by method: invoice receipts minus sales-return/invoice refunds.
  -- This supports mixed payment breakdown because each method has its own cash row.
  for r in
    select method, sum(net_amount) as amount
    from (
      select
        coalesce(payment_method, 'cash') as method,
        case
          when type = 'receipt' and reference_type = 'invoice' then coalesce(amount, 0)
          when type = 'payment' and reference_type in ('invoice', 'sales_return') then -coalesce(amount, 0)
          else 0
        end as net_amount
      from public.cash_transactions
      where shift_id = p_shift_id
        and coalesce(status, 'completed') <> 'cancelled'
        and reference_type in ('invoice', 'sales_return')
    ) s
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
  set status          = 'closed',
      closed_at       = now(),
      expected_cash   = v_expected,
      actual_cash     = p_actual_cash,
      cash_difference = v_variance,
      total_sales     = v_total_sales,
      total_orders    = v_total_orders,
      sales_by_method = v_sales_by_method,
      note            = p_note
  where id = p_shift_id;

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

comment on function public.close_shift_atomic is
  'Close shift atomically. Reconciles expected cash and sales_by_method from cash_transactions so mixed payments and refunds are exact.';
