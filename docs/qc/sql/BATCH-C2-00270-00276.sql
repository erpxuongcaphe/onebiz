-- ============================================================
-- ONEBIZ QC BATCH C2: migrations 00270 through 00276
-- Run once in Supabase SQL Editor.
-- Definition-only batch: does not update business records.
-- All-or-nothing: any error rolls back this entire batch.
-- ============================================================

begin;
-- ==================== 00270_atomic_legacy_sales_order_state.sql ====================
-- ============================================================
-- 00270: Atomic completion/cancellation for legacy sales_orders
-- ============================================================
-- Function definitions only. Existing orders, invoices, stock and cash are untouched.

create or replace function public.complete_legacy_sales_order_atomic(
  p_order_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_order record;
  v_items jsonb;
  v_prepared jsonb;
  v_result jsonb;
  v_total numeric;
  v_session text := p_order_id::text;
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
  if not public.user_has_permission(v_actor, 'orders.create')
     or not public.user_has_permission(v_actor, 'pos_retail.checkout') then
    raise exception using errcode = '42501', message = 'SALES_ORDER_COMPLETE_DENIED';
  end if;

  select so.* into v_order
    from public.sales_orders so
   where so.id = p_order_id and so.tenant_id = v_tenant_id
   for update;
  if not found then
    raise exception using errcode = '22023', message = 'SALES_ORDER_NOT_FOUND';
  end if;
  if not public.user_has_branch_access(v_actor, v_order.branch_id) then
    raise exception using errcode = '42501', message = 'SALES_ORDER_BRANCH_DENIED';
  end if;
  if v_order.status = 'completed' then
    select jsonb_build_object(
      'invoice_id', i.id, 'invoice_code', i.code, 'idempotent', true
    ) into v_result
    from public.invoices i
    where i.tenant_id = v_tenant_id
      and i.client_session_id::text = v_session
      and i.status = 'completed'
      and i.deleted_at is null
    order by i.created_at desc limit 1;
    if v_result is not null then return v_result; end if;
    raise exception using errcode = '22023', message = 'SALES_ORDER_COMPLETION_INCONSISTENT';
  end if;
  if v_order.status not in ('confirmed', 'delivering') then
    raise exception using errcode = '22023', message = 'SALES_ORDER_NOT_COMPLETABLE';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'productId', soi.product_id,
      'productName', soi.product_name,
      'unit', soi.unit,
      'quantity', soi.quantity,
      'unitPrice', soi.unit_price,
      'discount', coalesce(soi.discount, 0),
      'vatRate', 0
    ) order by soi.id
  ) into v_items
  from public.sales_order_items soi
  where soi.order_id = v_order.id;
  if v_items is null or jsonb_array_length(v_items) = 0 then
    raise exception using errcode = '22023', message = 'SALES_ORDER_HAS_NO_ITEMS';
  end if;

  v_prepared := public.pos_prepare_retail_checkout(
    v_tenant_id, v_actor, v_order.branch_id, v_order.customer_id, v_items,
    null, 0, null, null, 0, null, 0, 0
  );
  v_total := (v_prepared->>'total')::numeric;

  v_result := public.pos_complete_checkout_atomic_v3(
    p_branch_id => v_order.branch_id,
    p_customer_id => v_order.customer_id,
    p_items => v_items,
    p_payment_method => 'cash',
    p_payment_breakdown => null,
    p_paid => v_total,
    p_note => 'Tạo từ đơn bán ' || v_order.code,
    p_source => 'pos',
    p_shift_id => null,
    p_promotion_id => null,
    p_coupon_code => null,
    p_loyalty_points => 0,
    p_discount_source => null,
    p_order_discount => 0,
    p_discount_otp_id => null,
    p_discount_reason => null,
    p_shipping_fee => 0,
    p_order_vat_rate => 0,
    p_client_session_id => v_session,
    p_allow_bom_shortage => false,
    p_amount_tendered => v_total,
    p_customer_credit => 0
  );

  update public.sales_orders
     set status = 'completed', total = v_total, updated_at = now()
   where id = v_order.id and tenant_id = v_tenant_id;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_tenant_id, v_actor, 'legacy_sales_order_completed', 'sales_order', v_order.id,
    jsonb_build_object('status', v_order.status),
    jsonb_build_object(
      'status', 'completed', 'invoice_id', v_result->>'invoice_id',
      'invoice_code', v_result->>'invoice_code', 'total', v_total, 'atomic', true
    )
  );
  return v_result || jsonb_build_object('idempotent', false);
end;
$$;

create or replace function public.cancel_legacy_sales_order_atomic(
  p_order_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_order record;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
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
    raise exception using errcode = '42501', message = 'SALES_ORDER_CANCEL_DENIED';
  end if;
  if v_reason is null or length(v_reason) < 3 then
    raise exception using errcode = '22023', message = 'SALES_ORDER_CANCEL_REASON_REQUIRED';
  end if;

  select so.* into v_order
    from public.sales_orders so
   where so.id = p_order_id and so.tenant_id = v_tenant_id
   for update;
  if not found then
    raise exception using errcode = '22023', message = 'SALES_ORDER_NOT_FOUND';
  end if;
  if not public.user_has_branch_access(v_actor, v_order.branch_id) then
    raise exception using errcode = '42501', message = 'SALES_ORDER_BRANCH_DENIED';
  end if;
  if v_order.status = 'cancelled' then
    return jsonb_build_object('order_id', v_order.id, 'code', v_order.code, 'idempotent', true);
  end if;
  if v_order.status not in ('new', 'confirmed') then
    raise exception using errcode = '22023', message = 'SALES_ORDER_NOT_CANCELLABLE';
  end if;

  update public.sales_orders
     set status = 'cancelled', updated_at = now(),
         note = concat_ws(E'\n', nullif(note, ''), '[HỦY] ' || v_reason)
   where id = v_order.id and tenant_id = v_tenant_id;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_tenant_id, v_actor, 'legacy_sales_order_cancelled', 'sales_order', v_order.id,
    jsonb_build_object('status', v_order.status),
    jsonb_build_object('status', 'cancelled', 'reason', v_reason, 'atomic', true)
  );
  return jsonb_build_object('order_id', v_order.id, 'code', v_order.code, 'idempotent', false);
end;
$$;

revoke all on function public.complete_legacy_sales_order_atomic(uuid)
  from public, anon;
revoke all on function public.cancel_legacy_sales_order_atomic(uuid, text)
  from public, anon;
grant execute on function public.complete_legacy_sales_order_atomic(uuid)
  to authenticated;
grant execute on function public.cancel_legacy_sales_order_atomic(uuid, text)
  to authenticated;

select
  to_regprocedure('public.complete_legacy_sales_order_atomic(uuid)') is not null as complete_legacy_order_ok,
  to_regprocedure('public.cancel_legacy_sales_order_atomic(uuid,text)') is not null as cancel_legacy_order_ok;


-- ==================== 00271_atomic_draft_invoice_edit_cancel.sql ====================
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


-- ==================== 00272_atomic_received_purchase_order_update.sql ====================
-- ============================================================
-- 00272: Atomic update for a received purchase order
-- ============================================================
-- Definition only. Existing rows are not changed by this migration.

create or replace function public.update_received_purchase_order_atomic(
  p_purchase_order_id uuid,
  p_requested_paid numeric,
  p_note text,
  p_payment_method text default 'cash'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_order record;
  v_requested_paid numeric := coalesce(p_requested_paid, 0);
  v_payment_delta numeric;
  v_payment_result jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select p.tenant_id
    into v_tenant_id
    from public.profiles p
   where p.id = v_actor
     and coalesce(p.is_active, true);
  if v_tenant_id is null then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;

  if not public.user_has_permission(v_actor, 'inventory.create_po') then
    raise exception using errcode = '42501', message = 'INSUFFICIENT_PERMISSION';
  end if;

  select po.id, po.code, po.branch_id, po.status, po.total,
         coalesce(po.paid, 0) as paid, coalesce(po.note, '') as note
    into v_order
    from public.purchase_orders po
   where po.id = p_purchase_order_id
     and po.tenant_id = v_tenant_id
   for update;

  if not found then
    raise exception using errcode = '22023', message = 'PURCHASE_ORDER_NOT_FOUND';
  end if;
  if v_order.status not in ('partial', 'completed') then
    raise exception using errcode = '22023', message = 'PURCHASE_ORDER_NOT_RECEIVED';
  end if;
  if not public.user_has_branch_access(v_actor, v_order.branch_id) then
    raise exception using errcode = '42501', message = 'BRANCH_ACCESS_DENIED';
  end if;
  if v_requested_paid < v_order.paid then
    raise exception using errcode = '22023', message = 'PAID_AMOUNT_CANNOT_DECREASE';
  end if;
  if v_requested_paid > coalesce(v_order.total, 0) then
    raise exception using errcode = '22023', message = 'PAYMENT_EXCEEDS_TOTAL';
  end if;
  if length(coalesce(p_note, '')) > 2000 then
    raise exception using errcode = '22023', message = 'NOTE_TOO_LONG';
  end if;

  v_payment_delta := v_requested_paid - v_order.paid;
  if v_payment_delta > 0 then
    v_payment_result := public.record_purchase_payment(
      v_order.id,
      v_payment_delta,
      p_payment_method,
      'Thanh toan bo sung phieu nhap ' || v_order.code,
      v_order.branch_id,
      null
    );
  end if;

  update public.purchase_orders
     set note = nullif(trim(coalesce(p_note, '')), ''),
         updated_at = now()
   where id = v_order.id
     and tenant_id = v_tenant_id;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_tenant_id,
    v_actor,
    'purchase_order_received_update',
    'purchase_order',
    v_order.id,
    jsonb_build_object('paid', v_order.paid, 'note', nullif(v_order.note, '')),
    jsonb_build_object(
      'paid', v_requested_paid,
      'note', nullif(trim(coalesce(p_note, '')), ''),
      'payment_delta', v_payment_delta,
      'atomic', true
    )
  );

  return jsonb_build_object(
    'purchase_order_id', v_order.id,
    'code', v_order.code,
    'status', v_order.status,
    'paid', v_requested_paid,
    'debt', coalesce(v_order.total, 0) - v_requested_paid,
    'payment_result', v_payment_result
  );
end;
$$;

revoke all on function public.update_received_purchase_order_atomic(
  uuid, numeric, text, text
) from public, anon;

grant execute on function public.update_received_purchase_order_atomic(
  uuid, numeric, text, text
) to authenticated;

comment on function public.update_received_purchase_order_atomic(
  uuid, numeric, text, text
) is 'Atomically records any added supplier payment and updates a received purchase order note.';

select to_regprocedure(
  'public.update_received_purchase_order_atomic(uuid,numeric,text,text)'
) is not null as update_received_purchase_order_atomic_ok;


-- ==================== 00273_atomic_fnb_split_bill.sql ====================
-- ============================================================
-- 00273: Atomic F&B split bill
-- ============================================================
-- Definition only. Existing rows are not changed by this migration.

create or replace function public.split_kitchen_order_atomic(
  p_order_id uuid,
  p_mode text,
  p_item_ids uuid[] default null,
  p_number_of_ways integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_order record;
  v_total_items integer;
  v_selected_items integer;
  v_distinct_items integer;
  v_matching_items integer;
  v_ways integer;
  v_child_index integer;
  v_existing_children integer;
  v_child_id uuid;
  v_child_number text;
  v_move_ids uuid[];
  v_moved integer;
  v_parent_left integer;
  v_total_gross numeric;
  v_child_gross numeric;
  v_original_discount numeric;
  v_child_discount numeric;
  v_allocated_discount numeric := 0;
  v_parent_discount numeric;
  v_children jsonb := '[]'::jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select p.tenant_id
    into v_tenant_id
    from public.profiles p
   where p.id = v_actor
     and coalesce(p.is_active, true);
  if v_tenant_id is null then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if not public.user_has_permission(v_actor, 'pos_fnb.split_bill') then
    raise exception using errcode = '42501', message = 'SPLIT_BILL_PERMISSION_REQUIRED';
  end if;

  select ko.*
    into v_order
    from public.kitchen_orders ko
   where ko.id = p_order_id
     and ko.tenant_id = v_tenant_id
   for update;
  if not found then
    raise exception using errcode = '22023', message = 'KITCHEN_ORDER_NOT_FOUND';
  end if;
  if not public.user_has_branch_access(v_actor, v_order.branch_id) then
    raise exception using errcode = '42501', message = 'BRANCH_ACCESS_DENIED';
  end if;
  if v_order.invoice_id is not null or v_order.status in ('completed', 'cancelled') then
    raise exception using errcode = '22023', message = 'KITCHEN_ORDER_NOT_SPLITTABLE';
  end if;
  if v_order.order_type = 'delivery' then
    raise exception using errcode = '22023', message = 'DELIVERY_ORDER_CANNOT_SPLIT';
  end if;

  perform 1
    from public.kitchen_order_items koi
   where koi.kitchen_order_id = v_order.id
   order by koi.id
   for update;

  select count(*), coalesce(sum(koi.quantity * koi.unit_price), 0)
    into v_total_items, v_total_gross
    from public.kitchen_order_items koi
   where koi.kitchen_order_id = v_order.id;
  if v_total_items < 2 then
    raise exception using errcode = '22023', message = 'NOT_ENOUGH_ITEMS_TO_SPLIT';
  end if;

  v_original_discount := greatest(coalesce(v_order.discount_amount, 0), 0);
  if v_original_discount > v_total_gross then
    raise exception using errcode = '22023', message = 'ORDER_DISCOUNT_INVALID';
  end if;

  select count(*)
    into v_existing_children
    from public.kitchen_orders ko
   where ko.parent_order_id = v_order.id
     and ko.tenant_id = v_tenant_id;

  if p_mode = 'items' then
    v_selected_items := coalesce(cardinality(p_item_ids), 0);
    if v_selected_items = 0 or v_selected_items >= v_total_items then
      raise exception using errcode = '22023', message = 'SPLIT_ITEM_SELECTION_INVALID';
    end if;
    select count(distinct item_id)
      into v_distinct_items
      from unnest(p_item_ids) as selected(item_id);
    if v_distinct_items <> v_selected_items then
      raise exception using errcode = '22023', message = 'SPLIT_ITEM_DUPLICATE';
    end if;
    select count(*)
      into v_matching_items
      from public.kitchen_order_items koi
     where koi.kitchen_order_id = v_order.id
       and koi.id = any(p_item_ids);
    if v_matching_items <> v_selected_items then
      raise exception using errcode = '22023', message = 'SPLIT_ITEM_NOT_IN_ORDER';
    end if;
    v_ways := 2;
  elsif p_mode = 'equal' then
    v_ways := coalesce(p_number_of_ways, 0);
    if v_ways < 2 or v_ways > 10 or v_total_items < v_ways then
      raise exception using errcode = '22023', message = 'SPLIT_WAYS_INVALID';
    end if;
  else
    raise exception using errcode = '22023', message = 'SPLIT_MODE_INVALID';
  end if;

  for v_child_index in 1..(v_ways - 1) loop
    if p_mode = 'items' then
      v_move_ids := p_item_ids;
    else
      select array_agg(ranked.id order by ranked.row_no)
        into v_move_ids
        from (
          select koi.id, row_number() over (order by koi.id) as row_no
          from public.kitchen_order_items koi
          where koi.kitchen_order_id = v_order.id
        ) ranked
       where mod((ranked.row_no - 1)::integer, v_ways) = v_child_index;
    end if;

    if coalesce(cardinality(v_move_ids), 0) = 0 then
      raise exception using errcode = '22023', message = 'SPLIT_CHILD_EMPTY';
    end if;

    select coalesce(sum(koi.quantity * koi.unit_price), 0)
      into v_child_gross
      from public.kitchen_order_items koi
     where koi.kitchen_order_id = v_order.id
       and koi.id = any(v_move_ids);

    v_child_discount := case
      when v_original_discount > 0 and v_total_gross > 0
        then round(v_original_discount * v_child_gross / v_total_gross, 2)
      else 0
    end;
    v_allocated_discount := v_allocated_discount + v_child_discount;
    v_child_number := v_order.order_number || '-' ||
      case
        when v_existing_children + v_child_index + 1 <= 26
          then chr(64 + v_existing_children + v_child_index + 1)
        else 'P' || (v_existing_children + v_child_index + 1)::text
      end;

    insert into public.kitchen_orders (
      tenant_id, branch_id, table_id, order_number, order_type, status,
      note, created_by, parent_order_id, discount_amount, discount_reason
    ) values (
      v_order.tenant_id,
      v_order.branch_id,
      v_order.table_id,
      v_child_number,
      v_order.order_type,
      v_order.status,
      'Tach tu ' || v_order.order_number,
      v_actor,
      v_order.id,
      v_child_discount,
      case when v_child_discount > 0 then 'Phan bo khi tach bill' else null end
    )
    returning id into v_child_id;

    update public.kitchen_order_items
       set kitchen_order_id = v_child_id
     where kitchen_order_id = v_order.id
       and id = any(v_move_ids);
    get diagnostics v_moved = row_count;
    if v_moved <> cardinality(v_move_ids) then
      raise exception using errcode = '40001', message = 'SPLIT_CONCURRENT_CHANGE';
    end if;

    v_children := v_children || jsonb_build_array(jsonb_build_object(
      'order_id', v_child_id,
      'order_number', v_child_number,
      'item_count', v_moved,
      'discount_amount', v_child_discount
    ));
  end loop;

  select count(*)
    into v_parent_left
    from public.kitchen_order_items koi
   where koi.kitchen_order_id = v_order.id;
  if v_parent_left < 1 then
    raise exception using errcode = '40001', message = 'SPLIT_PARENT_EMPTY';
  end if;

  v_parent_discount := greatest(v_original_discount - v_allocated_discount, 0);
  update public.kitchen_orders
     set discount_amount = v_parent_discount,
         discount_reason = case
           when v_parent_discount > 0 then coalesce(v_order.discount_reason, 'Phan bo khi tach bill')
           else null
         end,
         updated_at = now()
   where id = v_order.id
     and tenant_id = v_tenant_id;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_tenant_id,
    v_actor,
    'fnb_split_bill',
    'kitchen_order',
    v_order.id,
    jsonb_build_object(
      'mode', p_mode,
      'number_of_ways', v_ways,
      'parent_items_left', v_parent_left,
      'parent_discount_amount', v_parent_discount,
      'children', v_children,
      'atomic', true
    )
  );

  return jsonb_build_object(
    'parent_order_id', v_order.id,
    'parent_items_left', v_parent_left,
    'parent_discount_amount', v_parent_discount,
    'children', v_children
  );
end;
$$;

revoke all on function public.split_kitchen_order_atomic(
  uuid, text, uuid[], integer
) from public, anon;

grant execute on function public.split_kitchen_order_atomic(
  uuid, text, uuid[], integer
) to authenticated;

comment on function public.split_kitchen_order_atomic(
  uuid, text, uuid[], integer
) is 'Atomically splits an unpaid F&B kitchen order and proportionally allocates its discount.';

select to_regprocedure(
  'public.split_kitchen_order_atomic(uuid,text,uuid[],integer)'
) is not null as split_kitchen_order_atomic_ok;


-- ==================== 00274_fnb_split_table_payment_guard.sql ====================
-- ============================================================
-- 00274: Keep an F&B table occupied while split bills remain unpaid
-- ============================================================
-- Definition only. Existing rows are not changed by this migration.

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
  v_next_order_id uuid;
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

  select ko.id, ko.tenant_id, ko.branch_id, ko.invoice_id, ko.status, ko.table_id
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

  -- The legacy payment helper releases the table immediately. For a split
  -- bill, keep it occupied while another unpaid part still exists.
  if v_order.table_id is not null then
    select ko.id
      into v_next_order_id
      from public.kitchen_orders ko
     where ko.tenant_id = v_tenant_id
       and ko.table_id = v_order.table_id
       and ko.id <> v_order.id
       and ko.invoice_id is null
       and ko.status not in ('completed', 'cancelled')
     order by ko.created_at, ko.id
     limit 1
     for update;

    if v_next_order_id is not null then
      update public.restaurant_tables
         set status = 'occupied',
             current_order_id = v_next_order_id,
             updated_at = now()
       where id = v_order.table_id
         and tenant_id = v_tenant_id;
    end if;
  end if;

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

revoke all on function public.fnb_complete_payment_atomic(
  uuid, uuid, text, text, jsonb, numeric, numeric, text, uuid, uuid, numeric
) from public, anon;

grant execute on function public.fnb_complete_payment_atomic(
  uuid, uuid, text, text, jsonb, numeric, numeric, text, uuid, uuid, numeric
) to authenticated;

comment on function public.fnb_complete_payment_atomic(
  uuid, uuid, text, text, jsonb, numeric, numeric, text, uuid, uuid, numeric
) is 'Completes F&B payment and keeps the table occupied when another split bill remains unpaid.';

select
  to_regprocedure(
    'public.fnb_complete_payment_atomic(uuid,uuid,text,text,jsonb,numeric,numeric,text,uuid,uuid,numeric)'
  ) is not null as fnb_payment_split_table_guard_ok;


-- ==================== 00275_guard_fnb_table_available.sql ====================
-- ============================================================
-- 00275: Guard the F&B cleaning-to-available table transition
-- ============================================================
-- Definition only. Existing rows are not changed by this migration.

create or replace function public.mark_fnb_table_available_atomic(
  p_table_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_table record;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select p.tenant_id
    into v_tenant_id
    from public.profiles p
   where p.id = v_actor
     and coalesce(p.is_active, true);
  if v_tenant_id is null then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if not public.user_has_permission(v_actor, 'pos_fnb.manage_tables') then
    raise exception using errcode = '42501', message = 'MANAGE_TABLES_PERMISSION_REQUIRED';
  end if;

  select rt.id, rt.branch_id, rt.status, rt.current_order_id
    into v_table
    from public.restaurant_tables rt
   where rt.id = p_table_id
     and rt.tenant_id = v_tenant_id
     and coalesce(rt.is_active, true)
   for update;
  if not found then
    raise exception using errcode = '22023', message = 'TABLE_NOT_FOUND';
  end if;
  if not public.user_has_branch_access(v_actor, v_table.branch_id) then
    raise exception using errcode = '42501', message = 'BRANCH_ACCESS_DENIED';
  end if;
  if v_table.status <> 'cleaning' then
    raise exception using errcode = '22023', message = 'TABLE_NOT_CLEANING';
  end if;
  if v_table.current_order_id is not null then
    raise exception using errcode = '22023', message = 'TABLE_STILL_HAS_ORDER';
  end if;

  update public.restaurant_tables
     set status = 'available',
         current_order_id = null,
         updated_at = now()
   where id = v_table.id
     and tenant_id = v_tenant_id;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_tenant_id,
    v_actor,
    'fnb_table_available',
    'restaurant_table',
    v_table.id,
    jsonb_build_object('status', v_table.status),
    jsonb_build_object('status', 'available', 'atomic', true)
  );

  return jsonb_build_object(
    'table_id', v_table.id,
    'status', 'available'
  );
end;
$$;

revoke all on function public.mark_fnb_table_available_atomic(uuid)
  from public, anon;
grant execute on function public.mark_fnb_table_available_atomic(uuid)
  to authenticated;

select to_regprocedure(
  'public.mark_fnb_table_available_atomic(uuid)'
) is not null as mark_fnb_table_available_atomic_ok;


-- ==================== 00276_atomic_shipping_status.sql ====================
-- ============================================================
-- 00276: Atomic shipping-order status transition
-- ============================================================
-- Definition only. Existing rows are not changed by this migration.

create or replace function public.update_shipping_order_status_atomic(
  p_shipping_order_id uuid,
  p_next_status text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_order record;
  v_updated record;
  v_required_permission text;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select p.tenant_id
    into v_tenant_id
    from public.profiles p
   where p.id = v_actor
     and coalesce(p.is_active, true);
  if v_tenant_id is null then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;

  select so.id, so.tenant_id, so.invoice_id, so.status, so.code, i.branch_id
    into v_order
    from public.shipping_orders so
    join public.invoices i
      on i.id = so.invoice_id
     and i.tenant_id = so.tenant_id
   where so.id = p_shipping_order_id
     and so.tenant_id = v_tenant_id
   for update of so;
  if not found then
    raise exception using errcode = '22023', message = 'SHIPPING_ORDER_NOT_FOUND';
  end if;
  if not public.user_has_branch_access(v_actor, v_order.branch_id) then
    raise exception using errcode = '42501', message = 'BRANCH_ACCESS_DENIED';
  end if;

  v_required_permission := case
    when p_next_status = 'cancelled' then 'orders.cancel'
    else 'orders.create'
  end;
  if not public.user_has_permission(v_actor, v_required_permission) then
    raise exception using errcode = '42501', message = 'SHIPPING_STATUS_PERMISSION_REQUIRED';
  end if;

  if not (
    (v_order.status = 'pending' and p_next_status in ('picked_up', 'cancelled'))
    or (v_order.status = 'picked_up' and p_next_status in ('in_transit', 'returned'))
    or (v_order.status = 'in_transit' and p_next_status in ('delivered', 'returned'))
  ) then
    raise exception using errcode = '22023', message = 'SHIPPING_STATUS_TRANSITION_INVALID';
  end if;
  if length(coalesce(p_note, '')) > 1000 then
    raise exception using errcode = '22023', message = 'SHIPPING_NOTE_TOO_LONG';
  end if;

  update public.shipping_orders so
     set status = p_next_status,
         updated_at = now()
   where so.id = v_order.id
     and so.tenant_id = v_tenant_id
     and so.status = v_order.status
  returning so.* into v_updated;
  if not found then
    raise exception using errcode = '40001', message = 'SHIPPING_STATUS_CONCURRENT_CHANGE';
  end if;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_tenant_id,
    v_actor,
    'update_status',
    'shipping_order',
    v_order.id,
    jsonb_build_object('status', v_order.status),
    jsonb_build_object(
      'status', p_next_status,
      'note', nullif(trim(coalesce(p_note, '')), ''),
      'branch_id', v_order.branch_id,
      'atomic', true
    )
  );

  return to_jsonb(v_updated) || jsonb_build_object(
    'invoices', jsonb_build_object(
      'code', (select i.code from public.invoices i where i.id = v_order.invoice_id)
    ),
    'delivery_partners', case
      when v_updated.partner_id is null then null
      else jsonb_build_object(
        'name', (select dp.name from public.delivery_partners dp where dp.id = v_updated.partner_id)
      )
    end
  );
end;
$$;

revoke all on function public.update_shipping_order_status_atomic(uuid, text, text)
  from public, anon;
grant execute on function public.update_shipping_order_status_atomic(uuid, text, text)
  to authenticated;

select to_regprocedure(
  'public.update_shipping_order_status_atomic(uuid,text,text)'
) is not null as update_shipping_order_status_atomic_ok;


commit;

-- Read-only verification for this batch.
with expected(function_name) as (
  values
    ('complete_legacy_sales_order_atomic'),
    ('cancel_legacy_sales_order_atomic'),
    ('cancel_draft_invoice_atomic'),
    ('update_draft_invoice_atomic'),
    ('update_received_purchase_order_atomic'),
    ('split_kitchen_order_atomic'),
    ('fnb_complete_payment_atomic'),
    ('mark_fnb_table_available_atomic'),
    ('update_shipping_order_status_atomic')
), checked as (
  select
    e.function_name,
    exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = e.function_name
    ) as installed
  from expected e
)
select
  count(*) filter (where installed) as installed_count,
  count(*) filter (where not installed) as missing_count,
  coalesce(
    jsonb_agg(function_name order by function_name) filter (where not installed),
    '[]'::jsonb
  ) as missing_functions
from checked;