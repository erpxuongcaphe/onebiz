-- ============================================================
-- 00242: Harden payment RPC authorization and atomicity
--
-- Schema-only:
-- - never trusts tenant/user/branch sent by an authenticated client;
-- - requires effective finance.create_transaction permission;
-- - enforces tenant and branch access before locking a document;
-- - restores collision-safe cash codes from migration 00155;
-- - writes the financial audit row in the same transaction.
--
-- This migration does not update or delete business data.
-- ============================================================

begin;

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
    v_actor, 'completed', current_date
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
set search_path = public
as $$
declare
  v_actor uuid;
  v_actor_tenant uuid;
  v_is_service_role boolean :=
    coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role';
  v_po record;
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

  select po.id, po.tenant_id, po.branch_id, po.code, po.supplier_id,
         po.supplier_name, po.total, po.paid, po.debt, po.status
    into v_po
    from public.purchase_orders po
   where po.id = p_purchase_order_id
     and po.tenant_id = v_actor_tenant
   for update;

  if not found then
    raise exception 'PURCHASE_ORDER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_branch_id is not null and p_branch_id <> v_po.branch_id then
    raise exception 'BRANCH_SPOOF_BLOCKED' using errcode = 'P0001';
  end if;
  if not public.user_has_branch_access(v_actor, v_po.branch_id) then
    raise exception 'BRANCH_ACCESS_DENIED' using errcode = 'P0001';
  end if;
  if v_po.status not in ('completed', 'partial') then
    raise exception 'PURCHASE_ORDER_NOT_RECEIVED' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_PAYMENT_AMOUNT' using errcode = 'P0001';
  end if;
  if coalesce(v_po.debt, 0) <= 0 then
    raise exception 'PURCHASE_ORDER_HAS_NO_DEBT' using errcode = 'P0001';
  end if;
  if p_amount > v_po.debt then
    raise exception 'PAYMENT_EXCEEDS_DEBT' using errcode = 'P0001';
  end if;
  if p_payment_method not in ('cash', 'transfer', 'card', 'ewallet') then
    raise exception 'INVALID_PAYMENT_METHOD' using errcode = 'P0001';
  end if;

  v_new_paid := coalesce(v_po.paid, 0) + p_amount;
  v_new_debt := v_po.debt - p_amount;
  v_cash_code := public.next_cash_code(v_actor_tenant, 'payment');

  insert into public.cash_transactions (
    tenant_id, branch_id, code, type, category, amount, counterparty,
    payment_method, reference_type, reference_id, supplier_id,
    note, created_by, status, transaction_date
  ) values (
    v_actor_tenant, v_po.branch_id, v_cash_code, 'payment',
    'supplier_payment', p_amount, v_po.supplier_name,
    p_payment_method, 'purchase_order', v_po.id, v_po.supplier_id,
    coalesce(nullif(trim(p_note), ''), 'Tra no don nhap hang ' || v_po.code),
    v_actor, 'completed', current_date
  )
  returning id into v_cash_id;

  update public.purchase_orders
     set paid = v_new_paid,
         debt = v_new_debt,
         updated_at = now()
   where id = v_po.id
     and tenant_id = v_actor_tenant;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_actor_tenant,
    v_actor,
    'payment',
    'purchase_order',
    v_po.id,
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

revoke all on function public.record_invoice_payment(
  uuid, numeric, text, text, uuid, uuid
) from public, anon;
revoke all on function public.record_purchase_payment(
  uuid, numeric, text, text, uuid, uuid
) from public, anon;

grant execute on function public.record_invoice_payment(
  uuid, numeric, text, text, uuid, uuid
) to authenticated, service_role;
grant execute on function public.record_purchase_payment(
  uuid, numeric, text, text, uuid, uuid
) to authenticated, service_role;

commit;

-- Verification only. Expected: both rows are true.
select
  p.proname,
  p.prosecdef as security_definer_ok,
  p.prosrc like '%finance.create_transaction%' as permission_check_ok,
  p.prosrc like '%user_has_branch_access%' as branch_check_ok,
  p.prosrc like '%next_cash_code%' as collision_safe_code_ok,
  p.prosrc like '%insert into public.audit_log%' as atomic_audit_ok
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('record_invoice_payment', 'record_purchase_payment')
order by p.proname;
