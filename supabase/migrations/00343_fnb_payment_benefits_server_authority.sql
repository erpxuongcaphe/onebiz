-- ============================================================
-- 00343: F&B payment benefits are calculated by the server
--
-- Phase A of a two-phase rollout:
--   * Adds fnb_complete_payment_atomic_v3 without changing v2 behaviour.
--   * The new client calls v3 only after this migration is installed.
--   * A later migration revokes old direct entrypoints only after the new
--     client is deployed and its read-only postflight passes.
--
-- This migration does not update existing business rows.
-- ============================================================

begin;

do $$
declare
  v_actual text;
begin
  if to_regprocedure('public.fnb_complete_payment_atomic_v3(uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text)') is not null then
    raise exception using errcode = 'P0001', message = 'FNB_PAYMENT_V3_ALREADY_EXISTS';
  end if;

  foreach v_actual in array array[
    'public.fnb_complete_payment_atomic_v2(uuid,uuid,text,text,jsonb,numeric,numeric,text,uuid,uuid,numeric,uuid,numeric,numeric,text,numeric)',
    'public.fnb_complete_payment_atomic(uuid,uuid,text,text,jsonb,numeric,numeric,text,uuid,uuid,numeric)',
    'public._fnb_complete_payment_impl_00230(uuid,uuid,text,text,jsonb,numeric,numeric,text,uuid,uuid,numeric)',
    'public.apply_coupon_atomic(text,uuid,uuid,numeric,uuid)',
    'public.increment_promotion_usage(uuid)',
    'public.validate_coupon(text,numeric,uuid)',
    'public.verify_otp_authorization(uuid,text,uuid,uuid)'
  ] loop
    if to_regprocedure(v_actual) is null then
      raise exception using errcode = 'P0001', message = 'FNB_PAYMENT_PREREQUISITE_MISSING', detail = v_actual;
    end if;
  end loop;

  if md5(pg_get_functiondef(to_regprocedure('public.fnb_complete_payment_atomic_v2(uuid,uuid,text,text,jsonb,numeric,numeric,text,uuid,uuid,numeric,uuid,numeric,numeric,text,numeric)')))
       <> 'f2e66083df4f27b461524c6658c6a44a'
    or md5(pg_get_functiondef(to_regprocedure('public.fnb_complete_payment_atomic(uuid,uuid,text,text,jsonb,numeric,numeric,text,uuid,uuid,numeric)')))
       <> '70de07951741ffdb4d13a82fcfc77d30'
    or md5(pg_get_functiondef(to_regprocedure('public.apply_coupon_atomic(text,uuid,uuid,numeric,uuid)')))
       <> '1c87209fdf3cbd69174395181eae5556'
    or md5(pg_get_functiondef(to_regprocedure('public.increment_promotion_usage(uuid)')))
       <> 'dcb441f9c088db438f5ed88a772bdb82'
    or md5(pg_get_functiondef(to_regprocedure('public.validate_coupon(text,numeric,uuid)')))
       <> 'a9eabedde5fdc1800db9b2d91ecf37e5' then
    raise exception using errcode = 'P0001', message = 'FNB_PAYMENT_FUNCTION_FINGERPRINT_CHANGED';
  end if;

  if exists (
    select 1
    from pg_proc p
    where p.oid in (
      to_regprocedure('public.fnb_complete_payment_atomic_v2(uuid,uuid,text,text,jsonb,numeric,numeric,text,uuid,uuid,numeric,uuid,numeric,numeric,text,numeric)'),
      to_regprocedure('public.fnb_complete_payment_atomic(uuid,uuid,text,text,jsonb,numeric,numeric,text,uuid,uuid,numeric)'),
      to_regprocedure('public.apply_coupon_atomic(text,uuid,uuid,numeric,uuid)'),
      to_regprocedure('public.increment_promotion_usage(uuid)'),
      to_regprocedure('public.validate_coupon(text,numeric,uuid)')
    )
      and (not p.prosecdef or pg_get_userbyid(p.proowner) <> 'postgres')
  ) then
    raise exception using errcode = 'P0001', message = 'FNB_PAYMENT_FUNCTION_SECURITY_PREREQUISITE_CHANGED';
  end if;
end;
$$;

create or replace function public.fnb_complete_payment_atomic_v3(
  p_kitchen_order_id uuid,
  p_customer_id uuid,
  p_customer_name text,
  p_payment_method text,
  p_payment_breakdown jsonb,
  p_paid numeric,
  p_allow_debt boolean,
  p_manual_discount_amount numeric default 0,
  p_manual_discount_otp_id uuid default null,
  p_manual_discount_reason text default null,
  p_note text default null,
  p_shift_id uuid default null,
  p_tip_amount numeric default 0,
  p_promotion_id uuid default null,
  p_coupon_code text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_order record;
  v_invoice record;
  v_invoice_total numeric;
  v_invoice_paid numeric;
  v_invoice_debt numeric;
  v_invoice_discount_amount numeric;
  v_invoice_commission_amount numeric;
  v_manual_discount_approver uuid;
  v_next_order_id uuid;
  v_promotion public.promotions%rowtype;
  v_coupon public.coupons%rowtype;
  v_result jsonb;
  v_invoice_id uuid;
  v_menu_subtotal numeric := 0;
  v_order_subtotal numeric := 0;
  v_promotion_eligible_subtotal numeric := 0;
  v_promotion_eligible_quantity numeric := 0;
  v_coupon_eligible_subtotal numeric := 0;
  v_manual_discount numeric := greatest(coalesce(p_manual_discount_amount, 0), 0);
  v_promotion_discount numeric := 0;
  v_promotion_free_value numeric := 0;
  v_coupon_discount numeric := 0;
  v_total_discount numeric := 0;
  v_payment_breakdown_total numeric := 0;
  v_expected_gross numeric := 0;
  v_expected_commission numeric := 0;
  v_expected_total numeric := 0;
  v_paid_to_record numeric := 0;
  v_breakdown_to_record jsonb;
  v_change numeric := 0;
  v_tendered_to_display numeric := 0;
  v_change_to_display numeric := 0;
  v_cash_tendered numeric := 0;
  v_breakdown_count integer := 0;
  v_breakdown_distinct_method_count integer := 0;
  v_coupon_code text := nullif(upper(trim(coalesce(p_coupon_code, ''))), '');
  v_local_time time := (now() at time zone 'Asia/Ho_Chi_Minh')::time;
  v_local_dow integer := extract(dow from (now() at time zone 'Asia/Ho_Chi_Minh'))::integer;
  v_customer_uses integer := 0;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if coalesce(p_manual_discount_amount, 0) < 0
     or coalesce(p_manual_discount_amount, 0) in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) then
    raise exception using errcode = '22023', message = 'FNB_MANUAL_DISCOUNT_INVALID';
  end if;
  if p_paid is null
     or p_paid < 0
     or p_paid in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
     or coalesce(p_tip_amount, 0) < 0
     or coalesce(p_tip_amount, 0) in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) then
    raise exception using errcode = '22023', message = 'FNB_PAYMENT_AMOUNT_INVALID';
  end if;
  if p_payment_method not in ('cash', 'transfer', 'card', 'mixed') then
    raise exception using errcode = '22023', message = 'FNB_PAYMENT_METHOD_INVALID';
  end if;
  if coalesce(p_allow_debt, false) and p_payment_method not in ('cash', 'mixed') then
    raise exception using errcode = '22023', message = 'FNB_DEBT_METHOD_INVALID';
  end if;
  if p_payment_method = 'mixed' then
    if p_payment_breakdown is null
       or jsonb_typeof(p_payment_breakdown) <> 'array'
       or jsonb_array_length(p_payment_breakdown) = 0
       or exists (
         select 1
           from jsonb_array_elements(p_payment_breakdown) item
          where coalesce(item->>'method', '') not in ('cash', 'transfer', 'card')
             or coalesce(item->>'amount', '') !~ '^[0-9]+(?:\.[0-9]+)?$'
       ) then
      raise exception using errcode = '22023', message = 'FNB_PAYMENT_BREAKDOWN_INVALID';
    end if;
    select coalesce(sum((item->>'amount')::numeric), 0), count(*), count(distinct item->>'method')
      into v_payment_breakdown_total, v_breakdown_count, v_breakdown_distinct_method_count
      from jsonb_array_elements(p_payment_breakdown) item;
    if v_payment_breakdown_total <> p_paid then
      raise exception using errcode = '22023', message = 'FNB_PAYMENT_BREAKDOWN_MISMATCH';
    end if;
    if v_breakdown_count <> v_breakdown_distinct_method_count then
      raise exception using errcode = '22023', message = 'FNB_PAYMENT_BREAKDOWN_DUPLICATE_METHOD';
    end if;
  elsif p_payment_breakdown is not null then
    raise exception using errcode = '22023', message = 'FNB_PAYMENT_BREAKDOWN_UNEXPECTED';
  end if;

  select p.tenant_id
    into v_tenant_id
    from public.profiles p
   where p.id = v_actor
     and coalesce(p.is_active, true);
  if not found then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if not public.user_has_permission(v_actor, 'pos_fnb.view_orders') then
    raise exception using errcode = '42501', message = 'FNB_PAYMENT_DENIED';
  end if;
  select ko.id, ko.tenant_id, ko.branch_id, ko.invoice_id, ko.status, ko.table_id,
         coalesce(ko.discount_amount, 0) as discount_amount,
         coalesce(ko.delivery_fee, 0) as delivery_fee,
         coalesce(ko.platform_commission_percent, 0) as platform_commission_percent
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

  -- A retry never evaluates a changed promotion/coupon configuration again.
  if v_order.invoice_id is not null then
    select i.id, i.code, i.total, i.paid, i.debt, i.discount_amount, i.platform_commission
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
      'discount_amount', v_invoice.discount_amount,
      'platform_commission_amount', v_invoice.platform_commission,
      'idempotent', true
    );
  end if;

  -- Manual discounts always need a recently verified manager OTP. The
  -- approver, rather than the cashier, owns the discount permission.
  if v_manual_discount > 0 then
    if p_manual_discount_otp_id is null then
      raise exception using errcode = '42501', message = 'FNB_MANUAL_DISCOUNT_OTP_REQUIRED';
    end if;
    if length(trim(coalesce(p_manual_discount_reason, ''))) < 5 then
      raise exception using errcode = '22023', message = 'FNB_MANUAL_DISCOUNT_REASON_REQUIRED';
    end if;
    v_manual_discount_approver := public.verify_otp_authorization(
      p_manual_discount_otp_id,
      'fnb.discount_override',
      v_actor,
      v_order.id
    );
    if not public.user_has_permission(v_manual_discount_approver, 'pos_fnb.discount') then
      raise exception using errcode = '42501', message = 'FNB_MANUAL_DISCOUNT_APPROVER_DENIED';
    end if;
  end if;

  if p_customer_id is not null and not exists (
    select 1 from public.customers c
     where c.id = p_customer_id and c.tenant_id = v_tenant_id
  ) then
    raise exception using errcode = 'P0001', message = 'CUSTOMER_NOT_FOUND';
  end if;
  if p_shift_id is not null and not exists (
    select 1 from public.shifts s
     where s.id = p_shift_id
       and s.tenant_id = v_tenant_id
       and s.branch_id = v_order.branch_id
       and s.cashier_id = v_actor
       and s.status = 'open'
  ) then
    raise exception using errcode = 'P0001', message = 'SHIFT_NOT_OPEN_FOR_USER_BRANCH';
  end if;

  -- Product prices came from the protected send-to-kitchen snapshot. Toppings
  -- stay part of the final invoice total in the proven 00230 core; promotions
  -- intentionally apply to the main menu products only, matching the POS rule.
  select coalesce(sum(koi.quantity * koi.unit_price), 0)
    into v_menu_subtotal
    from public.kitchen_order_items koi
   where koi.kitchen_order_id = v_order.id;
  -- Keep this calculation aligned with the 00230 core: toppings contribute
  -- to what the guest owes, but automatic promotions only target menu items.
  select coalesce(sum(
    koi.quantity * koi.unit_price + coalesce(toppings.amount, 0)
  ), 0)
    into v_order_subtotal
    from public.kitchen_order_items koi
    left join lateral (
      select coalesce(sum(
        coalesce((topping->>'quantity')::numeric, 0)
        * coalesce((topping->>'price')::numeric, 0)
        * koi.quantity
      ), 0) as amount
      from jsonb_array_elements(coalesce(koi.toppings, '[]'::jsonb)) topping
    ) toppings on true
   where koi.kitchen_order_id = v_order.id;
  if v_menu_subtotal <= 0 or v_order_subtotal <= 0 then
    raise exception using errcode = 'P0001', message = 'FNB_ORDER_TOTAL_INVALID';
  end if;
  if v_manual_discount > greatest(v_order_subtotal - v_order.discount_amount, 0) then
    raise exception using errcode = '22023', message = 'FNB_MANUAL_DISCOUNT_EXCEEDS_ORDER';
  end if;

  if p_promotion_id is not null then
    select p.* into v_promotion
      from public.promotions p
     where p.id = p_promotion_id
       and p.tenant_id = v_tenant_id
     for update;
    if not found then
      raise exception using errcode = '22023', message = 'FNB_PROMOTION_NOT_FOUND';
    end if;
    if not v_promotion.is_active
       or (v_promotion.start_date is not null and now() < v_promotion.start_date)
       or (v_promotion.end_date is not null and now() > v_promotion.end_date)
       or (coalesce(v_promotion.channel, 'both') not in ('fnb', 'both'))
       or (cardinality(coalesce(v_promotion.branch_ids, '{}'::uuid[])) > 0
           and not (v_order.branch_id = any(v_promotion.branch_ids)))
       or (v_promotion.usage_limit is not null
           and v_promotion.usage_count >= v_promotion.usage_limit) then
      raise exception using errcode = '22023', message = 'FNB_PROMOTION_NOT_AVAILABLE';
    end if;
    if (v_promotion.time_start is null) <> (v_promotion.time_end is null) then
      raise exception using errcode = '22023', message = 'FNB_PROMOTION_TIME_CONFIG_INVALID';
    end if;
    if v_promotion.time_start is not null
       and ((v_promotion.time_start <= v_promotion.time_end
             and not (v_local_time between v_promotion.time_start and v_promotion.time_end))
            or (v_promotion.time_start > v_promotion.time_end
                and not (v_local_time >= v_promotion.time_start or v_local_time <= v_promotion.time_end))) then
      raise exception using errcode = '22023', message = 'FNB_PROMOTION_TIME_NOT_AVAILABLE';
    end if;
    if cardinality(coalesce(v_promotion.days_of_week, '{}'::integer[])) > 0
       and not (v_local_dow = any(v_promotion.days_of_week)) then
      raise exception using errcode = '22023', message = 'FNB_PROMOTION_DAY_NOT_AVAILABLE';
    end if;

    select
      coalesce(sum(koi.quantity * koi.unit_price), 0),
      coalesce(sum(koi.quantity), 0)
      into v_promotion_eligible_subtotal, v_promotion_eligible_quantity
      from public.kitchen_order_items koi
      join public.products pr
        on pr.id = koi.product_id and pr.tenant_id = v_tenant_id
     where koi.kitchen_order_id = v_order.id
       and (
         v_promotion.applies_to = 'all'
         or (v_promotion.applies_to = 'product'
             and koi.product_id = any(coalesce(v_promotion.applies_to_ids, '{}'::uuid[])))
         or (v_promotion.applies_to = 'category'
             and pr.category_id = any(coalesce(v_promotion.applies_to_ids, '{}'::uuid[])))
       );
    if v_menu_subtotal < coalesce(v_promotion.min_order_amount, 0)
       or v_promotion_eligible_subtotal <= 0 then
      raise exception using errcode = '22023', message = 'FNB_PROMOTION_NOT_APPLICABLE';
    end if;
    case v_promotion.type
      when 'discount_percent' then
        if coalesce(v_promotion.value, 0) <= 0 then
          raise exception using errcode = '22023', message = 'FNB_PROMOTION_VALUE_INVALID';
        end if;
        v_promotion_discount := round(v_promotion_eligible_subtotal * v_promotion.value / 100, 0);
      when 'discount_fixed' then
        if coalesce(v_promotion.value, 0) <= 0 then
          raise exception using errcode = '22023', message = 'FNB_PROMOTION_VALUE_INVALID';
        end if;
        v_promotion_discount := least(v_promotion.value, v_promotion_eligible_subtotal);
      when 'buy_x_get_y' then
        if coalesce(v_promotion.buy_quantity, 0) <= 0
           or coalesce(v_promotion.get_quantity, 0) <= 0
           or v_promotion_eligible_quantity < v_promotion.buy_quantity then
          raise exception using errcode = '22023', message = 'FNB_PROMOTION_NOT_APPLICABLE';
        end if;

        -- Match the existing promotion engine: every whole eligible unit is
        -- considered and the cheapest units are free. No browser-supplied
        -- discount can influence this calculation.
        select coalesce(sum(free_unit.unit_price), 0)
          into v_promotion_discount
          from (
            select koi.unit_price
              from public.kitchen_order_items koi
              join public.products pr
                on pr.id = koi.product_id and pr.tenant_id = v_tenant_id
              cross join lateral generate_series(
                1,
                greatest(0, floor(koi.quantity)::integer)
              )
             where koi.kitchen_order_id = v_order.id
               and (
                 v_promotion.applies_to = 'all'
                 or (v_promotion.applies_to = 'product'
                     and koi.product_id = any(coalesce(v_promotion.applies_to_ids, '{}'::uuid[])))
                 or (v_promotion.applies_to = 'category'
                     and pr.category_id = any(coalesce(v_promotion.applies_to_ids, '{}'::uuid[])))
               )
             order by koi.unit_price
             limit (
               floor(v_promotion_eligible_quantity / v_promotion.buy_quantity)::integer
               * v_promotion.get_quantity
             )
          ) free_unit;
        v_promotion_free_value := v_promotion_discount;
      when 'gift' then
        -- F&B does not yet create and consume a gifted kitchen line atomically.
        -- Reject this configuration rather than recording a gift that was not
        -- issued or consumed from inventory.
        raise exception using errcode = '22023', message = 'FNB_PROMOTION_TYPE_NOT_SUPPORTED';
      else
        raise exception using errcode = '22023', message = 'FNB_PROMOTION_TYPE_NOT_SUPPORTED';
    end case;
  end if;

  if v_coupon_code is not null then
    select c.* into v_coupon
      from public.coupons c
     where c.tenant_id = v_tenant_id
       and upper(c.code) = v_coupon_code
     for update;
    if not found then
      raise exception using errcode = '22023', message = 'FNB_COUPON_NOT_FOUND';
    end if;
    if not v_coupon.is_active
       or (v_coupon.start_date is not null and now() < v_coupon.start_date)
       or (v_coupon.end_date is not null and now() > v_coupon.end_date)
       or (v_coupon.max_uses is not null and v_coupon.used_count >= v_coupon.max_uses) then
      raise exception using errcode = '22023', message = 'FNB_COUPON_NOT_AVAILABLE';
    end if;
    if p_customer_id is not null and v_coupon.max_uses_per_customer is not null then
      select count(*) into v_customer_uses
        from public.coupon_usages cu
       where cu.tenant_id = v_tenant_id
         and cu.coupon_id = v_coupon.id
         and cu.customer_id = p_customer_id;
      if v_customer_uses >= v_coupon.max_uses_per_customer then
        raise exception using errcode = '22023', message = 'FNB_COUPON_PER_CUSTOMER_EXCEEDED';
      end if;
    end if;
    if v_coupon.applies_to = 'all' then
      v_coupon_eligible_subtotal := v_order_subtotal;
    else
      select coalesce(sum(koi.quantity * koi.unit_price), 0)
        into v_coupon_eligible_subtotal
        from public.kitchen_order_items koi
        join public.products pr
          on pr.id = koi.product_id and pr.tenant_id = v_tenant_id
       where koi.kitchen_order_id = v_order.id
         and (
           (v_coupon.applies_to = 'product'
            and koi.product_id = any(coalesce(v_coupon.applies_to_ids, '{}'::uuid[])))
           or (v_coupon.applies_to = 'category'
               and pr.category_id = any(coalesce(v_coupon.applies_to_ids, '{}'::uuid[])))
         );
    end if;
    if v_order_subtotal < coalesce(v_coupon.min_order_amount, 0)
       or v_coupon_eligible_subtotal <= 0 then
      raise exception using errcode = '22023', message = 'FNB_COUPON_NOT_APPLICABLE';
    end if;
    case v_coupon.type
      when 'percent' then
        if coalesce(v_coupon.value, 0) <= 0 then
          raise exception using errcode = '22023', message = 'FNB_COUPON_VALUE_INVALID';
        end if;
        v_coupon_discount := round(v_coupon_eligible_subtotal * v_coupon.value / 100, 0);
        if v_coupon.max_discount_amount is not null then
          v_coupon_discount := least(v_coupon_discount, v_coupon.max_discount_amount);
        end if;
      when 'fixed' then
        if coalesce(v_coupon.value, 0) <= 0 then
          raise exception using errcode = '22023', message = 'FNB_COUPON_VALUE_INVALID';
        end if;
        v_coupon_discount := least(v_coupon.value, v_coupon_eligible_subtotal);
      else
        raise exception using errcode = '22023', message = 'FNB_COUPON_TYPE_INVALID';
    end case;
  end if;

  v_total_discount := v_manual_discount + v_promotion_discount + v_coupon_discount;
  if v_order.discount_amount + v_total_discount > v_order_subtotal then
    raise exception using errcode = '22023', message = 'FNB_TOTAL_DISCOUNT_EXCEEDS_ORDER';
  end if;

  -- Keep this in lockstep with the 00230 core before handing it any money.
  -- `p_paid` is cash tendered by the client, while the core must persist only
  -- the settled amount. This prevents change from being recorded as revenue.
  v_expected_gross := v_order_subtotal
    - v_order.discount_amount
    - v_total_discount
    + v_order.delivery_fee
    + coalesce(p_tip_amount, 0);
  v_expected_commission := round(v_expected_gross * v_order.platform_commission_percent / 100, 0);
  v_expected_total := greatest(0, v_expected_gross - v_expected_commission);
  v_paid_to_record := p_paid;
  v_breakdown_to_record := p_payment_breakdown;
  v_tendered_to_display := p_paid;

  if v_expected_commission = 0 then
    if p_payment_method = 'cash' then
      v_paid_to_record := least(p_paid, v_expected_total);
    elsif p_payment_method = 'mixed' and p_paid > v_expected_total then
      v_change := p_paid - v_expected_total;
      select coalesce(sum((item->>'amount')::numeric), 0)
        into v_cash_tendered
        from jsonb_array_elements(p_payment_breakdown) item
       where item->>'method' = 'cash';
      if v_cash_tendered < v_change then
        raise exception using errcode = '22023', message = 'FNB_PAYMENT_AMOUNT_CHANGED';
      end if;
      select coalesce(jsonb_agg(jsonb_build_object(
        'method', item->>'method',
        'amount', case
          when item->>'method' = 'cash'
            then (item->>'amount')::numeric - v_change
          else (item->>'amount')::numeric
        end
      ) order by item->>'method'), '[]'::jsonb)
        into v_breakdown_to_record
        from jsonb_array_elements(p_payment_breakdown) item;
      v_paid_to_record := v_expected_total;
    elsif p_payment_method in ('transfer', 'card') and p_paid > v_expected_total then
      raise exception using errcode = '22023', message = 'FNB_PAYMENT_AMOUNT_CHANGED';
    end if;

    if v_paid_to_record < v_expected_total and not coalesce(p_allow_debt, false) then
      raise exception using errcode = '22023', message = 'FNB_DEBT_CONFIRMATION_REQUIRED';
    end if;
  end if;
  v_change_to_display := greatest(0, v_tendered_to_display - v_paid_to_record);
  if v_expected_commission > 0 then
    -- Orders from delivery platforms are settled by the platform, not cash tender.
    v_tendered_to_display := v_expected_total;
    v_change_to_display := 0;
  end if;

  -- The proven 00230 core owns invoice, stock, cash and BOM changes.
  -- V3 mirrors 00274's narrow split-table guard below so a manager-approved
  -- discount does not release a table while another split bill is unpaid.
  v_result := public._fnb_complete_payment_impl_00230(
    v_order.id,
    p_customer_id,
    coalesce(nullif(trim(p_customer_name), ''), 'Khách lẻ'),
    p_payment_method,
    v_breakdown_to_record,
    v_paid_to_record,
    v_total_discount,
    p_note,
    v_actor,
    p_shift_id,
    coalesce(p_tip_amount, 0)
  );
  v_invoice_id := nullif(v_result->>'invoice_id', '')::uuid;
  if v_invoice_id is null then
    raise exception using errcode = 'P0001', message = 'INVALID_PAYMENT_RESULT';
  end if;

  -- The receipt must use the persisted result, not a browser preview that may
  -- have become stale while promotion or coupon configuration changed.
  select i.total, i.paid, i.debt, i.discount_amount, i.platform_commission
    into v_invoice_total, v_invoice_paid, v_invoice_debt,
         v_invoice_discount_amount, v_invoice_commission_amount
    from public.invoices i
   where i.id = v_invoice_id
     and i.tenant_id = v_tenant_id
     and i.deleted_at is null;
  if not found then
    raise exception using errcode = 'P0001', message = 'PAID_INVOICE_NOT_FOUND';
  end if;

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

  if p_promotion_id is not null then
    perform public.increment_promotion_usage(p_promotion_id);
    update public.invoices
       set promotion_id = p_promotion_id,
           promotion_discount = v_promotion_discount,
           promotion_free_value = v_promotion_free_value
     where id = v_invoice_id and tenant_id = v_tenant_id;
  end if;
  if v_coupon_code is not null then
    perform public.apply_coupon_atomic(
      v_coupon.code, v_invoice_id, p_customer_id, v_coupon_discount, v_tenant_id
    );
  end if;
  if p_customer_id is not null then
    perform public.earn_loyalty_points(
      p_customer_id, v_invoice_id, coalesce((v_result->>'total')::numeric, 0)
    );
  end if;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_tenant_id,
    v_actor,
    'fnb_checkout_benefits_server_calculated',
    'invoice',
    v_invoice_id,
    jsonb_build_object(
      'kitchen_order_id', v_order.id,
      'manual_discount_amount', v_manual_discount,
      'manual_discount_otp_id', p_manual_discount_otp_id,
      'manual_discount_reason', nullif(trim(coalesce(p_manual_discount_reason, '')), ''),
      'manual_discount_approved_by', v_manual_discount_approver,
      'promotion_id', p_promotion_id,
      'promotion_discount', v_promotion_discount,
      'promotion_free_value', v_promotion_free_value,
      'coupon_code', v_coupon_code,
      'coupon_discount', v_coupon_discount,
      'paid_tendered', p_paid,
      'paid_recorded', v_paid_to_record,
      'change_amount', v_change_to_display,
      'allow_debt', coalesce(p_allow_debt, false),
      'benefit_authority', 'server'
    )
  );

  return v_result || jsonb_build_object(
    'total', v_invoice_total,
    'paid', v_invoice_paid,
    'debt', v_invoice_debt,
    'tendered_amount', v_tendered_to_display,
    'change_amount', v_change_to_display,
    'discount_amount', v_invoice_discount_amount,
    'platform_commission_amount', v_invoice_commission_amount,
    'promotion_id', p_promotion_id,
    'promotion_discount', v_promotion_discount,
    'promotion_free_value', v_promotion_free_value,
    'coupon_code', v_coupon_code,
    'coupon_discount', v_coupon_discount,
    'benefits_applied', true,
    'benefit_authority', 'server'
  );
end;
$$;

comment on function public.fnb_complete_payment_atomic_v3(
  uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text
) is '00343 phase A: F&B checkout calculates promotion/coupon values on the server. A later, separately released phase revokes legacy payment helpers only after the V3 client is verified live.';

revoke all on function public.fnb_complete_payment_atomic_v3(
  uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text
) from public, anon;
grant execute on function public.fnb_complete_payment_atomic_v3(
  uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text
) to authenticated;

commit;
notify pgrst, 'reload schema';
