-- ============================================================
-- ONEBIZ QC BATCH C1: migrations 00261 through 00269
-- Run once in Supabase SQL Editor.
-- Definition-only batch: does not update business records.
-- All-or-nothing: any error rolls back this entire batch.
-- ============================================================

begin;
-- ==================== 00261_atomic_purchase_order_save.sql ====================
-- ============================================================
-- 00261: Atomic purchase-order save and optional immediate receipt
-- ============================================================
-- Function definition only. Applying this migration does not modify existing
-- purchase orders. New saves run as one database transaction.

create or replace function public.save_purchase_order_atomic(
  p_purchase_order_id uuid,
  p_requested_code text,
  p_branch_id uuid,
  p_supplier_id uuid,
  p_note text,
  p_shipping_cost numeric,
  p_other_cost numeric,
  p_order_discount numeric,
  p_paid_amount numeric,
  p_payment_method text,
  p_mark_ordered boolean,
  p_receive_now boolean,
  p_items jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_branch_id uuid;
  v_order_id uuid;
  v_code text;
  v_existing record;
  v_supplier record;
  v_product record;
  v_item jsonb;
  v_product_id uuid;
  v_quantity numeric;
  v_unit_price numeric;
  v_discount numeric;
  v_vat_rate numeric;
  v_line_before_discount numeric;
  v_line_subtotal numeric;
  v_vat_amount numeric;
  v_subtotal numeric := 0;
  v_discount_total numeric := 0;
  v_tax_total numeric := 0;
  v_shipping_cost numeric := coalesce(p_shipping_cost, 0);
  v_other_cost numeric := coalesce(p_other_cost, 0);
  v_order_discount numeric := coalesce(p_order_discount, 0);
  v_total numeric;
  v_requested_paid numeric := case when coalesce(p_receive_now, false)
    then coalesce(p_paid_amount, 0) else 0 end;
  v_expiry_date date;
  v_lot_number text;
  v_receive_result jsonb;
  v_payment_result jsonb;
  v_final_status text := 'draft';
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

  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0
     or jsonb_array_length(p_items) > 5000 then
    raise exception using errcode = '22023', message = 'PURCHASE_ORDER_ITEMS_INVALID';
  end if;

  if v_shipping_cost < 0
     or v_other_cost < 0
     or v_order_discount < 0
     or v_requested_paid < 0 then
    raise exception using errcode = '22023', message = 'PURCHASE_ORDER_AMOUNT_INVALID';
  end if;

  select s.id, s.name
    into v_supplier
    from public.suppliers s
   where s.id = p_supplier_id
     and s.tenant_id = v_tenant_id
     and coalesce(s.is_active, true);
  if not found then
    raise exception using errcode = '22023', message = 'SUPPLIER_NOT_FOUND';
  end if;

  if p_purchase_order_id is null then
    v_branch_id := p_branch_id;
    if not exists (
      select 1
      from public.branches b
      where b.id = v_branch_id
        and b.tenant_id = v_tenant_id
        and coalesce(b.is_active, true)
    ) then
      raise exception using errcode = '22023', message = 'BRANCH_NOT_FOUND';
    end if;
    if not public.user_has_branch_access(v_actor, v_branch_id) then
      raise exception using errcode = '42501', message = 'BRANCH_ACCESS_DENIED';
    end if;
    v_code := nullif(trim(coalesce(p_requested_code, '')), '');
    if v_code is null then
      v_code := public.next_code(v_tenant_id, 'purchase_order');
    elsif length(v_code) > 50 then
      raise exception using errcode = '22023', message = 'PURCHASE_ORDER_CODE_INVALID';
    end if;
  else
    select po.id, po.code, po.branch_id, po.status
      into v_existing
      from public.purchase_orders po
     where po.id = p_purchase_order_id
       and po.tenant_id = v_tenant_id
     for update;
    if not found then
      raise exception using errcode = '22023', message = 'PURCHASE_ORDER_NOT_FOUND';
    end if;
    if v_existing.status <> 'draft' then
      raise exception using errcode = '22023', message = 'PURCHASE_ORDER_NOT_EDITABLE';
    end if;
    v_branch_id := v_existing.branch_id;
    v_code := v_existing.code;
    if nullif(trim(coalesce(p_requested_code, '')), '') is not null
       and trim(p_requested_code) <> v_code then
      raise exception using errcode = '22023', message = 'PURCHASE_ORDER_CODE_IMMUTABLE';
    end if;
    if p_branch_id is not null and p_branch_id <> v_branch_id then
      raise exception using errcode = '42501', message = 'PURCHASE_ORDER_BRANCH_SPOOF_BLOCKED';
    end if;
    if not public.user_has_branch_access(v_actor, v_branch_id) then
      raise exception using errcode = '42501', message = 'BRANCH_ACCESS_DENIED';
    end if;
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_product_id := nullif(v_item->>'product_id', '')::uuid;
      v_quantity := nullif(v_item->>'quantity', '')::numeric;
      v_unit_price := nullif(v_item->>'unit_price', '')::numeric;
      v_discount := coalesce(nullif(v_item->>'discount', '')::numeric, 0);
      v_vat_rate := coalesce(nullif(v_item->>'vat_rate', '')::numeric, 0);
    exception when others then
      raise exception using errcode = '22023', message = 'PURCHASE_ORDER_ITEM_INVALID';
    end;

    if v_product_id is null
       or v_quantity is null or v_quantity <= 0 or v_quantity = 'NaN'::numeric
       or v_unit_price is null or v_unit_price < 0 or v_unit_price = 'NaN'::numeric
       or v_discount < 0 or v_discount = 'NaN'::numeric
       or v_vat_rate < 0 or v_vat_rate > 100 or v_vat_rate = 'NaN'::numeric then
      raise exception using errcode = '22023', message = 'PURCHASE_ORDER_ITEM_INVALID';
    end if;

    v_line_before_discount := round(v_quantity * v_unit_price, 2);
    if v_discount > v_line_before_discount then
      raise exception using errcode = '22023', message = 'LINE_DISCOUNT_EXCEEDS_VALUE';
    end if;
    v_line_subtotal := v_line_before_discount - v_discount;
    v_vat_amount := round(v_line_subtotal * v_vat_rate / 100);

    v_subtotal := v_subtotal + v_line_subtotal;
    v_discount_total := v_discount_total + v_discount;
    v_tax_total := v_tax_total + v_vat_amount;
  end loop;

  if v_order_discount > v_subtotal + v_tax_total + v_shipping_cost + v_other_cost then
    raise exception using errcode = '22023', message = 'ORDER_DISCOUNT_EXCEEDS_VALUE';
  end if;

  v_total := greatest(
    0,
    v_subtotal + v_tax_total + v_shipping_cost + v_other_cost - v_order_discount
  );
  if v_requested_paid > v_total then
    raise exception using errcode = '22023', message = 'PAID_AMOUNT_EXCEEDS_TOTAL';
  end if;
  if v_requested_paid > 0
     and p_payment_method not in ('cash', 'transfer', 'card', 'ewallet') then
    raise exception using errcode = '22023', message = 'PAYMENT_METHOD_INVALID';
  end if;

  if p_purchase_order_id is null then
    insert into public.purchase_orders (
      tenant_id, branch_id, code, supplier_id, supplier_name, status,
      subtotal, discount_amount, tax_amount, shipping_cost, other_cost,
      order_discount, total, paid, debt, note, created_by
    ) values (
      v_tenant_id, v_branch_id, v_code, v_supplier.id, v_supplier.name, 'draft',
      v_subtotal, v_discount_total, v_tax_total, v_shipping_cost, v_other_cost,
      v_order_discount, v_total, 0, v_total,
      nullif(trim(coalesce(p_note, '')), ''), v_actor
    )
    returning id into v_order_id;
  else
    v_order_id := p_purchase_order_id;
    update public.purchase_orders
       set supplier_id = v_supplier.id,
           supplier_name = v_supplier.name,
           subtotal = v_subtotal,
           discount_amount = v_discount_total,
           tax_amount = v_tax_total,
           shipping_cost = v_shipping_cost,
           other_cost = v_other_cost,
           order_discount = v_order_discount,
           total = v_total,
           paid = 0,
           debt = v_total,
           note = nullif(trim(coalesce(p_note, '')), ''),
           updated_at = now()
     where id = v_order_id
       and tenant_id = v_tenant_id;

    delete from public.purchase_order_items poi
     where poi.purchase_order_id = v_order_id;
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := nullif(v_item->>'product_id', '')::uuid;
    v_quantity := nullif(v_item->>'quantity', '')::numeric;
    v_unit_price := nullif(v_item->>'unit_price', '')::numeric;
    v_discount := coalesce(nullif(v_item->>'discount', '')::numeric, 0);
    v_vat_rate := coalesce(nullif(v_item->>'vat_rate', '')::numeric, 0);
    v_line_subtotal := round(v_quantity * v_unit_price, 2) - v_discount;
    v_vat_amount := round(v_line_subtotal * v_vat_rate / 100);

    begin
      v_expiry_date := nullif(v_item->>'expiry_date', '')::date;
    exception when others then
      raise exception using errcode = '22023', message = 'EXPIRY_DATE_INVALID';
    end;
    v_lot_number := nullif(trim(coalesce(v_item->>'lot_number', '')), '');

    select p.id, p.name, p.code, p.unit, p.inventory_role
      into v_product
      from public.products p
     where p.id = v_product_id
       and p.tenant_id = v_tenant_id
       and coalesce(p.is_active, true);
    if not found then
      raise exception using errcode = '22023', message = 'PRODUCT_NOT_FOUND';
    end if;
    if v_product.inventory_role = 'fnb_menu_item' then
      raise exception using errcode = '22023', message = 'MENU_NO_DIRECT_STOCK';
    end if;

    insert into public.purchase_order_items (
      purchase_order_id, product_id, product_name, unit, quantity,
      received_quantity, unit_price, discount, vat_rate, vat_amount,
      total, expiry_date, lot_number
    ) values (
      v_order_id, v_product.id, v_product.name, coalesce(v_product.unit, 'Cái'),
      v_quantity, 0, v_unit_price, v_discount, v_vat_rate, v_vat_amount,
      v_line_subtotal, v_expiry_date, v_lot_number
    );
  end loop;

  if coalesce(p_receive_now, false) then
    update public.purchase_orders
       set status = 'ordered', updated_at = now()
     where id = v_order_id and tenant_id = v_tenant_id;

    v_receive_result := public.receive_purchase_items_atomic(
      v_order_id, null, v_actor
    );
    v_final_status := coalesce(v_receive_result->>'new_status', 'completed');

    if v_requested_paid > 0 then
      v_payment_result := public.record_purchase_payment(
        v_order_id,
        v_requested_paid,
        p_payment_method,
        'Thanh toán khi nhập hàng - phiếu ' || v_code,
        v_branch_id,
        null
      );
    end if;
  elsif coalesce(p_mark_ordered, false) then
    update public.purchase_orders
       set status = 'ordered', updated_at = now()
     where id = v_order_id and tenant_id = v_tenant_id;
    v_final_status := 'ordered';
  end if;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_tenant_id,
    v_actor,
    case when coalesce(p_receive_now, false)
      then 'purchase_order_save_and_receive'
      else 'purchase_order_save_draft'
    end,
    'purchase_order',
    v_order_id,
    jsonb_build_object(
      'code', v_code,
      'branch_id', v_branch_id,
      'supplier_id', v_supplier.id,
      'item_count', jsonb_array_length(p_items),
      'subtotal', v_subtotal,
      'tax_amount', v_tax_total,
      'shipping_cost', v_shipping_cost,
      'other_cost', v_other_cost,
      'order_discount', v_order_discount,
      'total', v_total,
      'paid', v_requested_paid,
      'status', v_final_status,
      'atomic', true
    )
  );

  return jsonb_build_object(
    'purchase_order_id', v_order_id,
    'code', v_code,
    'status', v_final_status,
    'total', v_total,
    'paid', v_requested_paid,
    'debt', v_total - v_requested_paid,
    'receive_result', v_receive_result,
    'payment_result', v_payment_result
  );
end;
$$;

revoke all on function public.save_purchase_order_atomic(
  uuid, text, uuid, uuid, text, numeric, numeric, numeric, numeric, text, boolean, boolean, jsonb
) from public, anon;

grant execute on function public.save_purchase_order_atomic(
  uuid, text, uuid, uuid, text, numeric, numeric, numeric, numeric, text, boolean, boolean, jsonb
) to authenticated;

comment on function public.save_purchase_order_atomic(
  uuid, text, uuid, uuid, text, numeric, numeric, numeric, numeric, text, boolean, boolean, jsonb
) is 'Atomically saves a PO and optionally receives stock and records supplier payment.';

select to_regprocedure(
  'public.save_purchase_order_atomic(uuid,text,uuid,uuid,text,numeric,numeric,numeric,numeric,text,boolean,boolean,jsonb)'
) is not null as save_purchase_order_atomic_ok;


-- ==================== 00262_atomic_purchase_order_state.sql ====================
-- ============================================================
-- 00262: Atomic purchase-order state changes
-- ============================================================
-- Function definition only. It does not modify existing rows when applied.

create or replace function public.set_purchase_order_state_atomic(
  p_purchase_order_id uuid,
  p_new_status text,
  p_reason text default null
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
  if p_new_status not in ('ordered', 'cancelled') then
    raise exception using errcode = '22023', message = 'PURCHASE_ORDER_STATUS_INVALID';
  end if;

  select po.id, po.code, po.branch_id, po.status, po.note
    into v_order
    from public.purchase_orders po
   where po.id = p_purchase_order_id
     and po.tenant_id = v_tenant_id
   for update;
  if not found then
    raise exception using errcode = '22023', message = 'PURCHASE_ORDER_NOT_FOUND';
  end if;

  if not public.user_has_branch_access(v_actor, v_order.branch_id) then
    raise exception using errcode = '42501', message = 'BRANCH_ACCESS_DENIED';
  end if;

  if v_order.status = p_new_status then
    return jsonb_build_object(
      'purchase_order_id', v_order.id,
      'code', v_order.code,
      'status', v_order.status,
      'idempotent', true
    );
  end if;

  if p_new_status = 'ordered' and v_order.status <> 'draft' then
    raise exception using errcode = '22023', message = 'PURCHASE_ORDER_TRANSITION_INVALID';
  end if;
  if p_new_status = 'cancelled' and v_order.status not in ('draft', 'ordered') then
    raise exception using errcode = '22023', message = 'PURCHASE_ORDER_TRANSITION_INVALID';
  end if;

  update public.purchase_orders
     set status = p_new_status,
         note = case
           when p_new_status = 'cancelled'
             then coalesce(v_reason, 'Hủy phiếu nhập')
           else note
         end,
         updated_at = now()
   where id = v_order.id
     and tenant_id = v_tenant_id;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_tenant_id,
    v_actor,
    case when p_new_status = 'cancelled'
      then 'purchase_order_cancel'
      else 'purchase_order_status_change'
    end,
    'purchase_order',
    v_order.id,
    jsonb_build_object('status', v_order.status, 'note', v_order.note),
    jsonb_build_object(
      'status', p_new_status,
      'reason', v_reason,
      'atomic', true
    )
  );

  return jsonb_build_object(
    'purchase_order_id', v_order.id,
    'code', v_order.code,
    'status', p_new_status,
    'idempotent', false
  );
end;
$$;

revoke all on function public.set_purchase_order_state_atomic(
  uuid, text, text
) from public, anon;

grant execute on function public.set_purchase_order_state_atomic(
  uuid, text, text
) to authenticated;

comment on function public.set_purchase_order_state_atomic(
  uuid, text, text
) is 'Atomically orders or cancels an unreceived purchase order with audit.';

-- Harden closing the unreceived remainder of a partially received order.
-- The legacy actor argument is retained for API compatibility but cannot spoof auth.uid().
create or replace function public.close_purchase_order_short(
  p_order_id uuid,
  p_reason text,
  p_actor_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_order record;
  v_reason text := trim(coalesce(p_reason, ''));
  v_received_count integer := 0;
  v_remaining_count integer := 0;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if p_actor_id is not null and p_actor_id <> v_actor then
    raise exception using errcode = '42501', message = 'ACTOR_SPOOF_BLOCKED';
  end if;
  if length(v_reason) < 5 then
    raise exception using errcode = '22023', message = 'INVALID_REASON';
  end if;

  select p.tenant_id into v_tenant_id
    from public.profiles p
   where p.id = v_actor
     and coalesce(p.is_active, true);
  if v_tenant_id is null then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if not public.user_has_permission(v_actor, 'inventory.create_po') then
    raise exception using errcode = '42501', message = 'INSUFFICIENT_PERMISSION';
  end if;

  select po.id, po.code, po.tenant_id, po.branch_id, po.status, po.note
    into v_order
    from public.purchase_orders po
   where po.id = p_order_id
     and po.tenant_id = v_tenant_id
   for update;
  if not found then
    raise exception using errcode = '22023', message = 'PURCHASE_ORDER_NOT_FOUND';
  end if;
  if not public.user_has_branch_access(v_actor, v_order.branch_id) then
    raise exception using errcode = '42501', message = 'BRANCH_ACCESS_DENIED';
  end if;
  if v_order.status not in ('ordered', 'partial') then
    raise exception using errcode = '22023', message = 'PURCHASE_ORDER_TRANSITION_INVALID';
  end if;

  select
    count(*) filter (where coalesce(poi.received_quantity, 0) >= poi.quantity),
    count(*) filter (where coalesce(poi.received_quantity, 0) < poi.quantity)
    into v_received_count, v_remaining_count
    from public.purchase_order_items poi
   where poi.purchase_order_id = p_order_id;

  update public.purchase_orders
     set status = 'completed',
         closed_short = true,
         close_reason = v_reason,
         closed_at = now(),
         closed_by = v_actor,
         updated_at = now()
   where id = p_order_id
     and tenant_id = v_tenant_id;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_tenant_id, v_actor, 'close_short', 'purchase_order', p_order_id,
    jsonb_build_object('status', v_order.status, 'note', v_order.note),
    jsonb_build_object(
      'status', 'completed',
      'closed_short', true,
      'reason', v_reason,
      'items_received_fully', v_received_count,
      'items_remaining', v_remaining_count,
      'atomic', true
    )
  );

  return jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'code', v_order.code,
    'items_received_fully', v_received_count,
    'items_remaining', v_remaining_count
  );
end;
$$;

revoke all on function public.close_purchase_order_short(
  uuid, text, uuid
) from public, anon;
grant execute on function public.close_purchase_order_short(
  uuid, text, uuid
) to authenticated;

comment on function public.close_purchase_order_short(
  uuid, text, uuid
) is 'Closes only the unreceived remainder of a purchase order with auth, branch and audit guards.';

select to_regprocedure(
  'public.set_purchase_order_state_atomic(uuid,text,text)'
) is not null as purchase_order_state_atomic_ok;

select to_regprocedure(
  'public.close_purchase_order_short(uuid,text,uuid)'
) is not null as close_purchase_order_short_ok;


-- ==================== 00263_atomic_inventory_check_cancel.sql ====================
-- ============================================================
-- 00263: Atomic inventory-check cancellation
-- ============================================================
-- Function definition only. Applying it does not change existing checks or stock.

create or replace function public.cancel_inventory_check_atomic(
  p_check_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_check record;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select p.tenant_id into v_tenant_id
    from public.profiles p
   where p.id = v_actor
     and coalesce(p.is_active, true);
  if v_tenant_id is null then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if not public.user_has_permission(v_actor, 'inventory.check') then
    raise exception using errcode = '42501', message = 'INSUFFICIENT_PERMISSION';
  end if;

  select ic.id, ic.code, ic.branch_id, ic.status
    into v_check
    from public.inventory_checks ic
   where ic.id = p_check_id
     and ic.tenant_id = v_tenant_id
   for update;
  if not found then
    raise exception using errcode = '22023', message = 'INVENTORY_CHECK_NOT_FOUND';
  end if;
  if not public.user_has_branch_access(v_actor, v_check.branch_id) then
    raise exception using errcode = '42501', message = 'BRANCH_ACCESS_DENIED';
  end if;
  if v_check.status = 'cancelled' then
    return jsonb_build_object(
      'check_id', v_check.id, 'code', v_check.code,
      'status', 'cancelled', 'idempotent', true
    );
  end if;
  if v_check.status not in ('draft', 'in_progress') then
    raise exception using errcode = '22023', message = 'INVENTORY_CHECK_ALREADY_APPLIED';
  end if;

  update public.inventory_checks
     set status = 'cancelled', updated_at = now()
   where id = v_check.id
     and tenant_id = v_tenant_id;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_tenant_id, v_actor, 'cancel', 'inventory_check', v_check.id,
    jsonb_build_object('code', v_check.code, 'status', v_check.status),
    jsonb_build_object('status', 'cancelled', 'atomic', true)
  );

  return jsonb_build_object(
    'check_id', v_check.id, 'code', v_check.code,
    'status', 'cancelled', 'idempotent', false
  );
end;
$$;

revoke all on function public.cancel_inventory_check_atomic(uuid)
  from public, anon;
grant execute on function public.cancel_inventory_check_atomic(uuid)
  to authenticated;

comment on function public.cancel_inventory_check_atomic(uuid) is
  'Cancels only unapplied inventory checks with tenant, branch, permission and audit guards.';

select to_regprocedure(
  'public.cancel_inventory_check_atomic(uuid)'
) is not null as cancel_inventory_check_atomic_ok;


-- ==================== 00264_atomic_pos_draft_save.sql ====================
-- ============================================================
-- 00264: Atomic retail POS draft save
-- ============================================================
-- Function definition only. Existing invoices, stock, debt and cash are untouched.

create or replace function public.save_pos_draft_atomic(
  p_branch_id uuid,
  p_customer_id uuid,
  p_items jsonb,
  p_payment_method text,
  p_subtotal numeric,
  p_discount_amount numeric,
  p_total numeric,
  p_shipping_fee numeric,
  p_note text,
  p_client_session_id text,
  p_auto_saved boolean
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_session_id uuid;
  v_invoice record;
  v_has_existing boolean := false;
  v_invoice_id uuid;
  v_invoice_code text;
  v_customer_name text := 'Khách lẻ';
  v_item jsonb;
  v_product record;
  v_product_id uuid;
  v_variant_id uuid;
  v_quantity numeric;
  v_unit_price numeric;
  v_discount numeric;
  v_vat_rate numeric;
  v_line_total numeric;
  v_auto_saved boolean := coalesce(p_auto_saved, false);
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  select p.tenant_id into v_tenant_id
    from public.profiles p
   where p.id = v_actor
     and coalesce(p.is_active, true);
  if v_tenant_id is null then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if not public.user_has_permission(v_actor, 'pos_retail.save_draft') then
    raise exception using errcode = '42501', message = 'POS_SAVE_DRAFT_DENIED';
  end if;
  if not exists (
    select 1 from public.branches b
    where b.id = p_branch_id
      and b.tenant_id = v_tenant_id
      and coalesce(b.is_active, true)
  ) or not public.user_has_branch_access(v_actor, p_branch_id) then
    raise exception using errcode = '42501', message = 'POS_BRANCH_DENIED';
  end if;
  if p_payment_method not in ('cash', 'transfer', 'card', 'mixed') then
    raise exception using errcode = '22023', message = 'POS_PAYMENT_METHOD_INVALID';
  end if;
  if p_subtotal is null or p_subtotal < 0 or p_subtotal = 'NaN'::numeric
     or p_discount_amount is null or p_discount_amount < 0 or p_discount_amount = 'NaN'::numeric
     or p_total is null or p_total < 0 or p_total = 'NaN'::numeric
     or coalesce(p_shipping_fee, 0) < 0 or coalesce(p_shipping_fee, 0) = 'NaN'::numeric then
    raise exception using errcode = '22023', message = 'POS_DRAFT_TOTAL_INVALID';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0
     or jsonb_array_length(p_items) > 500 then
    raise exception using errcode = '22023', message = 'POS_DRAFT_ITEMS_INVALID';
  end if;

  if nullif(trim(coalesce(p_client_session_id, '')), '') is not null then
    begin
      v_session_id := trim(p_client_session_id)::uuid;
    exception when others then
      raise exception using errcode = '22023', message = 'POS_SESSION_INVALID';
    end;
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_tenant_id::text || ':' || v_session_id::text, 264)
    );
  end if;

  if p_customer_id is not null then
    select c.name into v_customer_name
      from public.customers c
     where c.id = p_customer_id
       and c.tenant_id = v_tenant_id
       and coalesce(c.is_active, true);
    if not found then
      raise exception using errcode = '22023', message = 'POS_CUSTOMER_INVALID';
    end if;
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_product_id := nullif(v_item->>'productId', '')::uuid;
      v_variant_id := nullif(v_item->>'variantId', '')::uuid;
      v_quantity := nullif(v_item->>'quantity', '')::numeric;
      v_unit_price := nullif(v_item->>'unitPrice', '')::numeric;
      v_discount := coalesce(nullif(v_item->>'discount', '')::numeric, 0);
      v_vat_rate := coalesce(nullif(v_item->>'vatRate', '')::numeric, 0);
    exception when others then
      raise exception using errcode = '22023', message = 'POS_DRAFT_ITEM_INVALID';
    end;
    if v_product_id is null
       or v_quantity is null or v_quantity <= 0 or v_quantity = 'NaN'::numeric
       or v_unit_price is null or v_unit_price < 0 or v_unit_price = 'NaN'::numeric
       or v_discount < 0 or v_discount = 'NaN'::numeric
       or v_vat_rate < 0 or v_vat_rate > 100 or v_vat_rate = 'NaN'::numeric
       or v_discount > v_quantity * v_unit_price then
      raise exception using errcode = '22023', message = 'POS_DRAFT_ITEM_INVALID';
    end if;
    select p.id, p.name, p.unit into v_product
      from public.products p
     where p.id = v_product_id
       and p.tenant_id = v_tenant_id
       and coalesce(p.is_active, true);
    if not found then
      raise exception using errcode = '22023', message = 'POS_PRODUCT_INVALID';
    end if;
    if v_variant_id is not null and not exists (
      select 1 from public.product_variants pv
      where pv.id = v_variant_id
        and pv.tenant_id = v_tenant_id
        and pv.product_id = v_product_id
        and coalesce(pv.is_active, true)
    ) then
      raise exception using errcode = '22023', message = 'POS_VARIANT_INVALID';
    end if;
  end loop;

  if v_session_id is not null then
    select i.id, i.code, i.status, i.source, i.branch_id
      into v_invoice
      from public.invoices i
     where i.tenant_id = v_tenant_id
       and i.client_session_id = v_session_id
       and i.deleted_at is null
     order by i.created_at desc
     limit 1
     for update;
    v_has_existing := found;
    if v_has_existing and v_invoice.status <> 'draft' then
      return jsonb_build_object(
        'invoice_id', v_invoice.id, 'invoice_code', v_invoice.code,
        'status', v_invoice.status, 'idempotent', true
      );
    end if;
    if v_has_existing and v_invoice.branch_id <> p_branch_id then
      raise exception using errcode = '42501', message = 'POS_DRAFT_BRANCH_MISMATCH';
    end if;
  end if;

  if not v_has_existing then
    v_invoice_code := public.next_code(v_tenant_id, 'pos_draft');
    insert into public.invoices (
      tenant_id, branch_id, code, customer_id, customer_name, status,
      subtotal, discount_amount, tax_amount, delivery_fee, total, paid, debt,
      payment_method, note, source, created_by, client_session_id, auto_saved
    ) values (
      v_tenant_id, p_branch_id, v_invoice_code, p_customer_id, v_customer_name, 'draft',
      p_subtotal, p_discount_amount,
      greatest(0, p_total - p_subtotal + p_discount_amount - coalesce(p_shipping_fee, 0)),
      coalesce(p_shipping_fee, 0), p_total, 0, p_total,
      p_payment_method, nullif(trim(coalesce(p_note, '')), ''), 'pos',
      v_actor, v_session_id, v_auto_saved
    ) returning id, code into v_invoice_id, v_invoice_code;
  else
    v_invoice_id := v_invoice.id;
    v_invoice_code := v_invoice.code;
    update public.invoices
       set customer_id = p_customer_id,
           customer_name = v_customer_name,
           subtotal = p_subtotal,
           discount_amount = p_discount_amount,
           tax_amount = greatest(0, p_total - p_subtotal + p_discount_amount - coalesce(p_shipping_fee, 0)),
           delivery_fee = coalesce(p_shipping_fee, 0),
           total = p_total,
           paid = 0,
           debt = p_total,
           payment_method = p_payment_method,
           note = nullif(trim(coalesce(p_note, '')), ''),
           auto_saved = case when v_invoice.source = 'order' then auto_saved else v_auto_saved end,
           updated_at = now()
     where id = v_invoice_id
       and tenant_id = v_tenant_id
       and status = 'draft'
       and deleted_at is null;
    delete from public.invoice_items ii where ii.invoice_id = v_invoice_id;
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := nullif(v_item->>'productId', '')::uuid;
    v_variant_id := nullif(v_item->>'variantId', '')::uuid;
    v_quantity := (v_item->>'quantity')::numeric;
    v_unit_price := (v_item->>'unitPrice')::numeric;
    v_discount := coalesce(nullif(v_item->>'discount', '')::numeric, 0);
    v_vat_rate := coalesce(nullif(v_item->>'vatRate', '')::numeric, 0);
    select p.id, p.name, p.unit into v_product
      from public.products p
     where p.id = v_product_id and p.tenant_id = v_tenant_id;
    v_line_total := round(v_quantity * v_unit_price - v_discount, 2);

    insert into public.invoice_items (
      invoice_id, product_id, variant_id, product_name, unit, quantity,
      unit_price, discount, vat_rate, vat_amount, total, note
    ) values (
      v_invoice_id, v_product_id, v_variant_id,
      coalesce(nullif(trim(coalesce(v_item->>'productName', '')), ''), v_product.name),
      coalesce(nullif(trim(coalesce(v_item->>'unit', '')), ''), v_product.unit, 'Cái'),
      v_quantity, v_unit_price, v_discount, v_vat_rate,
      round(v_line_total * v_vat_rate / 100), v_line_total,
      nullif(trim(coalesce(v_item->>'note', '')), '')
    );
  end loop;

  return jsonb_build_object(
    'invoice_id', v_invoice_id, 'invoice_code', v_invoice_code,
    'status', 'draft', 'idempotent', false
  );
end;
$$;

revoke all on function public.save_pos_draft_atomic(
  uuid, uuid, jsonb, text, numeric, numeric, numeric, numeric, text, text, boolean
) from public, anon;
grant execute on function public.save_pos_draft_atomic(
  uuid, uuid, jsonb, text, numeric, numeric, numeric, numeric, text, text, boolean
) to authenticated;

comment on function public.save_pos_draft_atomic(
  uuid, uuid, jsonb, text, numeric, numeric, numeric, numeric, text, text, boolean
) is 'Atomically inserts or replaces a retail POS draft without stock, debt-ledger or cash side effects.';

create or replace function public.adopt_pos_draft_session_atomic(
  p_invoice_id uuid,
  p_client_session_id text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_session_id uuid;
  v_invoice record;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  begin
    v_session_id := nullif(trim(coalesce(p_client_session_id, '')), '')::uuid;
  exception when others then
    raise exception using errcode = '22023', message = 'POS_SESSION_INVALID';
  end;
  if v_session_id is null then
    raise exception using errcode = '22023', message = 'POS_SESSION_INVALID';
  end if;
  select p.tenant_id into v_tenant_id
    from public.profiles p
   where p.id = v_actor and coalesce(p.is_active, true);
  if v_tenant_id is null then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if not public.user_has_permission(v_actor, 'pos_retail.save_draft') then
    raise exception using errcode = '42501', message = 'POS_SAVE_DRAFT_DENIED';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_tenant_id::text || ':' || v_session_id::text, 264)
  );

  select i.id, i.code, i.branch_id, i.status, i.client_session_id
    into v_invoice
    from public.invoices i
   where i.id = p_invoice_id
     and i.tenant_id = v_tenant_id
     and i.deleted_at is null
   for update;
  if not found or v_invoice.status <> 'draft' then
    raise exception using errcode = '22023', message = 'POS_DRAFT_NOT_FOUND';
  end if;
  if not public.user_has_branch_access(v_actor, v_invoice.branch_id) then
    raise exception using errcode = '42501', message = 'POS_BRANCH_DENIED';
  end if;
  if v_invoice.client_session_id = v_session_id then
    return jsonb_build_object('invoice_id', v_invoice.id, 'invoice_code', v_invoice.code, 'idempotent', true);
  end if;
  if exists (
    select 1 from public.invoices other
    where other.tenant_id = v_tenant_id
      and other.client_session_id = v_session_id
      and other.id <> v_invoice.id
      and other.deleted_at is null
  ) then
    raise exception using errcode = '23505', message = 'POS_SESSION_ALREADY_USED';
  end if;

  update public.invoices
     set client_session_id = v_session_id, updated_at = now()
   where id = v_invoice.id and tenant_id = v_tenant_id;
  return jsonb_build_object('invoice_id', v_invoice.id, 'invoice_code', v_invoice.code, 'idempotent', false);
end;
$$;

create or replace function public.soft_delete_pos_draft_atomic(
  p_invoice_id uuid,
  p_only_auto_saved boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_invoice record;
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
  if not public.user_has_permission(v_actor, 'pos_retail.save_draft') then
    raise exception using errcode = '42501', message = 'POS_SAVE_DRAFT_DENIED';
  end if;

  select i.id, i.code, i.branch_id, i.status, i.source, i.auto_saved
    into v_invoice
    from public.invoices i
   where i.id = p_invoice_id
     and i.tenant_id = v_tenant_id
     and i.deleted_at is null
   for update;
  if not found then
    return jsonb_build_object('invoice_id', p_invoice_id, 'deleted', false, 'idempotent', true);
  end if;
  if not public.user_has_branch_access(v_actor, v_invoice.branch_id) then
    raise exception using errcode = '42501', message = 'POS_BRANCH_DENIED';
  end if;
  if v_invoice.status <> 'draft'
     or coalesce(v_invoice.source, 'pos') = 'order'
     or (coalesce(p_only_auto_saved, false) and not coalesce(v_invoice.auto_saved, false)) then
    return jsonb_build_object('invoice_id', v_invoice.id, 'deleted', false, 'idempotent', true);
  end if;

  update public.invoices
     set deleted_at = now(), client_session_id = null, updated_at = now()
   where id = v_invoice.id and tenant_id = v_tenant_id;
  insert into public.audit_log (tenant_id, user_id, action, entity_type, entity_id, old_data, new_data)
  values (
    v_tenant_id, v_actor, 'soft_delete', 'pos_draft', v_invoice.id,
    jsonb_build_object('code', v_invoice.code, 'status', v_invoice.status, 'auto_saved', v_invoice.auto_saved),
    jsonb_build_object('deleted_at', now(), 'atomic', true)
  );
  return jsonb_build_object('invoice_id', v_invoice.id, 'deleted', true, 'idempotent', false);
end;
$$;

revoke all on function public.adopt_pos_draft_session_atomic(uuid, text)
  from public, anon;
grant execute on function public.adopt_pos_draft_session_atomic(uuid, text)
  to authenticated;
revoke all on function public.soft_delete_pos_draft_atomic(uuid, boolean)
  from public, anon;
grant execute on function public.soft_delete_pos_draft_atomic(uuid, boolean)
  to authenticated;

select to_regprocedure(
  'public.save_pos_draft_atomic(uuid,uuid,jsonb,text,numeric,numeric,numeric,numeric,text,text,boolean)'
) is not null as save_pos_draft_atomic_ok;

select
  to_regprocedure('public.adopt_pos_draft_session_atomic(uuid,text)') is not null as adopt_pos_draft_session_atomic_ok,
  to_regprocedure('public.soft_delete_pos_draft_atomic(uuid,boolean)') is not null as soft_delete_pos_draft_atomic_ok;


-- ==================== 00265_atomic_sales_order_save.sql ====================
-- ============================================================
-- 00265: Atomic sales-order draft save with optional shipment
-- ============================================================
-- Function definition only. Existing orders, invoices, stock and cash are untouched.

create or replace function public.save_sales_order_atomic(
  p_order_id uuid,
  p_requested_code text,
  p_branch_id uuid,
  p_customer_id uuid,
  p_items jsonb,
  p_delivery_fee numeric,
  p_note text,
  p_partner_id uuid,
  p_receiver_name text,
  p_receiver_phone text,
  p_receiver_address text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_branch_id uuid := p_branch_id;
  v_order record;
  v_order_id uuid;
  v_code text;
  v_customer_name text := 'Khách lẻ';
  v_product record;
  v_item jsonb;
  v_product_id uuid;
  v_quantity numeric;
  v_unit_price numeric;
  v_subtotal numeric := 0;
  v_total numeric;
  v_delivery_fee numeric := coalesce(p_delivery_fee, 0);
  v_name text := nullif(trim(coalesce(p_receiver_name, '')), '');
  v_phone text := nullif(trim(coalesce(p_receiver_phone, '')), '');
  v_address text := nullif(trim(coalesce(p_receiver_address, '')), '');
  v_shipment record;
  v_shipment_id uuid;
  v_shipment_code text;
  v_created boolean := false;
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
    raise exception using errcode = '42501', message = 'ORDER_SAVE_DENIED';
  end if;
  if v_delivery_fee < 0 or v_delivery_fee = 'NaN'::numeric then
    raise exception using errcode = '22023', message = 'ORDER_DELIVERY_FEE_INVALID';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0
     or jsonb_array_length(p_items) > 1000 then
    raise exception using errcode = '22023', message = 'ORDER_ITEMS_INVALID';
  end if;
  if num_nonnull(v_name, v_phone, v_address) not in (0, 3) then
    raise exception using errcode = '22023', message = 'SHIPMENT_RECEIVER_INCOMPLETE';
  end if;

  if p_order_id is null then
    if not exists (
      select 1 from public.branches b
      where b.id = v_branch_id and b.tenant_id = v_tenant_id and coalesce(b.is_active, true)
    ) or not public.user_has_branch_access(v_actor, v_branch_id) then
      raise exception using errcode = '42501', message = 'ORDER_BRANCH_DENIED';
    end if;
    v_code := nullif(trim(coalesce(p_requested_code, '')), '');
    if v_code is null then
      v_code := public.next_code(v_tenant_id, 'order');
    elsif length(v_code) > 50 then
      raise exception using errcode = '22023', message = 'ORDER_CODE_INVALID';
    end if;
    v_created := true;
  else
    select i.id, i.code, i.branch_id, i.status, i.source, i.paid
      into v_order
      from public.invoices i
     where i.id = p_order_id
       and i.tenant_id = v_tenant_id
       and i.deleted_at is null
     for update;
    if not found then
      raise exception using errcode = '22023', message = 'ORDER_NOT_FOUND';
    end if;
    if v_order.status <> 'draft' or v_order.source <> 'order' or coalesce(v_order.paid, 0) <> 0 then
      raise exception using errcode = '22023', message = 'ORDER_NOT_EDITABLE';
    end if;
    if v_branch_id is not null and v_branch_id <> v_order.branch_id then
      raise exception using errcode = '42501', message = 'ORDER_BRANCH_MISMATCH';
    end if;
    if not public.user_has_branch_access(v_actor, v_order.branch_id) then
      raise exception using errcode = '42501', message = 'ORDER_BRANCH_DENIED';
    end if;
    if nullif(trim(coalesce(p_requested_code, '')), '') is not null
       and trim(p_requested_code) <> v_order.code then
      raise exception using errcode = '22023', message = 'ORDER_CODE_IMMUTABLE';
    end if;
    v_branch_id := v_order.branch_id;
    v_code := v_order.code;
  end if;

  if p_customer_id is not null then
    select c.name into v_customer_name
      from public.customers c
     where c.id = p_customer_id
       and c.tenant_id = v_tenant_id
       and coalesce(c.is_active, true);
    if not found then
      raise exception using errcode = '22023', message = 'ORDER_CUSTOMER_INVALID';
    end if;
  end if;
  if p_partner_id is not null and not exists (
    select 1 from public.delivery_partners dp
    where dp.id = p_partner_id
      and dp.tenant_id = v_tenant_id
      and coalesce(dp.is_active, true)
  ) then
    raise exception using errcode = '22023', message = 'DELIVERY_PARTNER_INVALID';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_product_id := nullif(v_item->>'product_id', '')::uuid;
      v_quantity := nullif(v_item->>'quantity', '')::numeric;
      v_unit_price := nullif(v_item->>'unit_price', '')::numeric;
    exception when others then
      raise exception using errcode = '22023', message = 'ORDER_ITEM_INVALID';
    end;
    if v_product_id is null
       or v_quantity is null or v_quantity <= 0 or v_quantity = 'NaN'::numeric
       or v_unit_price is null or v_unit_price < 0 or v_unit_price = 'NaN'::numeric then
      raise exception using errcode = '22023', message = 'ORDER_ITEM_INVALID';
    end if;
    select p.id, p.name, p.unit into v_product
      from public.products p
     where p.id = v_product_id
       and p.tenant_id = v_tenant_id
       and coalesce(p.is_active, true)
       and coalesce(p.product_type, 'sku') = 'sku';
    if not found then
      raise exception using errcode = '22023', message = 'ORDER_PRODUCT_INVALID';
    end if;
    v_subtotal := v_subtotal + round(v_quantity * v_unit_price, 2);
  end loop;
  v_total := v_subtotal + v_delivery_fee;

  if v_created then
    insert into public.invoices (
      tenant_id, branch_id, code, customer_id, customer_name, status, source,
      subtotal, discount_amount, tax_amount, delivery_fee, total, paid, debt,
      payment_method, note, created_by, auto_saved
    ) values (
      v_tenant_id, v_branch_id, v_code, p_customer_id, v_customer_name, 'draft', 'order',
      v_subtotal, 0, 0, v_delivery_fee, v_total, 0, v_total,
      'cash', nullif(trim(coalesce(p_note, '')), ''), v_actor, false
    ) returning id into v_order_id;
  else
    v_order_id := p_order_id;
    update public.invoices
       set customer_id = p_customer_id, customer_name = v_customer_name,
           subtotal = v_subtotal, discount_amount = 0, tax_amount = 0,
           delivery_fee = v_delivery_fee, total = v_total, paid = 0, debt = v_total,
           note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now()
     where id = v_order_id and tenant_id = v_tenant_id and status = 'draft' and source = 'order';
    delete from public.invoice_items ii where ii.invoice_id = v_order_id;
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::numeric;
    v_unit_price := (v_item->>'unit_price')::numeric;
    select p.id, p.name, p.unit into v_product
      from public.products p where p.id = v_product_id and p.tenant_id = v_tenant_id;
    insert into public.invoice_items (
      invoice_id, product_id, product_name, unit, quantity, unit_price, discount, total, note
    ) values (
      v_order_id, v_product_id, v_product.name, coalesce(v_product.unit, 'Cái'),
      v_quantity, v_unit_price, 0, round(v_quantity * v_unit_price, 2),
      nullif(trim(coalesce(v_item->>'note', '')), '')
    );
  end loop;

  select so.id, so.code, so.status into v_shipment
    from public.shipping_orders so
   where so.tenant_id = v_tenant_id
     and so.invoice_id = v_order_id
     and so.status not in ('cancelled', 'returned')
   order by so.created_at desc limit 1 for update;

  if found then
    v_shipment_id := v_shipment.id;
    v_shipment_code := v_shipment.code;
    update public.shipping_orders
       set shipping_fee = v_delivery_fee, cod_amount = v_total,
           partner_id = coalesce(p_partner_id, partner_id), updated_at = now()
     where id = v_shipment.id and tenant_id = v_tenant_id;
  elsif v_name is not null then
    v_shipment_code := public.next_code(v_tenant_id, 'shipping_order');
    insert into public.shipping_orders (
      tenant_id, invoice_id, partner_id, code, status, shipping_fee, cod_amount,
      receiver_name, receiver_phone, receiver_address, note
    ) values (
      v_tenant_id, v_order_id, p_partner_id, v_shipment_code, 'pending',
      v_delivery_fee, v_total, v_name, v_phone, v_address,
      nullif(trim(coalesce(p_note, '')), '')
    ) returning id into v_shipment_id;
  end if;

  insert into public.audit_log (tenant_id, user_id, action, entity_type, entity_id, new_data)
  values (
    v_tenant_id, v_actor,
    case when v_created then 'sales_order_created' else 'sales_order_updated' end,
    'sales_order', v_order_id,
    jsonb_build_object(
      'code', v_code, 'branch_id', v_branch_id, 'customer_id', p_customer_id,
      'item_count', jsonb_array_length(p_items), 'subtotal', v_subtotal,
      'delivery_fee', v_delivery_fee, 'total', v_total,
      'shipment_id', v_shipment_id, 'atomic', true
    )
  );

  return jsonb_build_object(
    'order_id', v_order_id, 'order_code', v_code, 'total', v_total,
    'shipment_id', v_shipment_id, 'shipment_code', v_shipment_code,
    'created', v_created
  );
end;
$$;

revoke all on function public.save_sales_order_atomic(
  uuid, text, uuid, uuid, jsonb, numeric, text, uuid, text, text, text
) from public, anon;
grant execute on function public.save_sales_order_atomic(
  uuid, text, uuid, uuid, jsonb, numeric, text, uuid, text, text, text
) to authenticated;

comment on function public.save_sales_order_atomic(
  uuid, text, uuid, uuid, jsonb, numeric, text, uuid, text, text, text
) is 'Atomically saves a sales-order draft, its lines and linked shipment without stock or cash effects.';

select to_regprocedure(
  'public.save_sales_order_atomic(uuid,text,uuid,uuid,jsonb,numeric,text,uuid,text,text,text)'
) is not null as save_sales_order_atomic_ok;


-- ==================== 00266_atomic_invoice_duplicate.sql ====================
-- ============================================================
-- 00266: Atomic invoice duplication into a new sales-order draft
-- ============================================================
-- Function definition only. Existing invoices, stock, cash and debt are untouched.

create or replace function public.duplicate_invoice_to_order_atomic(
  p_source_invoice_id uuid,
  p_target_branch_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_source record;
  v_order_id uuid;
  v_code text;
  v_item_count integer;
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
    raise exception using errcode = '42501', message = 'ORDER_DUPLICATE_DENIED';
  end if;
  if not exists (
    select 1 from public.branches b
     where b.id = p_target_branch_id
       and b.tenant_id = v_tenant_id
       and coalesce(b.is_active, true)
  ) or not public.user_has_branch_access(v_actor, p_target_branch_id) then
    raise exception using errcode = '42501', message = 'ORDER_BRANCH_DENIED';
  end if;

  select i.* into v_source
    from public.invoices i
   where i.id = p_source_invoice_id
     and i.tenant_id = v_tenant_id
     and i.deleted_at is null;
  if not found then
    raise exception using errcode = '22023', message = 'SOURCE_INVOICE_NOT_FOUND';
  end if;

  select count(*)::integer into v_item_count
    from public.invoice_items ii
   where ii.invoice_id = v_source.id;
  if v_item_count = 0 then
    raise exception using errcode = '22023', message = 'SOURCE_INVOICE_HAS_NO_ITEMS';
  end if;

  v_code := public.next_code(v_tenant_id, 'order');
  insert into public.invoices (
    tenant_id, branch_id, code, customer_id, customer_name, status, source,
    subtotal, discount_amount, tax_amount, delivery_fee, total, paid, debt,
    payment_method, note, created_by, auto_saved
  ) values (
    v_tenant_id, p_target_branch_id, v_code,
    v_source.customer_id, v_source.customer_name, 'draft', 'order',
    coalesce(v_source.subtotal, 0), coalesce(v_source.discount_amount, 0),
    coalesce(v_source.tax_amount, 0), coalesce(v_source.delivery_fee, 0),
    coalesce(v_source.total, 0), 0, coalesce(v_source.total, 0),
    coalesce(v_source.payment_method, 'cash'), v_source.note, v_actor, false
  ) returning id into v_order_id;

  insert into public.invoice_items (
    invoice_id, product_id, product_name, unit, quantity, unit_price,
    discount, vat_rate, vat_amount, total, returned_qty, unit_cost, note, variant_id
  )
  select
    v_order_id, ii.product_id, ii.product_name, ii.unit, ii.quantity, ii.unit_price,
    coalesce(ii.discount, 0), coalesce(ii.vat_rate, 0), coalesce(ii.vat_amount, 0),
    ii.total, 0, null, ii.note, ii.variant_id
  from public.invoice_items ii
  where ii.invoice_id = v_source.id;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_tenant_id, v_actor, 'invoice_duplicated_to_order', 'sales_order', v_order_id,
    jsonb_build_object(
      'source_invoice_id', v_source.id,
      'source_invoice_code', v_source.code,
      'target_order_code', v_code,
      'target_branch_id', p_target_branch_id,
      'item_count', v_item_count,
      'atomic', true
    )
  );

  return jsonb_build_object(
    'invoice_id', v_order_id,
    'invoice_code', v_code,
    'source_invoice_id', v_source.id,
    'item_count', v_item_count
  );
end;
$$;

revoke all on function public.duplicate_invoice_to_order_atomic(uuid, uuid)
  from public, anon;
grant execute on function public.duplicate_invoice_to_order_atomic(uuid, uuid)
  to authenticated;

comment on function public.duplicate_invoice_to_order_atomic(uuid, uuid) is
  'Atomically duplicates one tenant invoice into a new order draft without stock or cash effects.';

select to_regprocedure(
  'public.duplicate_invoice_to_order_atomic(uuid,uuid)'
) is not null as duplicate_invoice_to_order_atomic_ok;


-- ==================== 00267_harden_cash_book_atomic.sql ====================
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


-- ==================== 00268_atomic_internal_disposal_export_create.sql ====================
-- ============================================================
-- 00268: Atomic creation and stock application for internal/disposal exports
-- ============================================================
-- Function definitions only. Existing documents and stock are untouched.

create or replace function public._create_and_apply_stock_export_00268(
  p_kind text,
  p_branch_id uuid,
  p_purpose text,
  p_note text,
  p_items jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_document_id uuid;
  v_code text;
  v_item jsonb;
  v_product record;
  v_product_id uuid;
  v_quantity numeric;
  v_available numeric;
  v_total numeric := 0;
  v_apply_result jsonb;
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
  if p_kind = 'internal' then
    if not public.user_has_permission(v_actor, 'inventory.internal_export') then
      raise exception using errcode = '42501', message = 'INTERNAL_EXPORT_DENIED';
    end if;
  elsif p_kind = 'disposal' then
    if not public.user_has_permission(v_actor, 'inventory.dispose') then
      raise exception using errcode = '42501', message = 'DISPOSAL_EXPORT_DENIED';
    end if;
  else
    raise exception using errcode = '22023', message = 'EXPORT_KIND_INVALID';
  end if;
  if not exists (
    select 1 from public.branches b
     where b.id = p_branch_id
       and b.tenant_id = v_tenant_id
       and coalesce(b.is_active, true)
  ) or not public.user_has_branch_access(v_actor, p_branch_id) then
    raise exception using errcode = '42501', message = 'EXPORT_BRANCH_DENIED';
  end if;
  if nullif(trim(coalesce(p_purpose, '')), '') is null then
    raise exception using errcode = '22023', message = 'EXPORT_PURPOSE_REQUIRED';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0
     or jsonb_array_length(p_items) > 1000 then
    raise exception using errcode = '22023', message = 'EXPORT_ITEMS_INVALID';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) e
     group by e->>'product_id' having count(*) > 1
  ) then
    raise exception using errcode = '22023', message = 'DUPLICATE_PRODUCT';
  end if;

  -- Stable lock order prevents two terminals from consuming the same remaining stock.
  for v_item in
    select value from jsonb_array_elements(p_items)
    order by value->>'product_id'
  loop
    begin
      v_product_id := nullif(v_item->>'product_id', '')::uuid;
      v_quantity := nullif(v_item->>'quantity', '')::numeric;
    exception when others then
      raise exception using errcode = '22023', message = 'EXPORT_ITEM_INVALID';
    end;
    if v_product_id is null or v_quantity is null or v_quantity <= 0
       or v_quantity = 'NaN'::numeric then
      raise exception using errcode = '22023', message = 'EXPORT_ITEM_INVALID';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        v_tenant_id::text || ':' || p_branch_id::text || ':' || v_product_id::text,
        0
      )
    );
    select p.id, p.name, p.unit, coalesce(p.cost_price, 0) as cost_price,
           p.inventory_role
      into v_product
      from public.products p
     where p.id = v_product_id
       and p.tenant_id = v_tenant_id
       and coalesce(p.is_active, true);
    if not found then
      raise exception using errcode = '22023', message = 'EXPORT_PRODUCT_INVALID';
    end if;
    if v_product.inventory_role = 'fnb_menu_item' then
      raise exception using errcode = '22023', message = 'MENU_NO_DIRECT_STOCK';
    end if;

    select coalesce(bs.quantity, 0) into v_available
      from public.branch_stock bs
     where bs.tenant_id = v_tenant_id
       and bs.branch_id = p_branch_id
       and bs.product_id = v_product_id
       and bs.variant_id is null
     for update;
    if not found then v_available := 0; end if;
    if v_available < v_quantity then
      raise exception using errcode = '22023', message = 'INSUFFICIENT_BRANCH_STOCK',
        detail = jsonb_build_object(
          'product_id', v_product_id,
          'product_name', v_product.name,
          'available', v_available,
          'requested', v_quantity
        )::text;
    end if;
    v_total := v_total + round(v_quantity * v_product.cost_price, 2);
  end loop;

  if p_kind = 'internal' then
    v_code := public.next_code(v_tenant_id, 'internal_export');
    insert into public.internal_exports (
      tenant_id, branch_id, code, status, total_amount, department, note, created_by
    ) values (
      v_tenant_id, p_branch_id, v_code, 'draft', v_total,
      trim(p_purpose), nullif(trim(coalesce(p_note, '')), ''), v_actor
    ) returning id into v_document_id;

    for v_item in select value from jsonb_array_elements(p_items)
    loop
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity := (v_item->>'quantity')::numeric;
      select p.name, p.unit, coalesce(p.cost_price, 0) as cost_price into v_product
        from public.products p
       where p.id = v_product_id and p.tenant_id = v_tenant_id;
      insert into public.internal_export_items (
        export_id, product_id, product_name, unit, quantity, unit_price, total
      ) values (
        v_document_id, v_product_id, v_product.name, coalesce(v_product.unit, ''),
        v_quantity, v_product.cost_price, round(v_quantity * v_product.cost_price, 2)
      );
    end loop;
    v_apply_result := public.apply_internal_export_atomic(v_document_id, null);
  else
    v_code := public.next_code(v_tenant_id, 'disposal');
    insert into public.disposal_exports (
      tenant_id, branch_id, code, status, total_amount, reason, note, created_by
    ) values (
      v_tenant_id, p_branch_id, v_code, 'draft', v_total,
      trim(p_purpose), nullif(trim(coalesce(p_note, '')), ''), v_actor
    ) returning id into v_document_id;

    for v_item in select value from jsonb_array_elements(p_items)
    loop
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity := (v_item->>'quantity')::numeric;
      select p.name, p.unit, coalesce(p.cost_price, 0) as cost_price into v_product
        from public.products p
       where p.id = v_product_id and p.tenant_id = v_tenant_id;
      insert into public.disposal_export_items (
        disposal_id, product_id, product_name, unit, quantity, unit_price, total, unit_cost
      ) values (
        v_document_id, v_product_id, v_product.name, coalesce(v_product.unit, ''),
        v_quantity, v_product.cost_price, round(v_quantity * v_product.cost_price, 2),
        v_product.cost_price
      );
    end loop;
    v_apply_result := public.apply_disposal_export_atomic(v_document_id, null);
  end if;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_tenant_id, v_actor, 'stock_export_created',
    case when p_kind = 'internal' then 'internal_export' else 'disposal_export' end,
    v_document_id,
    jsonb_build_object(
      'code', v_code, 'branch_id', p_branch_id, 'kind', p_kind,
      'item_count', jsonb_array_length(p_items), 'total_amount', v_total,
      'apply_result', v_apply_result, 'atomic', true
    )
  );

  return jsonb_build_object(
    'id', v_document_id, 'code', v_code, 'kind', p_kind,
    'total_amount', v_total, 'apply_result', v_apply_result
  );
end;
$$;

create or replace function public.create_internal_export_atomic(
  p_branch_id uuid,
  p_department text,
  p_note text,
  p_items jsonb
) returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public._create_and_apply_stock_export_00268(
    'internal', p_branch_id, p_department, p_note, p_items
  );
$$;

create or replace function public.create_disposal_export_atomic(
  p_branch_id uuid,
  p_reason text,
  p_note text,
  p_items jsonb
) returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public._create_and_apply_stock_export_00268(
    'disposal', p_branch_id, p_reason, p_note, p_items
  );
$$;

revoke all on function public._create_and_apply_stock_export_00268(
  text, uuid, text, text, jsonb
) from public, anon, authenticated;
revoke all on function public.create_internal_export_atomic(
  uuid, text, text, jsonb
) from public, anon;
revoke all on function public.create_disposal_export_atomic(
  uuid, text, text, jsonb
) from public, anon;
grant execute on function public.create_internal_export_atomic(
  uuid, text, text, jsonb
) to authenticated;
grant execute on function public.create_disposal_export_atomic(
  uuid, text, text, jsonb
) to authenticated;

comment on function public.create_internal_export_atomic(uuid, text, text, jsonb) is
  'Creates and applies one internal stock export atomically using server product cost.';
comment on function public.create_disposal_export_atomic(uuid, text, text, jsonb) is
  'Creates and applies one disposal stock export atomically using server product cost.';

select
  to_regprocedure('public.create_internal_export_atomic(uuid,text,text,jsonb)') is not null as internal_export_create_ok,
  to_regprocedure('public.create_disposal_export_atomic(uuid,text,text,jsonb)') is not null as disposal_export_create_ok;


-- ==================== 00269_atomic_stock_export_cancel.sql ====================
-- ============================================================
-- 00269: One guarded cancellation path for draft/completed stock exports
-- ============================================================
-- Function definitions only. Applying this migration changes no existing rows.

create or replace function public._cancel_stock_export_00269(
  p_kind text,
  p_document_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_doc record;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_void_result jsonb;
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
  if v_reason is null or length(v_reason) < 3 then
    raise exception using errcode = '22023', message = 'EXPORT_CANCEL_REASON_REQUIRED';
  end if;

  if p_kind = 'disposal' then
    if not public.user_has_permission(v_actor, 'inventory.dispose') then
      raise exception using errcode = '42501', message = 'DISPOSAL_CANCEL_DENIED';
    end if;
    select d.id, d.code, d.branch_id, d.status into v_doc
      from public.disposal_exports d
     where d.id = p_document_id and d.tenant_id = v_tenant_id
     for update;
  elsif p_kind = 'internal' then
    if not public.user_has_permission(v_actor, 'inventory.internal_export') then
      raise exception using errcode = '42501', message = 'INTERNAL_CANCEL_DENIED';
    end if;
    select e.id, e.code, e.branch_id, e.status into v_doc
      from public.internal_exports e
     where e.id = p_document_id and e.tenant_id = v_tenant_id
     for update;
  else
    raise exception using errcode = '22023', message = 'EXPORT_KIND_INVALID';
  end if;

  if not found then
    raise exception using errcode = '22023', message = 'EXPORT_DOCUMENT_NOT_FOUND';
  end if;
  if not public.user_has_branch_access(v_actor, v_doc.branch_id) then
    raise exception using errcode = '42501', message = 'EXPORT_BRANCH_DENIED';
  end if;
  if v_doc.status = 'cancelled' then
    return jsonb_build_object(
      'id', v_doc.id, 'code', v_doc.code, 'status', 'cancelled', 'idempotent', true
    );
  end if;

  if v_doc.status = 'draft' then
    if p_kind = 'disposal' then
      update public.disposal_exports
         set status = 'cancelled', updated_at = now()
       where id = v_doc.id and tenant_id = v_tenant_id and status = 'draft';
    else
      update public.internal_exports
         set status = 'cancelled', updated_at = now()
       where id = v_doc.id and tenant_id = v_tenant_id and status = 'draft';
    end if;
  elsif v_doc.status = 'completed' then
    if p_kind = 'disposal' then
      v_void_result := public.void_disposal_export_atomic(v_doc.id, null, v_reason);
    else
      v_void_result := public.void_internal_export_atomic(v_doc.id, null, v_reason);
    end if;
  else
    raise exception using errcode = '22023', message = 'EXPORT_STATUS_NOT_CANCELLABLE';
  end if;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_tenant_id, v_actor, 'stock_export_cancelled',
    case when p_kind = 'internal' then 'internal_export' else 'disposal_export' end,
    v_doc.id,
    jsonb_build_object('status', v_doc.status),
    jsonb_build_object(
      'status', 'cancelled', 'reason', v_reason,
      'stock_reversed', v_doc.status = 'completed',
      'void_result', v_void_result, 'atomic', true
    )
  );

  return jsonb_build_object(
    'id', v_doc.id, 'code', v_doc.code, 'status', 'cancelled',
    'stock_reversed', v_doc.status = 'completed', 'idempotent', false
  );
end;
$$;

create or replace function public.cancel_disposal_export_atomic_v2(
  p_disposal_id uuid,
  p_reason text
) returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public._cancel_stock_export_00269('disposal', p_disposal_id, p_reason);
$$;

create or replace function public.cancel_internal_export_atomic_v2(
  p_export_id uuid,
  p_reason text
) returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public._cancel_stock_export_00269('internal', p_export_id, p_reason);
$$;

revoke all on function public._cancel_stock_export_00269(text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.cancel_disposal_export_atomic_v2(uuid, text)
  from public, anon;
revoke all on function public.cancel_internal_export_atomic_v2(uuid, text)
  from public, anon;
grant execute on function public.cancel_disposal_export_atomic_v2(uuid, text)
  to authenticated;
grant execute on function public.cancel_internal_export_atomic_v2(uuid, text)
  to authenticated;

select
  to_regprocedure('public.cancel_disposal_export_atomic_v2(uuid,text)') is not null as cancel_disposal_v2_ok,
  to_regprocedure('public.cancel_internal_export_atomic_v2(uuid,text)') is not null as cancel_internal_v2_ok;


commit;

-- Read-only verification for this batch.
with expected(function_name) as (
  values
    ('save_purchase_order_atomic'),
    ('set_purchase_order_state_atomic'),
    ('close_purchase_order_short'),
    ('cancel_inventory_check_atomic'),
    ('save_pos_draft_atomic'),
    ('adopt_pos_draft_session_atomic'),
    ('soft_delete_pos_draft_atomic'),
    ('save_sales_order_atomic'),
    ('duplicate_invoice_to_order_atomic'),
    ('create_manual_cash_transaction_atomic'),
    ('cancel_cash_transaction'),
    ('_create_and_apply_stock_export_00268'),
    ('create_internal_export_atomic'),
    ('create_disposal_export_atomic'),
    ('_cancel_stock_export_00269'),
    ('cancel_disposal_export_atomic_v2'),
    ('cancel_internal_export_atomic_v2')
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