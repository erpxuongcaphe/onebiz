-- ============================================================
-- 00299: Align purchase-order VND rounding between web and database
-- ============================================================
-- The purchase form rounds each line up to a whole VND before summing.
-- Keep the atomic RPC on the same rule so a fully-paid receipt is not rejected
-- when decimal unit prices produce fractions below one VND.
-- Function definition only: existing orders, payments and stock are unchanged.

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

    v_line_before_discount := ceil(v_quantity * v_unit_price);
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
    v_line_subtotal := ceil(v_quantity * v_unit_price) - v_discount;
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
      v_order_id, v_product.id, v_product.name, coalesce(v_product.unit, 'CÃ¡i'),
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
        'Thanh toÃ¡n khi nháº­p hÃ ng - phiáº¿u ' || v_code,
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
) is not null as save_purchase_order_atomic_vnd_rounding_ok;
