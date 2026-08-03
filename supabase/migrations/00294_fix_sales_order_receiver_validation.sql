-- ============================================================
-- 00294: Fix sales-order receiver validation function name
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
  v_customer_name text := 'KhÃ¡ch láº»';
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
  if num_nonnulls(v_name, v_phone, v_address) not in (0, 3) then
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
      v_order_id, v_product_id, v_product.name, coalesce(v_product.unit, 'CÃ¡i'),
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

with target as (
  select to_regprocedure(
    'public.save_sales_order_atomic(uuid,text,uuid,uuid,jsonb,numeric,text,uuid,text,text,text)'
  ) as oid
),
definition as (
  select
    oid,
    case when oid is null then '' else pg_get_functiondef(oid) end as function_def
  from target
)
select
  oid is not null as save_sales_order_atomic_ok,
  position('num_nonnulls(' in function_def) > 0 as receiver_validation_ok,
  position('num_nonnull(' in function_def) = 0 as legacy_typo_removed
from definition;
