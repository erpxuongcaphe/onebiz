-- ============================================================
-- 00267: Atomic manual cash vouchers and tenant-safe cancellation
-- ============================================================
-- Function definitions only. Existing cash, invoice, purchase and debt rows are untouched.

create or replace function public.create_manual_cash_transaction_atomic(
  p_requested_code text,
  p_branch_id uuid,
  p_type text,
  p_category text,
  p_amount numeric,
  p_counterparty text,
  p_payment_method text,
  p_note text,
  p_transaction_date date
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_code text;
  v_shift_id uuid;
  v_row record;
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
  if not public.user_has_permission(v_actor, 'finance.create_transaction') then
    raise exception using errcode = '42501', message = 'CASH_CREATE_DENIED';
  end if;
  if not exists (
    select 1 from public.branches b
     where b.id = p_branch_id
       and b.tenant_id = v_tenant_id
       and coalesce(b.is_active, true)
  ) or not public.user_has_branch_access(v_actor, p_branch_id) then
    raise exception using errcode = '42501', message = 'CASH_BRANCH_DENIED';
  end if;
  if p_type not in ('receipt', 'payment') then
    raise exception using errcode = '22023', message = 'CASH_TYPE_INVALID';
  end if;
  if nullif(trim(coalesce(p_category, '')), '') is null then
    raise exception using errcode = '22023', message = 'CASH_CATEGORY_REQUIRED';
  end if;
  if p_category in ('customer_payment', 'supplier_payment') then
    raise exception using errcode = '22023', message = 'DEBT_PAYMENT_REQUIRES_DOCUMENT';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount = 'NaN'::numeric then
    raise exception using errcode = '22023', message = 'CASH_AMOUNT_INVALID';
  end if;
  if coalesce(p_payment_method, 'cash') not in ('cash', 'transfer', 'card', 'ewallet') then
    raise exception using errcode = '22023', message = 'CASH_PAYMENT_METHOD_INVALID';
  end if;

  v_code := nullif(trim(coalesce(p_requested_code, '')), '');
  if v_code is null then
    v_code := public.next_code(
      v_tenant_id,
      case when p_type = 'receipt' then 'cash_receipt' else 'cash_payment' end
    );
  elsif length(v_code) > 50 then
    raise exception using errcode = '22023', message = 'CASH_CODE_INVALID';
  end if;

  select s.id into v_shift_id
    from public.shifts s
   where s.tenant_id = v_tenant_id
     and s.branch_id = p_branch_id
     and s.cashier_id = v_actor
     and s.status = 'open'
   order by s.opened_at desc
   limit 1;

  insert into public.cash_transactions (
    tenant_id, branch_id, code, type, category, amount, counterparty,
    payment_method, reference_type, reference_id, note, created_by,
    status, transaction_date, shift_id
  ) values (
    v_tenant_id, p_branch_id, v_code, p_type, trim(p_category), p_amount,
    nullif(trim(coalesce(p_counterparty, '')), ''), coalesce(p_payment_method, 'cash'),
    null, null, nullif(trim(coalesce(p_note, '')), ''), v_actor,
    'completed', coalesce(p_transaction_date, current_date), v_shift_id
  ) returning * into v_row;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_tenant_id, v_actor, 'cash_transaction_created', 'cash_transaction', v_row.id,
    jsonb_build_object(
      'code', v_row.code, 'branch_id', v_row.branch_id, 'type', v_row.type,
      'category', v_row.category, 'amount', v_row.amount,
      'payment_method', v_row.payment_method, 'transaction_date', v_row.transaction_date,
      'shift_id', v_row.shift_id, 'atomic', true
    )
  );

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.create_manual_cash_transaction_atomic(
  text, uuid, text, text, numeric, text, text, text, date
) from public, anon;
grant execute on function public.create_manual_cash_transaction_atomic(
  text, uuid, text, text, numeric, text, text, text, date
) to authenticated;

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
   where ct.id = p_cash_id
     and ct.tenant_id = v_tenant_id
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

  v_old_data := jsonb_build_object(
    'status', v_cash.status, 'amount', v_cash.amount,
    'reference_type', v_cash.reference_type, 'reference_id', v_cash.reference_id
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
    update public.purchase_orders po
       set paid = greatest(0, coalesce(po.paid, 0) - v_cash.amount),
           debt = greatest(0, coalesce(po.total, 0) - greatest(0, coalesce(po.paid, 0) - v_cash.amount)),
           updated_at = now()
     where po.id = v_cash.reference_id
       and po.tenant_id = v_tenant_id
       and po.branch_id = v_cash.branch_id;
    if not found then
      raise exception using errcode = '22023', message = 'CASH_REFERENCE_PURCHASE_INVALID';
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

comment on function public.create_manual_cash_transaction_atomic(
  text, uuid, text, text, numeric, text, text, text, date
) is 'Creates an unlinked manual cash voucher with server-derived actor, shift and audit.';
comment on function public.cancel_cash_transaction(uuid, text) is
  'Cancels a tenant cash voucher atomically and reverses linked document debt safely.';

select
  to_regprocedure('public.create_manual_cash_transaction_atomic(text,uuid,text,text,numeric,text,text,text,date)') is not null as create_cash_ok,
  to_regprocedure('public.cancel_cash_transaction(uuid,text)') is not null as cancel_cash_ok;
