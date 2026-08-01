-- ============================================================
-- 00250: Harden F&B payment and completed-invoice void
--
-- Function definitions only. Applying this migration does not update existing
-- business rows. Proven calculation/reversal bodies remain private helpers.
-- ============================================================

begin;

do $$
begin
  if to_regprocedure('public._fnb_complete_payment_impl_00230(uuid,uuid,text,text,jsonb,numeric,numeric,text,uuid,uuid,numeric)') is null then
    if to_regprocedure('public.fnb_complete_payment_atomic(uuid,uuid,text,text,jsonb,numeric,numeric,text,uuid,uuid,numeric)') is null then
      raise exception 'MISSING_REQUIRED_FUNCTION: fnb_complete_payment_atomic';
    end if;
    execute 'alter function public.fnb_complete_payment_atomic(uuid,uuid,text,text,jsonb,numeric,numeric,text,uuid,uuid,numeric) rename to _fnb_complete_payment_impl_00230';
  end if;

  if to_regprocedure('public._void_completed_invoice_impl_00161(uuid,uuid,uuid,text,uuid)') is null then
    if to_regprocedure('public.void_completed_invoice_atomic(uuid,uuid,uuid,text,uuid)') is null then
      raise exception 'MISSING_REQUIRED_FUNCTION: void_completed_invoice_atomic';
    end if;
    execute 'alter function public.void_completed_invoice_atomic(uuid,uuid,uuid,text,uuid) rename to _void_completed_invoice_impl_00161';
  end if;

  if to_regprocedure('public.fnb_complete_payment_atomic(uuid,uuid,text,text,jsonb,numeric,numeric,text,uuid)') is not null then
    execute 'revoke all on function public.fnb_complete_payment_atomic(uuid,uuid,text,text,jsonb,numeric,numeric,text,uuid) from public, anon, authenticated';
  end if;
  if to_regprocedure('public.fnb_complete_payment_atomic(uuid,uuid,text,text,jsonb,numeric,numeric,text,uuid,uuid)') is not null then
    execute 'revoke all on function public.fnb_complete_payment_atomic(uuid,uuid,text,text,jsonb,numeric,numeric,text,uuid,uuid) from public, anon, authenticated';
  end if;
end;
$$;

revoke all on function public._fnb_complete_payment_impl_00230(
  uuid,uuid,text,text,jsonb,numeric,numeric,text,uuid,uuid,numeric
) from public, anon, authenticated;
revoke all on function public._void_completed_invoice_impl_00161(
  uuid,uuid,uuid,text,uuid
) from public, anon, authenticated;

create or replace function public.fnb_complete_payment_atomic(
  p_kitchen_order_id uuid,
  p_customer_id uuid,
  p_customer_name text,
  p_payment_method text,
  p_payment_breakdown jsonb,
  p_paid numeric,
  p_discount_amount numeric,
  p_note text,
  p_created_by uuid,
  p_shift_id uuid default null,
  p_tip_amount numeric default 0
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_order record;
  v_result jsonb;
  v_invoice_id uuid;
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  if p_created_by is not null and p_created_by <> v_actor then
    raise exception 'ACTOR_SPOOF_BLOCKED' using errcode = 'P0001';
  end if;

  select p.tenant_id into v_tenant_id
    from public.profiles p
   where p.id = v_actor
     and coalesce(p.is_active, true);
  if not found then
    raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode = 'P0001';
  end if;
  if not public.user_has_permission(v_actor, 'pos_fnb.view_orders') then
    raise exception 'INSUFFICIENT_PERMISSION' using errcode = 'P0001';
  end if;
  if coalesce(p_discount_amount, 0) > 0
     and not public.user_has_permission(v_actor, 'pos_fnb.discount') then
    raise exception 'DISCOUNT_PERMISSION_REQUIRED' using errcode = 'P0001';
  end if;

  select ko.id, ko.tenant_id, ko.branch_id, ko.invoice_id, ko.status
    into v_order
    from public.kitchen_orders ko
   where ko.id = p_kitchen_order_id
     and ko.tenant_id = v_tenant_id
   for update;
  if not found then
    raise exception 'KITCHEN_ORDER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not public.user_has_branch_access(v_actor, v_order.branch_id) then
    raise exception 'BRANCH_ACCESS_DENIED' using errcode = 'P0001';
  end if;
  if v_order.invoice_id is not null then
    raise exception 'KITCHEN_ORDER_ALREADY_PAID' using errcode = 'P0001';
  end if;

  if p_customer_id is not null and not exists (
    select 1 from public.customers c
     where c.id = p_customer_id
       and c.tenant_id = v_tenant_id
  ) then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0001';
  end if;

  if p_shift_id is not null and not exists (
    select 1 from public.shifts s
     where s.id = p_shift_id
       and s.tenant_id = v_tenant_id
       and s.branch_id = v_order.branch_id
       and s.cashier_id = v_actor
       and s.status = 'open'
  ) then
    raise exception 'SHIFT_NOT_OPEN_FOR_USER_BRANCH' using errcode = 'P0001';
  end if;

  v_result := public._fnb_complete_payment_impl_00230(
    p_kitchen_order_id,
    p_customer_id,
    p_customer_name,
    p_payment_method,
    p_payment_breakdown,
    p_paid,
    p_discount_amount,
    p_note,
    v_actor,
    p_shift_id,
    p_tip_amount
  );

  begin
    v_invoice_id := nullif(v_result->>'invoice_id', '')::uuid;
  exception when others then
    v_invoice_id := null;
  end;
  if v_invoice_id is null then
    raise exception 'INVALID_PAYMENT_RESULT' using errcode = 'P0001';
  end if;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_tenant_id,
    v_actor,
    'complete_payment',
    'invoice',
    v_invoice_id,
    jsonb_build_object(
      'source', 'fnb',
      'kitchen_order_id', v_order.id,
      'branch_id', v_order.branch_id,
      'discount_amount', coalesce(p_discount_amount, 0),
      'tip_amount', coalesce(p_tip_amount, 0),
      'result', v_result,
      'atomic', true
    )
  );

  return v_result;
end;
$$;

create or replace function public.void_completed_invoice_atomic_v2(
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
         i.paid, i.debt, i.customer_id, i.customer_name
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

  if p_shift_id is not null and not exists (
    select 1 from public.shifts s
     where s.id = p_shift_id
       and s.tenant_id = v_tenant_id
       and s.branch_id = v_invoice.branch_id
       and s.cashier_id = v_actor
       and s.status = 'open'
  ) then
    raise exception 'SHIFT_NOT_OPEN_FOR_USER_BRANCH' using errcode = 'P0001';
  end if;

  v_result := public._void_completed_invoice_impl_00161(
    v_tenant_id,
    v_invoice.id,
    v_actor,
    trim(p_reason),
    p_shift_id
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
      'result', v_result,
      'atomic', true
    )
  );

  return v_result;
end;
$$;

revoke all on function public.fnb_complete_payment_atomic(
  uuid,uuid,text,text,jsonb,numeric,numeric,text,uuid,uuid,numeric
) from public, anon;
grant execute on function public.fnb_complete_payment_atomic(
  uuid,uuid,text,text,jsonb,numeric,numeric,text,uuid,uuid,numeric
) to authenticated;

revoke all on function public.void_completed_invoice_atomic_v2(
  uuid,text,text,uuid
) from public, anon;
grant execute on function public.void_completed_invoice_atomic_v2(
  uuid,text,text,uuid
) to authenticated;

commit;

-- Verification only. Both active functions must be fully true.
select
  p.proname,
  p.prosecdef as security_definer_ok,
  p.prosrc like '%auth.uid()%' as auth_actor_ok,
  p.prosrc like '%user_has_permission%' as permission_check_ok,
  p.prosrc like '%user_has_branch_access%' as branch_check_ok,
  p.prosrc like '%insert into public.audit_log%' as atomic_audit_ok
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'fnb_complete_payment_atomic',
    'void_completed_invoice_atomic_v2'
  )
order by p.proname;
