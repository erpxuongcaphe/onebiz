-- ============================================================
-- 00271: Atomic edit/cancel for draft or confirmed invoices
-- ============================================================
-- Function definitions only. Existing invoices and linked rows are untouched.

create or replace function public.cancel_draft_invoice_atomic(
  p_invoice_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_invoice record;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_shipping_count integer;
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
  if not public.user_has_permission(v_actor, 'orders.cancel') then
    raise exception using errcode = '42501', message = 'INVOICE_CANCEL_DENIED';
  end if;
  if v_reason is null or length(v_reason) < 3 then
    raise exception using errcode = '22023', message = 'INVOICE_CANCEL_REASON_REQUIRED';
  end if;

  select i.* into v_invoice
    from public.invoices i
   where i.id = p_invoice_id
     and i.tenant_id = v_tenant_id
     and i.deleted_at is null
   for update;
  if not found then
    raise exception using errcode = '22023', message = 'INVOICE_NOT_FOUND';
  end if;
  if not public.user_has_branch_access(v_actor, v_invoice.branch_id) then
    raise exception using errcode = '42501', message = 'INVOICE_BRANCH_DENIED';
  end if;
  if v_invoice.status = 'cancelled' then
    return jsonb_build_object(
      'invoice_id', v_invoice.id, 'code', v_invoice.code,
      'status', 'cancelled', 'idempotent', true
    );
  end if;
  if v_invoice.status not in ('draft', 'confirmed') then
    raise exception using errcode = '22023', message = 'INVOICE_REQUIRES_COMPLETED_VOID';
  end if;
  if coalesce(v_invoice.paid, 0) <> 0
     or exists (
       select 1 from public.stock_movements sm
       where sm.tenant_id = v_tenant_id
         and sm.reference_id = v_invoice.id
         and sm.reference_type in ('invoice', 'pos', 'sale')
     )
     or exists (
       select 1 from public.cash_transactions ct
       where ct.tenant_id = v_tenant_id
         and ct.reference_id = v_invoice.id
         and ct.reference_type = 'invoice'
         and ct.status <> 'cancelled'
     ) then
    raise exception using errcode = '22023', message = 'INVOICE_REQUIRES_COMPLETED_VOID';
  end if;

  update public.invoices
     set status = 'cancelled', client_session_id = null, updated_at = now(),
         note = concat_ws(E'\n', nullif(note, ''), '[HỦY] ' || v_reason)
   where id = v_invoice.id and tenant_id = v_tenant_id;

  update public.shipping_orders
     set status = 'cancelled', updated_at = now()
   where tenant_id = v_tenant_id
     and invoice_id = v_invoice.id
     and status = 'pending';
  get diagnostics v_shipping_count = row_count;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_tenant_id, v_actor, 'invoice_draft_cancelled', 'invoice', v_invoice.id,
    jsonb_build_object(
      'status', v_invoice.status, 'paid', v_invoice.paid, 'debt', v_invoice.debt
    ),
    jsonb_build_object(
      'status', 'cancelled', 'reason', v_reason,
      'pending_shipments_cancelled', v_shipping_count, 'atomic', true
    )
  );

  return jsonb_build_object(
    'invoice_id', v_invoice.id, 'code', v_invoice.code,
    'status', 'cancelled', 'pending_shipments_cancelled', v_shipping_count,
    'idempotent', false
  );
end;
$$;

create or replace function public.update_draft_invoice_atomic(
  p_invoice_id uuid,
  p_patch jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_invoice record;
  v_customer_id uuid;
  v_customer_name text;
  v_discount numeric;
  v_method text;
  v_note text;
  v_total numeric;
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
  if not public.user_has_permission(v_actor, 'orders.create') then
    raise exception using errcode = '42501', message = 'INVOICE_EDIT_DENIED';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object'
     or exists (
       select 1 from jsonb_object_keys(p_patch) k
       where k not in ('customerId', 'customerName', 'discountAmount', 'paymentMethod', 'note')
     ) then
    raise exception using errcode = '22023', message = 'INVOICE_PATCH_INVALID';
  end if;

  select i.* into v_invoice
    from public.invoices i
   where i.id = p_invoice_id
     and i.tenant_id = v_tenant_id
     and i.deleted_at is null
   for update;
  if not found then
    raise exception using errcode = '22023', message = 'INVOICE_NOT_FOUND';
  end if;
  if not public.user_has_branch_access(v_actor, v_invoice.branch_id) then
    raise exception using errcode = '42501', message = 'INVOICE_BRANCH_DENIED';
  end if;
  if v_invoice.status not in ('draft', 'confirmed') or coalesce(v_invoice.paid, 0) <> 0 then
    raise exception using errcode = '22023', message = 'INVOICE_NOT_EDITABLE';
  end if;

  v_customer_id := v_invoice.customer_id;
  v_customer_name := v_invoice.customer_name;
  v_discount := coalesce(v_invoice.discount_amount, 0);
  v_method := v_invoice.payment_method;
  v_note := v_invoice.note;

  if p_patch ? 'customerId' then
    begin
      v_customer_id := nullif(p_patch->>'customerId', '')::uuid;
    exception when others then
      raise exception using errcode = '22023', message = 'INVOICE_CUSTOMER_INVALID';
    end;
    if v_customer_id is not null then
      select c.name into v_customer_name
        from public.customers c
       where c.id = v_customer_id
         and c.tenant_id = v_tenant_id
         and coalesce(c.is_active, true);
      if not found then
        raise exception using errcode = '22023', message = 'INVOICE_CUSTOMER_INVALID';
      end if;
    else
      v_customer_name := coalesce(
        nullif(trim(coalesce(p_patch->>'customerName', '')), ''), 'Khách lẻ'
      );
    end if;
  elsif p_patch ? 'customerName' then
    v_customer_name := coalesce(
      nullif(trim(coalesce(p_patch->>'customerName', '')), ''), v_customer_name
    );
  end if;

  if p_patch ? 'discountAmount' then
    begin
      v_discount := (p_patch->>'discountAmount')::numeric;
    exception when others then
      raise exception using errcode = '22023', message = 'INVOICE_DISCOUNT_INVALID';
    end;
    if v_discount < 0 or v_discount = 'NaN'::numeric
       or v_discount > coalesce(v_invoice.subtotal, 0) then
      raise exception using errcode = '22023', message = 'INVOICE_DISCOUNT_INVALID';
    end if;
  end if;
  if p_patch ? 'paymentMethod' then
    v_method := p_patch->>'paymentMethod';
    if v_method not in ('cash', 'transfer', 'card', 'mixed') then
      raise exception using errcode = '22023', message = 'INVOICE_PAYMENT_METHOD_INVALID';
    end if;
  end if;
  if p_patch ? 'note' then
    v_note := nullif(trim(coalesce(p_patch->>'note', '')), '');
  end if;

  v_total := greatest(
    0,
    coalesce(v_invoice.subtotal, 0) - v_discount
      + coalesce(v_invoice.tax_amount, 0)
      + coalesce(v_invoice.delivery_fee, 0)
  );

  update public.invoices
     set customer_id = v_customer_id,
         customer_name = v_customer_name,
         discount_amount = v_discount,
         payment_method = v_method,
         note = v_note,
         total = v_total,
         debt = greatest(0, v_total - coalesce(paid, 0)),
         updated_at = now()
   where id = v_invoice.id and tenant_id = v_tenant_id;

  update public.shipping_orders
     set cod_amount = v_total, updated_at = now()
   where tenant_id = v_tenant_id
     and invoice_id = v_invoice.id
     and status not in ('cancelled', 'returned');

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_tenant_id, v_actor, 'invoice_draft_updated', 'invoice', v_invoice.id,
    jsonb_build_object(
      'customer_id', v_invoice.customer_id,
      'discount_amount', v_invoice.discount_amount,
      'payment_method', v_invoice.payment_method,
      'total', v_invoice.total, 'debt', v_invoice.debt
    ),
    jsonb_build_object(
      'customer_id', v_customer_id, 'discount_amount', v_discount,
      'payment_method', v_method, 'total', v_total,
      'debt', greatest(0, v_total - coalesce(v_invoice.paid, 0)),
      'atomic', true
    )
  );

  return jsonb_build_object(
    'invoice_id', v_invoice.id, 'code', v_invoice.code,
    'total', v_total, 'debt', greatest(0, v_total - coalesce(v_invoice.paid, 0))
  );
end;
$$;

revoke all on function public.cancel_draft_invoice_atomic(uuid, text)
  from public, anon;
revoke all on function public.update_draft_invoice_atomic(uuid, jsonb)
  from public, anon;
grant execute on function public.cancel_draft_invoice_atomic(uuid, text)
  to authenticated;
grant execute on function public.update_draft_invoice_atomic(uuid, jsonb)
  to authenticated;

select
  to_regprocedure('public.cancel_draft_invoice_atomic(uuid,text)') is not null as cancel_draft_invoice_ok,
  to_regprocedure('public.update_draft_invoice_atomic(uuid,jsonb)') is not null as update_draft_invoice_ok;
