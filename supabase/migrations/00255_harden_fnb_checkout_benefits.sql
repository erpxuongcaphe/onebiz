-- ============================================================
-- 00255: Apply F&B promotion, coupon and loyalty in checkout
--
-- No existing row is changed when this migration is applied.
-- Future benefits commit or roll back with the paid invoice.
-- ============================================================

create or replace function public.fnb_complete_payment_atomic_v2(
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
  p_tip_amount numeric default 0,
  p_promotion_id uuid default null,
  p_promotion_discount numeric default 0,
  p_promotion_free_value numeric default 0,
  p_coupon_code text default null,
  p_coupon_discount numeric default 0
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid := public.get_user_tenant_id();
  v_order record;
  v_invoice record;
  v_result jsonb;
  v_invoice_id uuid;
begin
  if v_actor is null or v_tenant_id is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if coalesce(p_promotion_discount, 0) < 0
     or coalesce(p_coupon_discount, 0) < 0
     or coalesce(p_promotion_free_value, 0) < 0
     or coalesce(p_promotion_discount, 0) + coalesce(p_coupon_discount, 0)
        > coalesce(p_discount_amount, 0) + 0.01 then
    raise exception using errcode = '22023', message = 'FNB_BENEFIT_AMOUNT_INVALID';
  end if;
  if nullif(trim(coalesce(p_coupon_code, '')), '') is null
     and coalesce(p_coupon_discount, 0) > 0 then
    raise exception using errcode = '22023', message = 'FNB_COUPON_SOURCE_INVALID';
  end if;
  if p_promotion_id is null and coalesce(p_promotion_discount, 0) > 0 then
    raise exception using errcode = '22023', message = 'FNB_PROMOTION_SOURCE_INVALID';
  end if;

  select ko.id, ko.branch_id, ko.invoice_id
  into v_order
  from public.kitchen_orders ko
  where ko.id = p_kitchen_order_id
    and ko.tenant_id = v_tenant_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'KITCHEN_ORDER_NOT_FOUND';
  end if;
  if not public.user_has_branch_access(v_actor, v_order.branch_id) then
    raise exception using errcode = '42501', message = 'BRANCH_ACCESS_DENIED';
  end if;

  -- Network retry after a committed payment returns the same invoice and
  -- never consumes promotion/coupon/loyalty twice.
  if v_order.invoice_id is not null then
    select i.id, i.code, i.total, i.paid, i.debt
    into v_invoice
    from public.invoices i
    where i.id = v_order.invoice_id
      and i.tenant_id = v_tenant_id
      and i.deleted_at is null;
    if not found then
      raise exception using errcode = 'P0001', message = 'PAID_INVOICE_NOT_FOUND';
    end if;
    return jsonb_build_object(
      'invoice_id', v_invoice.id,
      'invoice_code', v_invoice.code,
      'total', v_invoice.total,
      'paid', v_invoice.paid,
      'debt', v_invoice.debt,
      'idempotent', true
    );
  end if;

  if p_promotion_id is not null and not exists (
    select 1
    from public.promotions p
    where p.id = p_promotion_id
      and p.tenant_id = v_tenant_id
      and p.is_active = true
      and now() between p.start_date and p.end_date
  ) then
    raise exception using errcode = '22023', message = 'FNB_PROMOTION_INVALID';
  end if;

  v_result := public.fnb_complete_payment_atomic(
    p_kitchen_order_id,
    p_customer_id,
    p_customer_name,
    p_payment_method,
    p_payment_breakdown,
    p_paid,
    p_discount_amount,
    p_note,
    p_created_by,
    p_shift_id,
    p_tip_amount
  );
  v_invoice_id := (v_result->>'invoice_id')::uuid;

  if p_promotion_id is not null then
    perform public.increment_promotion_usage(p_promotion_id);
    update public.invoices
    set promotion_id = p_promotion_id,
        promotion_discount = coalesce(p_promotion_discount, 0),
        promotion_free_value = coalesce(p_promotion_free_value, 0)
    where id = v_invoice_id
      and tenant_id = v_tenant_id;
  end if;

  if nullif(trim(coalesce(p_coupon_code, '')), '') is not null then
    perform public.apply_coupon_atomic(
      trim(p_coupon_code),
      v_invoice_id,
      p_customer_id,
      coalesce(p_coupon_discount, 0),
      v_tenant_id
    );
  end if;

  if p_customer_id is not null then
    perform public.earn_loyalty_points(
      p_customer_id,
      v_invoice_id,
      coalesce((v_result->>'total')::numeric, 0)
    );
  end if;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_tenant_id,
    v_actor,
    'fnb_checkout_benefits_applied',
    'invoice',
    v_invoice_id,
    jsonb_build_object(
      'promotion_id', p_promotion_id,
      'promotion_discount', coalesce(p_promotion_discount, 0),
      'promotion_free_value', coalesce(p_promotion_free_value, 0),
      'coupon_code', nullif(trim(coalesce(p_coupon_code, '')), ''),
      'coupon_discount', coalesce(p_coupon_discount, 0),
      'loyalty_customer_id', p_customer_id
    )
  );

  return v_result || jsonb_build_object(
    'promotion_id', p_promotion_id,
    'coupon_code', nullif(trim(coalesce(p_coupon_code, '')), ''),
    'benefits_applied', true
  );
end;
$$;

revoke all on function public.fnb_complete_payment_atomic_v2(
  uuid, uuid, text, text, jsonb, numeric, numeric, text, uuid, uuid, numeric,
  uuid, numeric, numeric, text, numeric
) from public, anon;
grant execute on function public.fnb_complete_payment_atomic_v2(
  uuid, uuid, text, text, jsonb, numeric, numeric, text, uuid, uuid, numeric,
  uuid, numeric, numeric, text, numeric
) to authenticated;

notify pgrst, 'reload schema';

-- Read-only verification:
-- select to_regprocedure(
--   'public.fnb_complete_payment_atomic_v2(uuid,uuid,text,text,jsonb,numeric,numeric,text,uuid,uuid,numeric,uuid,numeric,numeric,text,numeric)'
-- ) is not null as fnb_payment_v2_ok;
