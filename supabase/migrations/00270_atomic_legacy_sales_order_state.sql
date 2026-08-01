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
