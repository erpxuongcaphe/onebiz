-- ============================================================
-- 00253: Harden retail POS pricing, discounts and final totals
--
-- Existing invoices and customer balances are not modified. Any legacy balance
-- difference is snapshotted once into the adjustment ledger before new RPCs apply.
-- ============================================================

-- Durable customer credit ledger. Creating the table does not alter existing balances.
create table if not exists public.customer_debt_adjustments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  invoice_id uuid references public.invoices(id) on delete restrict,
  amount numeric(15,2) not null check (amount <> 0),
  reason text not null,
  idempotency_key text not null,
  created_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (tenant_id, idempotency_key)
);

create index if not exists idx_customer_debt_adjustments_customer
  on public.customer_debt_adjustments(tenant_id, customer_id, created_at desc);

alter table public.customer_debt_adjustments enable row level security;
drop policy if exists customer_debt_adjustments_select on public.customer_debt_adjustments;
create policy customer_debt_adjustments_select
  on public.customer_debt_adjustments
  for select
  using (tenant_id = public.get_user_tenant_id());

revoke insert, update, delete on public.customer_debt_adjustments
  from public, anon, authenticated;
grant select on public.customer_debt_adjustments to authenticated;

-- Preserve any legacy manual balance/credit exactly as currently displayed.
-- Source invoices and customers are not modified; the difference is snapshotted once.
insert into public.customer_debt_adjustments (
  tenant_id, customer_id, amount, reason, idempotency_key, created_by
)
select
  c.tenant_id,
  c.id,
  round(coalesce(c.debt, 0) - coalesce(inv.invoice_debt, 0), 2),
  'Số dư chuyển tiếp trước khi dùng sổ phát sinh công nợ',
  'legacy-balance:' || c.id::text,
  null
from public.customers c
left join lateral (
  select coalesce(sum(greatest(0, i.debt)), 0) as invoice_debt
  from public.invoices i
  where i.tenant_id = c.tenant_id
    and i.customer_id = c.id
    and i.status = 'completed'
    and i.deleted_at is null
) inv on true
where abs(coalesce(c.debt, 0) - coalesce(inv.invoice_debt, 0)) > 0.01
on conflict (tenant_id, idempotency_key) do nothing;

create or replace function public.recompute_customer_debt(p_customer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_invoice_debt numeric;
  v_adjustment numeric;
begin
  if p_customer_id is null then return; end if;

  select c.tenant_id
  into v_tenant_id
  from public.customers c
  where c.id = p_customer_id;
  if not found then return; end if;

  select coalesce(sum(greatest(0, i.debt)), 0)
  into v_invoice_debt
  from public.invoices i
  where i.tenant_id = v_tenant_id
    and i.customer_id = p_customer_id
    and i.status = 'completed'
    and i.deleted_at is null;

  select coalesce(sum(a.amount), 0)
  into v_adjustment
  from public.customer_debt_adjustments a
  where a.tenant_id = v_tenant_id
    and a.customer_id = p_customer_id;

  update public.customers
  set debt = v_invoice_debt + v_adjustment,
      updated_at = now()
  where id = p_customer_id
    and tenant_id = v_tenant_id;
end;
$$;

revoke all on function public.recompute_customer_debt(uuid)
  from public, anon, authenticated;
grant execute on function public.recompute_customer_debt(uuid) to service_role;

create or replace function public.trg_sync_customer_debt_adjustment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.recompute_customer_debt(old.customer_id);
    return old;
  end if;
  if tg_op = 'UPDATE' and old.customer_id is distinct from new.customer_id then
    perform public.recompute_customer_debt(old.customer_id);
  end if;
  perform public.recompute_customer_debt(new.customer_id);
  return new;
end;
$$;

revoke all on function public.trg_sync_customer_debt_adjustment()
  from public, anon, authenticated;

drop trigger if exists trg_customer_debt_adjustments_sync
  on public.customer_debt_adjustments;
create trigger trg_customer_debt_adjustments_sync
after insert or update or delete on public.customer_debt_adjustments
for each row execute function public.trg_sync_customer_debt_adjustment();

create or replace function public.pos_prepare_retail_checkout(
  p_tenant_id uuid,
  p_actor uuid,
  p_branch_id uuid,
  p_customer_id uuid,
  p_items jsonb,
  p_order_discount_source text default null,
  p_order_discount numeric default 0,
  p_promotion_id uuid default null,
  p_coupon_code text default null,
  p_loyalty_points integer default 0,
  p_discount_otp_id uuid default null,
  p_shipping_fee numeric default 0,
  p_order_vat_rate numeric default 0
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer record;
  v_item jsonb;
  v_product record;
  v_variant record;
  v_variant_id uuid;
  v_qty numeric;
  v_submitted_price numeric;
  v_expected_price numeric;
  v_effective_price numeric;
  v_line_discount numeric;
  v_line_gross numeric;
  v_line_net numeric;
  v_subtotal numeric := 0;
  v_line_discount_total numeric := 0;
  v_after_line_discount numeric;
  v_order_discount numeric := 0;
  v_promotion_discount numeric := 0;
  v_promotion_free_value numeric := 0;
  v_coupon_discount numeric := 0;
  v_loyalty_discount numeric := 0;
  v_loyalty_effective_points integer := 0;
  v_group_discount numeric := 0;
  v_tax_amount numeric := 0;
  v_order_vat_amount numeric := 0;
  v_total numeric := 0;
  v_trusted_items jsonb := '[]'::jsonb;
  v_price_overrides jsonb := '[]'::jsonb;
  v_has_manual_discount boolean := false;
  v_coupon jsonb;
  v_promotion record;
  v_eligible_subtotal numeric := 0;
  v_eligible_qty numeric := 0;
  v_loyalty record;
  v_discount_scale numeric := 1;
  v_source text := nullif(trim(coalesce(p_order_discount_source, '')), '');
  v_now_vn timestamp := timezone('Asia/Ho_Chi_Minh', now());
begin
  if p_promotion_id is not null and v_source not in ('promotion', 'promotion_redeem') then
    raise exception using errcode = '22023', message = 'POS_PROMOTION_SOURCE_INVALID';
  end if;
  if nullif(trim(coalesce(p_coupon_code, '')), '') is not null and v_source <> 'coupon' then
    raise exception using errcode = '22023', message = 'POS_COUPON_SOURCE_INVALID';
  end if;
  if coalesce(p_loyalty_points, 0) > 0 and v_source not in ('redeem', 'promotion_redeem') then
    raise exception using errcode = '22023', message = 'POS_LOYALTY_SOURCE_INVALID';
  end if;

  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception using errcode = '22023', message = 'POS_ITEMS_INVALID';
  end if;
  if coalesce(p_order_discount, 0) < 0 then
    raise exception using errcode = '22023', message = 'POS_DISCOUNT_INVALID';
  end if;
  if coalesce(p_shipping_fee, 0) < 0 then
    raise exception using errcode = '22023', message = 'POS_SHIPPING_FEE_INVALID';
  end if;
  if coalesce(p_order_vat_rate, 0) not in (0, 5, 8, 10) then
    raise exception using errcode = '22023', message = 'POS_ORDER_VAT_INVALID';
  end if;

  if p_customer_id is not null then
    select
      c.id,
      c.name,
      c.group_id,
      c.price_tier_id,
      c.loyalty_points,
      coalesce(cg.discount_percent, 0) as group_discount_percent
    into v_customer
    from public.customers c
    left join public.customer_groups cg
      on cg.id = c.group_id
     and cg.tenant_id = p_tenant_id
    where c.id = p_customer_id
      and c.tenant_id = p_tenant_id
      and c.is_active = true;

    if not found then
      raise exception using errcode = '22023', message = 'POS_CUSTOMER_INVALID';
    end if;
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    begin
      v_variant_id := nullif(v_item->>'variantId', '')::uuid;
      v_qty := (v_item->>'quantity')::numeric;
      v_submitted_price := (v_item->>'unitPrice')::numeric;
      v_line_discount := coalesce((v_item->>'discount')::numeric, 0);
    exception when others then
      raise exception using errcode = '22023', message = 'POS_ITEM_FORMAT_INVALID';
    end;

    if v_qty <= 0 or v_submitted_price < 0 or v_line_discount < 0 then
      raise exception using errcode = '22023', message = 'POS_ITEM_VALUE_INVALID';
    end if;

    select
      p.id,
      p.name,
      p.unit,
      p.sell_price,
      p.vat_rate,
      p.category_id
    into v_product
    from public.products p
    where p.id = nullif(v_item->>'productId', '')::uuid
      and p.tenant_id = p_tenant_id
      and p.is_active = true
      and p.status = 'active'
      and p.allow_sale = true;

    if not found then
      raise exception using errcode = '22023', message = 'POS_PRODUCT_INVALID';
    end if;

    v_expected_price := v_product.sell_price;
    if v_variant_id is not null then
      select pv.id, pv.name, pv.sell_price
      into v_variant
      from public.product_variants pv
      where pv.id = v_variant_id
        and pv.tenant_id = p_tenant_id
        and pv.product_id = v_product.id
        and pv.is_active = true;

      if not found then
        raise exception using errcode = '22023', message = 'POS_VARIANT_INVALID';
      end if;
      v_expected_price := v_variant.sell_price;
    end if;

    if p_customer_id is not null and v_customer.price_tier_id is not null then
      select pti.price
      into v_expected_price
      from public.price_tier_items pti
      join public.price_tiers pt
        on pt.id = pti.price_tier_id
       and pt.tenant_id = p_tenant_id
       and pt.is_active = true
      where pti.price_tier_id = v_customer.price_tier_id
        and pti.product_id = v_product.id
        and pti.variant_id is not distinct from v_variant_id
        and pti.min_qty <= v_qty
      order by pti.min_qty desc, pti.created_at desc
      limit 1;

      if not found then
        v_expected_price := case
          when v_variant_id is null then v_product.sell_price
          else v_variant.sell_price
        end;
      end if;
    end if;

    if abs(v_submitted_price - v_expected_price) > 0.01 then
      if not public.user_has_permission(p_actor, 'pos_retail.edit_price') then
        raise exception using
          errcode = '22023',
          message = 'POS_PRICE_CHANGED',
          detail = jsonb_build_object(
            'productId', v_product.id,
            'variantId', v_variant_id,
            'productName', v_product.name,
            'expectedPrice', v_expected_price
          )::text;
      end if;
      v_effective_price := v_submitted_price;
      v_price_overrides := v_price_overrides || jsonb_build_object(
        'product_id', v_product.id,
        'variant_id', v_variant_id,
        'expected_price', v_expected_price,
        'applied_price', v_submitted_price
      );
    else
      v_effective_price := v_expected_price;
    end if;

    v_line_gross := round(v_qty * v_effective_price, 2);
    if v_line_discount > v_line_gross then
      raise exception using errcode = '22023', message = 'POS_LINE_DISCOUNT_INVALID';
    end if;
    if v_line_discount > 0 then
      v_has_manual_discount := true;
    end if;

    v_subtotal := v_subtotal + v_line_gross;
    v_line_discount_total := v_line_discount_total + v_line_discount;

    v_trusted_items := v_trusted_items || jsonb_build_object(
      'productId', v_product.id,
      'variantId', v_variant_id,
      'productName', case
        when v_variant_id is null then v_product.name
        else v_product.name || ' · ' || v_variant.name
      end,
      'unit', v_product.unit,
      'quantity', v_qty,
      'unitPrice', v_effective_price,
      'discount', v_line_discount,
      'vatRate', coalesce(v_product.vat_rate, 0),
      'categoryId', v_product.category_id,
      'note', nullif(trim(coalesce(v_item->>'note', '')), '')
    );
  end loop;

  v_after_line_discount := greatest(0, v_subtotal - v_line_discount_total);

  if v_source = 'manual' then
    v_order_discount := greatest(0, coalesce(p_order_discount, 0));
  elsif v_source = 'customer_group' then
    if p_customer_id is null then
      raise exception using errcode = '22023', message = 'POS_CUSTOMER_DISCOUNT_INVALID';
    end if;
    v_group_discount := round(
      v_after_line_discount * coalesce(v_customer.group_discount_percent, 0) / 100
    );
    v_order_discount := v_group_discount;
  elsif v_source in ('promotion', 'promotion_redeem') then
    if p_promotion_id is null then
      raise exception using errcode = '22023', message = 'POS_PROMOTION_INVALID';
    end if;

    select *
    into v_promotion
    from public.promotions p
    where p.id = p_promotion_id
      and p.tenant_id = p_tenant_id
      and p.is_active = true
      and p.start_date <= now()
      and p.end_date >= now()
      and p.channel in ('retail', 'both')
      and (coalesce(array_length(p.branch_ids, 1), 0) = 0 or p_branch_id = any(p.branch_ids))
      and (p.usage_limit is null or p.usage_count < p.usage_limit)
      and (
        coalesce(array_length(p.days_of_week, 1), 0) = 0
        or extract(dow from v_now_vn)::integer = any(p.days_of_week)
      )
      and (
        p.time_start is null
        or p.time_end is null
        or case
          when p.time_start <= p.time_end
            then v_now_vn::time between p.time_start and p.time_end
          else v_now_vn::time >= p.time_start or v_now_vn::time <= p.time_end
        end
      );

    if not found or v_subtotal < coalesce(v_promotion.min_order_amount, 0) then
      raise exception using errcode = '22023', message = 'POS_PROMOTION_INVALID';
    end if;

    select
      coalesce(sum(
        case
          when v_promotion.applies_to = 'all' then
            (x->>'quantity')::numeric * (x->>'unitPrice')::numeric
          when v_promotion.applies_to = 'product'
               and (x->>'productId')::uuid = any(v_promotion.applies_to_ids) then
            (x->>'quantity')::numeric * (x->>'unitPrice')::numeric
          when v_promotion.applies_to = 'category'
               and nullif(x->>'categoryId', '')::uuid = any(v_promotion.applies_to_ids) then
            (x->>'quantity')::numeric * (x->>'unitPrice')::numeric
          else 0
        end
      ), 0),
      coalesce(sum(
        case
          when v_promotion.applies_to = 'all' then (x->>'quantity')::numeric
          when v_promotion.applies_to = 'product'
               and (x->>'productId')::uuid = any(v_promotion.applies_to_ids) then
            (x->>'quantity')::numeric
          when v_promotion.applies_to = 'category'
               and nullif(x->>'categoryId', '')::uuid = any(v_promotion.applies_to_ids) then
            (x->>'quantity')::numeric
          else 0
        end
      ), 0)
    into v_eligible_subtotal, v_eligible_qty
    from jsonb_array_elements(v_trusted_items) x;

    if v_eligible_subtotal <= 0 then
      raise exception using errcode = '22023', message = 'POS_PROMOTION_NOT_APPLICABLE';
    end if;

    if v_promotion.type = 'discount_percent' then
      v_promotion_discount := round(v_eligible_subtotal * v_promotion.value / 100);
    elsif v_promotion.type = 'discount_fixed' then
      v_promotion_discount := least(v_promotion.value, v_eligible_subtotal);
    elsif v_promotion.type = 'buy_x_get_y' then
      if coalesce(v_promotion.buy_quantity, 0) <= 0
         or coalesce(v_promotion.get_quantity, 0) <= 0
         or v_eligible_qty < v_promotion.buy_quantity then
        raise exception using errcode = '22023', message = 'POS_PROMOTION_NOT_APPLICABLE';
      end if;
      select coalesce(sum(unit_price), 0)
      into v_promotion_discount
      from (
        select (x->>'unitPrice')::numeric as unit_price
        from jsonb_array_elements(v_trusted_items) x
        cross join lateral generate_series(
          1,
          greatest(0, floor((x->>'quantity')::numeric)::integer)
        )
        where
          v_promotion.applies_to = 'all'
          or (
            v_promotion.applies_to = 'product'
            and (x->>'productId')::uuid = any(v_promotion.applies_to_ids)
          )
          or (
            v_promotion.applies_to = 'category'
            and nullif(x->>'categoryId', '')::uuid = any(v_promotion.applies_to_ids)
          )
        order by (x->>'unitPrice')::numeric
        limit (
          floor(v_eligible_qty / v_promotion.buy_quantity)::integer
          * v_promotion.get_quantity
        )
      ) free_units;
      v_promotion_free_value := v_promotion_discount;
    elsif v_promotion.type = 'gift' then
      v_promotion_discount := 0;
      v_promotion_free_value := 0;
    else
      raise exception using errcode = '22023', message = 'POS_PROMOTION_TYPE_INVALID';
    end if;
    v_order_discount := v_promotion_discount;
  elsif v_source = 'coupon' then
    if nullif(trim(coalesce(p_coupon_code, '')), '') is null then
      raise exception using errcode = '22023', message = 'POS_COUPON_INVALID';
    end if;
    v_coupon := public.validate_coupon(
      p_coupon_code,
      v_subtotal,
      p_customer_id
    );
    if not coalesce((v_coupon->>'valid')::boolean, false) then
      raise exception using
        errcode = '22023',
        message = 'POS_COUPON_INVALID',
        detail = coalesce(v_coupon->>'error', 'Coupon invalid');
    end if;
    v_coupon_discount := coalesce((v_coupon->>'discount_amount')::numeric, 0);
    v_order_discount := v_coupon_discount;
  elsif v_source = 'redeem' then
    v_order_discount := 0;
  elsif v_source is not null then
    raise exception using errcode = '22023', message = 'POS_DISCOUNT_SOURCE_INVALID';
  end if;

  if v_source in ('redeem', 'promotion_redeem') then
    if p_customer_id is null or coalesce(p_loyalty_points, 0) <= 0 then
      raise exception using errcode = '22023', message = 'POS_LOYALTY_INVALID';
    end if;
    select *
    into v_loyalty
    from public.loyalty_settings ls
    where ls.tenant_id = p_tenant_id
      and ls.is_enabled = true;
    if not found
       or v_loyalty.redemption_points <= 0
       or v_loyalty.redemption_value <= 0
       or v_customer.loyalty_points < p_loyalty_points then
      raise exception using errcode = '22023', message = 'POS_LOYALTY_INVALID';
    end if;
    v_loyalty_effective_points :=
      floor(p_loyalty_points::numeric / v_loyalty.redemption_points)::integer
      * v_loyalty.redemption_points;
    v_loyalty_discount := least(
      floor(v_loyalty_effective_points::numeric / v_loyalty.redemption_points)
        * v_loyalty.redemption_value,
      floor(v_subtotal * v_loyalty.max_redemption_percent / 100)
    );
    if v_loyalty_discount <= 0 then
      raise exception using errcode = '22023', message = 'POS_LOYALTY_INVALID';
    end if;
    v_order_discount := v_order_discount + v_loyalty_discount;
  end if;

  if v_source = 'manual' then
    v_has_manual_discount := v_has_manual_discount or v_order_discount > 0;
  elsif abs(coalesce(p_order_discount, 0) - v_order_discount) > 0.01 then
    raise exception using
      errcode = '22023',
      message = 'POS_DISCOUNT_CHANGED',
      detail = jsonb_build_object(
        'expectedDiscount', v_order_discount,
        'submittedDiscount', coalesce(p_order_discount, 0)
      )::text;
  end if;

  if v_has_manual_discount then
    perform public.verify_otp_authorization(
      p_discount_otp_id,
      'pos_retail.discount_override',
      p_actor,
      null
    );
  end if;

  v_order_discount := least(v_order_discount, v_after_line_discount);
  if v_after_line_discount > 0 then
    v_discount_scale :=
      greatest(0, (v_after_line_discount - v_order_discount) / v_after_line_discount);
  end if;

  select coalesce(sum(
    round(
      (
        ((x->>'quantity')::numeric * (x->>'unitPrice')::numeric)
        - (x->>'discount')::numeric
      ) * v_discount_scale * (x->>'vatRate')::numeric / 100
    )
  ), 0)
  into v_tax_amount
  from jsonb_array_elements(v_trusted_items) x;

  v_order_vat_amount := ceil(
    greatest(
      0,
      v_after_line_discount - v_order_discount
      + v_tax_amount
      + coalesce(p_shipping_fee, 0)
    ) * coalesce(p_order_vat_rate, 0) / 100
  );
  v_tax_amount := v_tax_amount + v_order_vat_amount;
  v_total := greatest(
    0,
    v_after_line_discount - v_order_discount
    + v_tax_amount
    + coalesce(p_shipping_fee, 0)
  );

  return jsonb_build_object(
    'items', v_trusted_items,
    'subtotal', v_subtotal,
    'line_discount', v_line_discount_total,
    'order_discount', v_order_discount,
    'discount_amount', v_line_discount_total + v_order_discount,
    'tax_amount', v_tax_amount,
    'discount_scale', v_discount_scale,
    'order_vat_amount', v_order_vat_amount,
    'shipping_fee', coalesce(p_shipping_fee, 0),
    'total', v_total,
    'promotion_discount', v_promotion_discount,
    'promotion_free_value', v_promotion_free_value,
    'coupon_discount', v_coupon_discount,
    'loyalty_discount', v_loyalty_discount,
    'loyalty_effective_points', v_loyalty_effective_points,
    'price_overrides', v_price_overrides,
    'customer_name', case
      when p_customer_id is null then 'Khách lẻ'
      else v_customer.name
    end
  );
end;
$$;

revoke all on function public.pos_prepare_retail_checkout(
  uuid, uuid, uuid, uuid, jsonb, text, numeric, uuid, text, integer, uuid, numeric, numeric
) from public, anon, authenticated;
grant execute on function public.pos_prepare_retail_checkout(
  uuid, uuid, uuid, uuid, jsonb, text, numeric, uuid, text, integer, uuid, numeric, numeric
) to service_role;

create or replace function public.pos_complete_checkout_atomic_v3(
  p_branch_id uuid,
  p_customer_id uuid default null,
  p_items jsonb default '[]'::jsonb,
  p_payment_method text default 'cash',
  p_payment_breakdown jsonb default null,
  p_paid numeric default 0,
  p_note text default null,
  p_source text default 'pos',
  p_shift_id uuid default null,
  p_promotion_id uuid default null,
  p_coupon_code text default null,
  p_loyalty_points integer default 0,
  p_discount_source text default null,
  p_order_discount numeric default 0,
  p_discount_otp_id uuid default null,
  p_discount_reason text default null,
  p_shipping_fee numeric default 0,
  p_order_vat_rate numeric default 0,
  p_client_session_id text default null,
  p_allow_bom_shortage boolean default false,
  p_amount_tendered numeric default null,
  p_customer_credit numeric default 0
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid := public.get_user_tenant_id();
  v_prepared jsonb;
  v_result jsonb;
  v_invoice_id uuid;
  v_total numeric;
  v_existing record;
  v_breakdown_total numeric;
begin
  if v_actor is null or v_tenant_id is null then
    raise exception using errcode = '42501', message = 'POS_AUTH_REQUIRED';
  end if;
  if not public.user_has_permission(v_actor, 'pos_retail.checkout') then
    raise exception using errcode = '42501', message = 'POS_CHECKOUT_DENIED';
  end if;
  if not exists (
    select 1
    from public.branches b
    where b.id = p_branch_id
      and b.tenant_id = v_tenant_id
  ) or not public.user_has_branch_access(v_actor, p_branch_id) then
    raise exception using errcode = '42501', message = 'POS_BRANCH_DENIED';
  end if;

  if nullif(p_client_session_id, '') is not null then
    select i.id, i.code, i.status, i.total, i.paid, i.debt, i.branch_id
    into v_existing
    from public.invoices i
    where i.tenant_id = v_tenant_id
      and i.client_session_id = nullif(p_client_session_id, '')
      and i.deleted_at is null
    order by i.created_at desc
    limit 1;
    if found and v_existing.status = 'completed' then
      if v_existing.branch_id <> p_branch_id
         or not public.user_has_branch_access(v_actor, v_existing.branch_id) then
        raise exception using errcode = '42501', message = 'POS_SESSION_BRANCH_MISMATCH';
      end if;
      return jsonb_build_object(
        'invoice_id', v_existing.id,
        'invoice_code', v_existing.code,
        'total', v_existing.total,
        'paid', v_existing.paid,
        'debt', v_existing.debt,
        'customer_credit', coalesce((
          select -sum(a.amount)
          from public.customer_debt_adjustments a
          where a.tenant_id = v_tenant_id
            and a.invoice_id = v_existing.id
            and a.amount < 0
        ), 0),
        'idempotent', true
      );
    end if;
  end if;

  v_prepared := public.pos_prepare_retail_checkout(
    v_tenant_id,
    v_actor,
    p_branch_id,
    p_customer_id,
    p_items,
    p_discount_source,
    p_order_discount,
    p_promotion_id,
    p_coupon_code,
    p_loyalty_points,
    p_discount_otp_id,
    p_shipping_fee,
    p_order_vat_rate
  );
  v_total := (v_prepared->>'total')::numeric;

  if coalesce(p_customer_credit, 0) < 0 then
    raise exception using errcode = '22023', message = 'POS_CUSTOMER_CREDIT_INVALID';
  end if;
  if coalesce(p_customer_credit, 0) > 0 and p_customer_id is null then
    raise exception using errcode = '22023', message = 'POS_CUSTOMER_REQUIRED_FOR_CREDIT';
  end if;
  if coalesce(p_customer_credit, 0) > 0 and (
    p_amount_tendered is null
    or abs(p_customer_credit - greatest(p_amount_tendered - v_total, 0)) > 0.01
  ) then
    raise exception using errcode = '22023', message = 'POS_CUSTOMER_CREDIT_MISMATCH';
  end if;

  if p_payment_method not in ('cash', 'transfer', 'card', 'mixed')
     or coalesce(p_paid, 0) < 0
     or coalesce(p_paid, 0) > v_total + 0.01 then
    raise exception using errcode = '22023', message = 'POS_PAYMENT_INVALID';
  end if;
  if p_payment_method = 'mixed' and coalesce(p_paid, 0) > 0 then
    if p_payment_breakdown is null
       or jsonb_typeof(p_payment_breakdown) <> 'array'
       or jsonb_array_length(p_payment_breakdown) = 0 then
      raise exception using errcode = '22023', message = 'POS_PAYMENT_BREAKDOWN_INVALID';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_payment_breakdown) part
      where coalesce(part->>'method', '') not in ('cash', 'transfer', 'card')
         or coalesce((part->>'amount')::numeric, 0) <= 0
    ) then
      raise exception using errcode = '22023', message = 'POS_PAYMENT_BREAKDOWN_INVALID';
    end if;
    select coalesce(sum((part->>'amount')::numeric), 0)
    into v_breakdown_total
    from jsonb_array_elements(p_payment_breakdown) part;
    if abs(v_breakdown_total - p_paid) > 0.01 then
      raise exception using errcode = '22023', message = 'POS_PAYMENT_BREAKDOWN_MISMATCH';
    end if;
  end if;

  perform public.assert_pos_stock_available(
    v_tenant_id,
    p_branch_id,
    v_prepared->'items',
    p_allow_bom_shortage
  );

  v_result := public.pos_complete_checkout_atomic(
    v_tenant_id,
    p_branch_id,
    v_actor,
    p_customer_id,
    v_prepared->>'customer_name',
    v_prepared->'items',
    p_payment_method,
    p_payment_breakdown,
    (v_prepared->>'subtotal')::numeric,
    (v_prepared->>'discount_amount')::numeric,
    v_total,
    p_paid,
    p_note,
    case when p_source in ('pos', 'online') then p_source else 'pos' end,
    p_shift_id,
    p_promotion_id,
    (v_prepared->>'promotion_discount')::numeric,
    (v_prepared->>'promotion_free_value')::numeric,
    p_client_session_id
  );
  v_invoice_id := (v_result->>'invoice_id')::uuid;

  update public.invoice_items ii
  set variant_id = (
        select nullif(x->>'variantId', '')::uuid
        from jsonb_array_elements(v_prepared->'items') x
        where (x->>'productId')::uuid = ii.product_id
          and x->>'productName' = ii.product_name
        limit 1
      ),
      vat_rate = coalesce((
        select (x->>'vatRate')::numeric
        from jsonb_array_elements(v_prepared->'items') x
        where (x->>'productId')::uuid = ii.product_id
          and x->>'productName' = ii.product_name
        limit 1
      ), 0),
      vat_amount = round(
        (ii.quantity * ii.unit_price - ii.discount)
        * (v_prepared->>'discount_scale')::numeric
        * coalesce((
          select (x->>'vatRate')::numeric
          from jsonb_array_elements(v_prepared->'items') x
          where (x->>'productId')::uuid = ii.product_id
            and x->>'productName' = ii.product_name
          limit 1
        ), 0) / 100
      )
  where ii.invoice_id = v_invoice_id;

  update public.invoices
  set tax_amount = (v_prepared->>'tax_amount')::numeric,
      delivery_fee = (v_prepared->>'shipping_fee')::numeric,
      amount_tendered = case
        when p_amount_tendered is null then p_paid
        else greatest(p_paid, p_amount_tendered)
      end
  where id = v_invoice_id
    and tenant_id = v_tenant_id;

  if nullif(trim(coalesce(p_coupon_code, '')), '') is not null then
    perform public.apply_coupon_atomic(
      p_coupon_code,
      v_invoice_id,
      p_customer_id,
      (v_prepared->>'coupon_discount')::numeric,
      v_tenant_id
    );
  end if;
  if p_promotion_id is not null then
    perform public.increment_promotion_usage(p_promotion_id);
  end if;
  if (v_prepared->>'loyalty_effective_points')::integer > 0 then
    perform public.redeem_loyalty_points(
      p_customer_id,
      (v_prepared->>'loyalty_effective_points')::integer,
      v_invoice_id
    );
  end if;
  if p_customer_id is not null then
    perform public.earn_loyalty_points(p_customer_id, v_invoice_id, v_total);
  end if;

  if coalesce(p_customer_credit, 0) > 0 then
    insert into public.customer_debt_adjustments (
      tenant_id, customer_id, invoice_id, amount, reason, idempotency_key, created_by
    ) values (
      v_tenant_id, p_customer_id, v_invoice_id, -p_customer_credit,
      'Tiền thừa ghi số dư từ hóa đơn ' || coalesce(v_result->>'invoice_code', v_invoice_id::text),
      'pos-credit:' || v_invoice_id::text, v_actor
    )
    on conflict (tenant_id, idempotency_key) do nothing;
  end if;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_tenant_id,
    v_actor,
    'pos_checkout_completed',
    'invoice',
    v_invoice_id,
    jsonb_build_object(
      'total', v_total,
      'discount_source', p_discount_source,
      'discount_amount', (v_prepared->>'discount_amount')::numeric,
      'discount_reason', nullif(trim(coalesce(p_discount_reason, '')), ''),
      'price_overrides', v_prepared->'price_overrides',
      'promotion_id', p_promotion_id,
      'coupon_code', nullif(trim(coalesce(p_coupon_code, '')), ''),
      'loyalty_points', (v_prepared->>'loyalty_effective_points')::integer,
      'customer_credit', coalesce(p_customer_credit, 0)
    )
  );

  return v_result || jsonb_build_object(
    'total', v_total,
    'paid', p_paid,
    'debt', greatest(0, v_total - p_paid),
    'tax_amount', (v_prepared->>'tax_amount')::numeric,
    'discount_amount', (v_prepared->>'discount_amount')::numeric,
    'customer_credit', coalesce(p_customer_credit, 0)
  );
end;
$$;

revoke all on function public.pos_complete_checkout_atomic_v3(
  uuid, uuid, jsonb, text, jsonb, numeric, text, text, uuid, uuid, text,
  integer, text, numeric, uuid, text, numeric, numeric, text, boolean, numeric, numeric
) from public, anon;
grant execute on function public.pos_complete_checkout_atomic_v3(
  uuid, uuid, jsonb, text, jsonb, numeric, text, text, uuid, uuid, text,
  integer, text, numeric, uuid, text, numeric, numeric, text, boolean, numeric, numeric
) to authenticated;

create or replace function public.complete_draft_atomic_v4(
  p_invoice_id uuid,
  p_customer_id uuid,
  p_items jsonb,
  p_method text,
  p_paid numeric,
  p_payment_breakdown jsonb default null,
  p_shift_id uuid default null,
  p_promotion_id uuid default null,
  p_coupon_code text default null,
  p_loyalty_points integer default 0,
  p_discount_source text default null,
  p_order_discount numeric default 0,
  p_discount_otp_id uuid default null,
  p_discount_reason text default null,
  p_shipping_fee numeric default 0,
  p_order_vat_rate numeric default 0,
  p_allow_bom_shortage boolean default false,
  p_amount_tendered numeric default null,
  p_customer_credit numeric default 0
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid := public.get_user_tenant_id();
  v_invoice record;
  v_prepared jsonb;
  v_result jsonb;
  v_total numeric;
  v_item jsonb;
begin
  if v_actor is null or v_tenant_id is null then
    raise exception using errcode = '42501', message = 'POS_AUTH_REQUIRED';
  end if;
  if not public.user_has_permission(v_actor, 'pos_retail.checkout') then
    raise exception using errcode = '42501', message = 'POS_CHECKOUT_DENIED';
  end if;

  select i.*
  into v_invoice
  from public.invoices i
  where i.id = p_invoice_id
    and i.tenant_id = v_tenant_id
    and i.deleted_at is null
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'POS_DRAFT_NOT_FOUND';
  end if;
  if not public.user_has_branch_access(v_actor, v_invoice.branch_id) then
    raise exception using errcode = '42501', message = 'POS_BRANCH_DENIED';
  end if;
  if v_invoice.status = 'completed' then
    return jsonb_build_object(
      'invoice_id', v_invoice.id,
      'invoice_code', v_invoice.code,
      'total', v_invoice.total,
      'paid', v_invoice.paid,
      'debt', v_invoice.debt,
      'customer_credit', coalesce((
        select -sum(a.amount)
        from public.customer_debt_adjustments a
        where a.tenant_id = v_tenant_id
          and a.invoice_id = v_invoice.id
          and a.amount < 0
      ), 0),
      'idempotent', true
    );
  end if;
  if v_invoice.status <> 'draft' then
    raise exception using errcode = 'P0001', message = 'POS_DRAFT_ALREADY_PROCESSED';
  end if;

  v_prepared := public.pos_prepare_retail_checkout(
    v_tenant_id,
    v_actor,
    v_invoice.branch_id,
    p_customer_id,
    p_items,
    p_discount_source,
    p_order_discount,
    p_promotion_id,
    p_coupon_code,
    p_loyalty_points,
    p_discount_otp_id,
    p_shipping_fee,
    p_order_vat_rate
  );
  v_total := (v_prepared->>'total')::numeric;

  if coalesce(p_customer_credit, 0) < 0 then
    raise exception using errcode = '22023', message = 'POS_CUSTOMER_CREDIT_INVALID';
  end if;
  if coalesce(p_customer_credit, 0) > 0 and p_customer_id is null then
    raise exception using errcode = '22023', message = 'POS_CUSTOMER_REQUIRED_FOR_CREDIT';
  end if;
  if coalesce(p_customer_credit, 0) > 0 and (
    p_amount_tendered is null
    or abs(p_customer_credit - greatest(p_amount_tendered - v_total, 0)) > 0.01
  ) then
    raise exception using errcode = '22023', message = 'POS_CUSTOMER_CREDIT_MISMATCH';
  end if;

  if coalesce(p_paid, 0) < 0 or coalesce(p_paid, 0) > v_total + 0.01 then
    raise exception using errcode = '22023', message = 'POS_PAYMENT_INVALID';
  end if;

  update public.invoices
  set customer_id = p_customer_id,
      customer_name = v_prepared->>'customer_name',
      subtotal = (v_prepared->>'subtotal')::numeric,
      discount_amount = (v_prepared->>'discount_amount')::numeric,
      tax_amount = (v_prepared->>'tax_amount')::numeric,
      delivery_fee = (v_prepared->>'shipping_fee')::numeric,
      total = v_total,
      debt = v_total,
      promotion_id = p_promotion_id,
      promotion_discount = (v_prepared->>'promotion_discount')::numeric,
      promotion_free_value = (v_prepared->>'promotion_free_value')::numeric,
      amount_tendered = case
        when p_amount_tendered is null then p_paid
        else greatest(p_paid, p_amount_tendered)
      end
  where id = p_invoice_id
    and tenant_id = v_tenant_id
    and status = 'draft';

  delete from public.invoice_items where invoice_id = p_invoice_id;
  for v_item in select * from jsonb_array_elements(v_prepared->'items')
  loop
    insert into public.invoice_items (
      invoice_id, product_id, variant_id, product_name, unit,
      quantity, unit_price, discount, vat_rate, vat_amount, total, note
    ) values (
      p_invoice_id,
      (v_item->>'productId')::uuid,
      nullif(v_item->>'variantId', '')::uuid,
      v_item->>'productName',
      v_item->>'unit',
      (v_item->>'quantity')::numeric,
      (v_item->>'unitPrice')::numeric,
      (v_item->>'discount')::numeric,
      (v_item->>'vatRate')::numeric,
      round(
        (
          (v_item->>'quantity')::numeric * (v_item->>'unitPrice')::numeric
          - (v_item->>'discount')::numeric
        )
        * (v_prepared->>'discount_scale')::numeric
        * (v_item->>'vatRate')::numeric / 100
      ),
      (v_item->>'quantity')::numeric * (v_item->>'unitPrice')::numeric
        - (v_item->>'discount')::numeric,
      nullif(v_item->>'note', '')
    );
  end loop;

  v_result := public.complete_draft_atomic_v3(
    p_invoice_id,
    p_method,
    p_paid,
    p_payment_breakdown,
    p_shift_id,
    p_allow_bom_shortage
  );

  if coalesce(p_customer_credit, 0) > 0 then
    insert into public.customer_debt_adjustments (
      tenant_id, customer_id, invoice_id, amount, reason, idempotency_key, created_by
    ) values (
      v_tenant_id, p_customer_id, p_invoice_id, -p_customer_credit,
      'Tiền thừa ghi số dư từ hóa đơn ' || coalesce(v_result->>'invoice_code', p_invoice_id::text),
      'pos-credit:' || p_invoice_id::text, v_actor
    )
    on conflict (tenant_id, idempotency_key) do nothing;
  end if;

  if nullif(trim(coalesce(p_coupon_code, '')), '') is not null then
    perform public.apply_coupon_atomic(
      p_coupon_code,
      p_invoice_id,
      p_customer_id,
      (v_prepared->>'coupon_discount')::numeric,
      v_tenant_id
    );
  end if;
  if p_promotion_id is not null then
    perform public.increment_promotion_usage(p_promotion_id);
  end if;
  if (v_prepared->>'loyalty_effective_points')::integer > 0 then
    perform public.redeem_loyalty_points(
      p_customer_id,
      (v_prepared->>'loyalty_effective_points')::integer,
      p_invoice_id
    );
  end if;
  if p_customer_id is not null then
    perform public.earn_loyalty_points(p_customer_id, p_invoice_id, v_total);
  end if;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_tenant_id,
    v_actor,
    'pos_draft_completed',
    'invoice',
    p_invoice_id,
    jsonb_build_object(
      'total', v_total,
      'discount_source', p_discount_source,
      'discount_amount', (v_prepared->>'discount_amount')::numeric,
      'discount_reason', nullif(trim(coalesce(p_discount_reason, '')), ''),
      'price_overrides', v_prepared->'price_overrides',
      'promotion_id', p_promotion_id,
      'coupon_code', nullif(trim(coalesce(p_coupon_code, '')), ''),
      'loyalty_points', (v_prepared->>'loyalty_effective_points')::integer,
      'customer_credit', coalesce(p_customer_credit, 0)
    )
  );

  return v_result || jsonb_build_object(
    'total', v_total,
    'paid', p_paid,
    'debt', greatest(0, v_total - p_paid),
    'tax_amount', (v_prepared->>'tax_amount')::numeric,
    'discount_amount', (v_prepared->>'discount_amount')::numeric,
    'customer_credit', coalesce(p_customer_credit, 0)
  );
end;
$$;

revoke all on function public.complete_draft_atomic_v4(
  uuid, uuid, jsonb, text, numeric, jsonb, uuid, uuid, text, integer, text, numeric, uuid, text,
  numeric, numeric, boolean, numeric, numeric
) from public, anon;
grant execute on function public.complete_draft_atomic_v4(
  uuid, uuid, jsonb, text, numeric, jsonb, uuid, uuid, text, integer, text, numeric, uuid, text,
  numeric, numeric, boolean, numeric, numeric
) to authenticated;

-- Retail-specific OTP action. Existing F&B action remains unchanged.
create or replace function public.issue_manager_otp(
  p_action_code text,
  p_target_meta jsonb default '{}'::jsonb,
  p_branch_id uuid default null,
  -- Day 17/05/2026: cho phép manager đọc mã từ cashier qua điện thoại
  p_target_invoice_code text default null,
  p_target_kitchen_order_number text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_profile record;
  v_required_perm text;
  v_code text;
  v_hash text;
  v_otp_id uuid;
  v_expires_at timestamptz := now() + interval '2 minutes';
  v_recent_count int;
  v_resolved_entity_id uuid;
  v_resolved_meta jsonb;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED: please sign in';
  end if;

  select id, tenant_id, branch_id, full_name, role
  into v_profile from public.profiles
  where id = v_actor and is_active = true;

  if not found then
    raise exception 'USER_PROFILE_NOT_FOUND: %', v_actor;
  end if;

  v_required_perm := case p_action_code
    when 'fnb.cancel_unpaid_bill'   then 'pos_fnb.cancel_unpaid_order'
    when 'fnb.cancel_unpaid_item'   then 'pos_fnb.cancel_unpaid_order'
    when 'fnb.discount_override'    then 'pos_fnb.discount'
    when 'pos_retail.discount_override' then 'pos_retail.discount'
    when 'fnb.void_paid_bill'       then 'pos_fnb.void_paid_bill'
    when 'fnb.edit_sent_order'      then 'pos_fnb.edit_sent_order'
    when 'crm.delete_customer'      then 'customers.delete'
    when 'crm.delete_supplier'      then 'suppliers.delete'
    when 'products.delete'          then 'products.delete'
    when 'crm.delete_party'         then 'customers.delete'
    else null
  end;

  if v_required_perm is null then
    raise exception 'UNKNOWN_ACTION_CODE: %', p_action_code;
  end if;

  if not public.user_has_permission(v_actor, v_required_perm) then
    raise exception 'PERMISSION_DENIED: cần quyền % để cấp OTP cho action %',
      v_required_perm, p_action_code;
  end if;

  select count(*) into v_recent_count
  from public.manager_otp_codes
  where tenant_id = v_profile.tenant_id
    and issued_by = v_actor
    and created_at > now() - interval '15 minutes';

  if v_recent_count >= 5 then
    raise exception 'RATE_LIMIT_EXCEEDED: bạn đã cấp 5 OTP trong 15 phút qua, vui lòng đợi';
  end if;

  -- Day 17/05/2026: Resolve code → uuid, lưu vào target_meta.entity_id
  v_resolved_meta := coalesce(p_target_meta, '{}'::jsonb);

  if p_target_invoice_code is not null and length(trim(p_target_invoice_code)) > 0 then
    select id into v_resolved_entity_id
    from public.invoices
    where tenant_id = v_profile.tenant_id and code = trim(p_target_invoice_code);

    if v_resolved_entity_id is null then
      raise exception 'INVOICE_CODE_NOT_FOUND: % — vui lòng kiểm tra lại mã hoá đơn', p_target_invoice_code;
    end if;

    v_resolved_meta := v_resolved_meta
      || jsonb_build_object(
        'entity_id', v_resolved_entity_id,
        'invoice_id', v_resolved_entity_id,
        'invoice_code', trim(p_target_invoice_code)
      );
  end if;

  if p_target_kitchen_order_number is not null and length(trim(p_target_kitchen_order_number)) > 0 then
    select id into v_resolved_entity_id
    from public.kitchen_orders
    where tenant_id = v_profile.tenant_id
      and order_number = trim(p_target_kitchen_order_number);

    if v_resolved_entity_id is null then
      raise exception 'KITCHEN_ORDER_NUMBER_NOT_FOUND: % — vui lòng kiểm tra lại mã đơn bếp', p_target_kitchen_order_number;
    end if;

    v_resolved_meta := v_resolved_meta
      || jsonb_build_object(
        'entity_id', v_resolved_entity_id,
        'kitchen_order_id', v_resolved_entity_id,
        'kitchen_order_number', trim(p_target_kitchen_order_number)
      );
  end if;

  v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
  v_hash := public.hash_manager_otp(v_code, v_profile.tenant_id, v_actor);

  insert into public.manager_otp_codes (
    tenant_id, branch_id, code_hash, issued_by,
    action_code, target_meta, expires_at
  ) values (
    v_profile.tenant_id, coalesce(p_branch_id, v_profile.branch_id),
    v_hash, v_actor,
    p_action_code, v_resolved_meta, v_expires_at
  ) returning id into v_otp_id;

  return jsonb_build_object(
    'success', true,
    'otp_id', v_otp_id,
    'code', v_code,
    'expires_at', v_expires_at,
    'expires_in_seconds', 120,
    'action_code', p_action_code,
    'issued_by_name', v_profile.full_name,
    'target_bound', v_resolved_meta ? 'entity_id'
  );
end;
$$;

grant execute on function public.issue_manager_otp(text, jsonb, uuid, text, text) to authenticated;

notify pgrst, 'reload schema';

-- Read-only verification after applying:
-- select
--   to_regprocedure('public.pos_complete_checkout_atomic_v3(uuid,uuid,jsonb,text,jsonb,numeric,text,text,uuid,uuid,text,integer,text,numeric,uuid,text,numeric,numeric,text,boolean,numeric,numeric)') is not null as pos_v3_ok,
--   to_regprocedure('public.complete_draft_atomic_v4(uuid,uuid,jsonb,text,numeric,jsonb,uuid,uuid,text,integer,text,numeric,uuid,text,numeric,numeric,boolean,numeric,numeric)') is not null as draft_v4_ok,
--   to_regprocedure('public.pos_prepare_retail_checkout(uuid,uuid,uuid,uuid,jsonb,text,numeric,uuid,text,integer,uuid,numeric,numeric)') is not null as pricing_guard_ok;
