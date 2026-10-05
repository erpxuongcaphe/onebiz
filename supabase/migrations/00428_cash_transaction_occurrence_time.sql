-- 00428: Separate cash occurrence, bookkeeping date and immutable creation audit.
-- No historical timestamp is inferred or business row backfilled.
begin;
alter table public.cash_transactions add column if not exists occurred_at timestamptz;
alter table public.cash_transactions add column if not exists time_source text;
alter table public.cash_transactions add column if not exists time_reason text;
alter table public.cash_transactions alter column occurred_at set default now();
alter table public.cash_transactions alter column time_source set default 'system';
alter table public.cash_transactions alter column transaction_date set default ((now() at time zone 'Asia/Ho_Chi_Minh')::date);
comment on column public.cash_transactions.occurred_at is 'Cash receipt/payment occurrence; null for historical or date-only imports. Not created_at.';
comment on column public.cash_transactions.time_source is 'system, entered or date_only; historical null is preserved.';

-- Preserve existing authorization, locks and amount/debt behavior: record_invoice_payment
create or replace function public.record_invoice_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_note text default null,
  p_branch_id uuid default null,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_actor_tenant uuid;
  v_is_service_role boolean :=
    coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role';
  v_invoice record;
  v_cash_id uuid;
  v_cash_code text;
  v_new_paid numeric;
  v_new_debt numeric;
begin
  v_actor := case when v_is_service_role then p_user_id else auth.uid() end;

  if v_actor is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  if not v_is_service_role
     and p_user_id is not null
     and p_user_id <> v_actor then
    raise exception 'ACTOR_SPOOF_BLOCKED' using errcode = 'P0001';
  end if;

  select p.tenant_id
    into v_actor_tenant
    from public.profiles p
   where p.id = v_actor
     and coalesce(p.is_active, true);

  if not found then
    raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode = 'P0001';
  end if;
  if not public.user_has_permission(v_actor, 'finance.create_transaction') then
    raise exception 'INSUFFICIENT_PERMISSION' using errcode = 'P0001';
  end if;

  select i.id, i.tenant_id, i.branch_id, i.code, i.customer_id,
         i.customer_name, i.total, i.paid, i.debt, i.status
    into v_invoice
    from public.invoices i
   where i.id = p_invoice_id
     and i.tenant_id = v_actor_tenant
   for update;

  if not found then
    raise exception 'INVOICE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_branch_id is not null and p_branch_id <> v_invoice.branch_id then
    raise exception 'BRANCH_SPOOF_BLOCKED' using errcode = 'P0001';
  end if;
  if not public.user_has_branch_access(v_actor, v_invoice.branch_id) then
    raise exception 'BRANCH_ACCESS_DENIED' using errcode = 'P0001';
  end if;
  if v_invoice.status <> 'completed' then
    raise exception 'INVOICE_NOT_COMPLETED' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_PAYMENT_AMOUNT' using errcode = 'P0001';
  end if;
  if coalesce(v_invoice.debt, 0) <= 0 then
    raise exception 'INVOICE_HAS_NO_DEBT' using errcode = 'P0001';
  end if;
  if p_amount > v_invoice.debt then
    raise exception 'PAYMENT_EXCEEDS_DEBT' using errcode = 'P0001';
  end if;
  if p_payment_method not in ('cash', 'transfer', 'card', 'ewallet') then
    raise exception 'INVALID_PAYMENT_METHOD' using errcode = 'P0001';
  end if;

  v_new_paid := coalesce(v_invoice.paid, 0) + p_amount;
  v_new_debt := v_invoice.debt - p_amount;
  v_cash_code := public.next_cash_code(v_actor_tenant, 'receipt');

  insert into public.cash_transactions (
    tenant_id, branch_id, code, type, category, amount, counterparty,
    payment_method, reference_type, reference_id, customer_id,
    note, created_by, status, transaction_date
  ) values (
    v_actor_tenant, v_invoice.branch_id, v_cash_code, 'receipt',
    'customer_payment', p_amount, v_invoice.customer_name,
    p_payment_method, 'invoice', v_invoice.id, v_invoice.customer_id,
    coalesce(nullif(trim(p_note), ''), 'Thu no hoa don ' || v_invoice.code),
    v_actor, 'completed', ((now() at time zone 'Asia/Ho_Chi_Minh')::date)
  )
  returning id into v_cash_id;

  update public.invoices
     set paid = v_new_paid,
         debt = v_new_debt,
         updated_at = now()
   where id = v_invoice.id
     and tenant_id = v_actor_tenant;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_actor_tenant,
    v_actor,
    'payment',
    'invoice',
    v_invoice.id,
    jsonb_build_object(
      'cash_transaction_id', v_cash_id,
      'cash_code', v_cash_code,
      'amount', p_amount,
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
    'new_debt', v_new_debt
  );
end;
$$;

-- Preserve existing authorization, locks and amount/debt behavior: record_purchase_payment
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
    v_actor, 'completed', ((now() at time zone 'Asia/Ho_Chi_Minh')::date)
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

-- Preserve existing authorization, locks and amount/debt behavior: record_customer_advance
create or replace function public.record_customer_advance(
  p_customer_id uuid, p_amount numeric, p_payment_method text, p_note text,
  p_branch_id uuid, p_user_id uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid; v_tenant_id uuid; v_customer record; v_amount numeric(15,2);
  v_note text := nullif(trim(coalesce(p_note, '')), ''); v_cash_id uuid; v_cash_code text;
  v_adjustment_id uuid; v_advance_id uuid;
begin
  v_actor := case when coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' then p_user_id else auth.uid() end;
  if v_actor is null then raise exception using errcode = '42501', message = 'UNAUTHENTICATED'; end if;
  select p.tenant_id into v_tenant_id from public.profiles p where p.id = v_actor and coalesce(p.is_active, true);
  if v_tenant_id is null then raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED'; end if;
  if not public.user_has_permission(v_actor, 'finance.create_transaction') then raise exception using errcode = '42501', message = 'INSUFFICIENT_PERMISSION'; end if;
  if p_branch_id is null or not public.user_has_branch_access(v_actor, p_branch_id) then raise exception using errcode = '42501', message = 'ADVANCE_BRANCH_REQUIRED_OR_DENIED'; end if;
  select c.id, c.name into v_customer from public.customers c where c.id = p_customer_id and c.tenant_id = v_tenant_id for update;
  if not found then raise exception using errcode = '22023', message = 'CUSTOMER_NOT_FOUND'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 9999999999999.99 then raise exception using errcode = '22023', message = 'INVALID_ADVANCE_AMOUNT'; end if;
  if p_payment_method not in ('cash', 'transfer', 'card', 'ewallet') then raise exception using errcode = '22023', message = 'INVALID_PAYMENT_METHOD'; end if;
  if v_note is null or length(v_note) < 3 then raise exception using errcode = '22023', message = 'CUSTOMER_ADVANCE_NOTE_REQUIRED'; end if;
  v_amount := round(p_amount, 2); v_cash_code := public.next_cash_code(v_tenant_id, 'receipt');
  insert into public.cash_transactions (tenant_id, branch_id, code, type, category, amount, counterparty, payment_method, customer_id, note, created_by, status, transaction_date)
  values (v_tenant_id, p_branch_id, v_cash_code, 'receipt', 'customer_advance', v_amount, v_customer.name, p_payment_method, p_customer_id, v_note, v_actor, 'completed', ((now() at time zone 'Asia/Ho_Chi_Minh')::date))
  returning id into v_cash_id;
  insert into public.customer_debt_adjustments (tenant_id, branch_id, customer_id, amount, reason, idempotency_key, cash_transaction_id, created_by)
  values (v_tenant_id, p_branch_id, p_customer_id, -v_amount, v_note, 'customer-advance:' || v_cash_id::text, v_cash_id, v_actor)
  returning id into v_adjustment_id;
  insert into public.customer_advances (tenant_id, branch_id, customer_id, cash_transaction_id, adjustment_id, original_amount, remaining_amount, note, created_by)
  values (v_tenant_id, p_branch_id, p_customer_id, v_cash_id, v_adjustment_id, v_amount, v_amount, v_note, v_actor) returning id into v_advance_id;
  insert into public.audit_log (tenant_id, user_id, action, entity_type, entity_id, new_data)
  values (v_tenant_id, v_actor, 'customer_advance_recorded', 'cash_transaction', v_cash_id, jsonb_build_object('customer_id', p_customer_id, 'branch_id', p_branch_id, 'amount', v_amount, 'cash_code', v_cash_code, 'customer_advance_id', v_advance_id));
  return jsonb_build_object('cash_transaction_id', v_cash_id, 'cash_code', v_cash_code, 'advance_amount', v_amount, 'advance_id', v_advance_id);
end; $$;

-- Preserve existing authorization, locks and amount/debt behavior: record_supplier_advance
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
    v_note, v_actor, 'completed', ((now() at time zone 'Asia/Ho_Chi_Minh')::date)
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

-- Preserve existing authorization, locks and amount/debt behavior: create_manual_cash_transaction_atomic
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
    'completed', coalesce(p_transaction_date, ((now() at time zone 'Asia/Ho_Chi_Minh')::date)), v_shift_id
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


create or replace function public.record_cash_transaction_timed(
  p_operation text, p_payload jsonb, p_occurred_at timestamptz default null,
  p_transaction_date date default null, p_time_reason text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_result jsonb; v_id uuid; v_row public.cash_transactions%rowtype;
  v_at timestamptz := coalesce(p_occurred_at, now());
  v_day date; v_source text; v_reason text := nullif(trim(p_time_reason), '');
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  if not isfinite(v_at) or v_at > now() + interval '5 minutes' then
    raise exception 'CASH_TIME_INVALID' using errcode='22023';
  end if;
  v_day := coalesce(p_transaction_date, (v_at at time zone 'Asia/Ho_Chi_Minh')::date);
  if not isfinite(v_day) or v_day > (now() at time zone 'Asia/Ho_Chi_Minh')::date then
    raise exception 'CASH_BOOK_DATE_INVALID' using errcode='22023';
  end if;
  if (v_day <> (v_at at time zone 'Asia/Ho_Chi_Minh')::date
      or (v_at at time zone 'Asia/Ho_Chi_Minh')::date <> (now() at time zone 'Asia/Ho_Chi_Minh')::date)
     and coalesce(length(v_reason),0) < 3 then
    raise exception 'CASH_TIME_REASON_REQUIRED' using errcode='22023';
  end if;
  -- Each delegated RPC retains its existing tenant/branch/permission checks.
  case p_operation
    when 'invoice' then v_result := public.record_invoice_payment((p_payload->>'referenceId')::uuid, (p_payload->>'amount')::numeric, p_payload->>'paymentMethod', p_payload->>'note', null, null);
    when 'purchase_order' then v_result := public.record_purchase_payment((p_payload->>'referenceId')::uuid, (p_payload->>'amount')::numeric, p_payload->>'paymentMethod', p_payload->>'note', null, null);
    when 'customer_advance' then v_result := public.record_customer_advance((p_payload->>'partyId')::uuid, (p_payload->>'amount')::numeric, p_payload->>'paymentMethod', p_payload->>'note', (p_payload->>'branchId')::uuid, null);
    when 'supplier_advance' then v_result := public.record_supplier_advance((p_payload->>'partyId')::uuid, (p_payload->>'amount')::numeric, p_payload->>'paymentMethod', p_payload->>'note', (p_payload->>'branchId')::uuid, null);
    when 'manual' then v_result := public.create_manual_cash_transaction_atomic(p_payload->>'code', (p_payload->>'branchId')::uuid, p_payload->>'type', p_payload->>'category', (p_payload->>'amount')::numeric, p_payload->>'counterparty', p_payload->>'paymentMethod', p_payload->>'note', v_day);
    else raise exception 'CASH_OPERATION_INVALID' using errcode='22023';
  end case;
  v_id := coalesce(v_result->>'cash_transaction_id', v_result->>'id')::uuid;
  -- Only the new voucher returned by an authorized RPC may receive metadata.
  select * into v_row from public.cash_transactions where id=v_id and created_by=auth.uid()
    and tenant_id=(select tenant_id from public.profiles where id=auth.uid() and coalesce(is_active,true)) for update;
  if not found then raise exception 'CASH_TIME_ROW_DENIED' using errcode='42501'; end if;
  if not public.user_has_permission(auth.uid(),'finance.create_transaction')
    or not public.user_has_branch_access(auth.uid(),v_row.branch_id) then
    raise exception 'CASH_TIME_ROW_DENIED' using errcode='42501';
  end if;
  v_source := case when p_occurred_at is not null then 'entered' when p_transaction_date is not null then 'date_only' else 'system' end;
  update public.cash_transactions set
    occurred_at=case when v_source='date_only' then null else v_at end,
    time_source=v_source, time_reason=v_reason, transaction_date=v_day
  where id=v_id;
  insert into public.audit_log(tenant_id,user_id,action,entity_type,entity_id,new_data)
  values(v_row.tenant_id,auth.uid(),'cash_time_recorded','cash_transaction',v_id,
    jsonb_build_object('occurred_at',case when v_source='date_only' then null else v_at end,'transaction_date',v_day,'time_source',v_source,'time_reason',v_reason,'created_at',v_row.created_at,'atomic',true));
  if p_operation='manual' then select to_jsonb(c) into v_result from public.cash_transactions c where id=v_id; end if;
  return v_result;
end; $$;
revoke all on function public.record_cash_transaction_timed(text,jsonb,timestamptz,date,text) from public, anon;
grant execute on function public.record_cash_transaction_timed(text,jsonb,timestamptz,date,text) to authenticated;
notify pgrst, 'reload schema';
commit;
