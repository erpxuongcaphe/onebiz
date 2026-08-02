-- ============================================================
-- 00291: Derive retail POS draft totals from one cart snapshot
-- ============================================================
-- Function definition only. Existing invoices, stock, debt and cash are untouched.

create or replace function public.save_pos_draft_atomic_v2(
  p_branch_id uuid,
  p_customer_id uuid,
  p_items jsonb,
  p_payment_method text,
  p_order_discount numeric,
  p_shipping_fee numeric,
  p_order_vat_rate numeric,
  p_note text,
  p_client_session_id text,
  p_auto_saved boolean
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item jsonb;
  v_quantity numeric;
  v_unit_price numeric;
  v_line_discount numeric;
  v_vat_rate numeric;
  v_line_net numeric;
  v_subtotal numeric := 0;
  v_line_discount_total numeric := 0;
  v_after_line_discount numeric;
  v_order_discount numeric := coalesce(p_order_discount, 0);
  v_discount_scale numeric := 1;
  v_tax_amount numeric := 0;
  v_order_vat_amount numeric := 0;
  v_total numeric := 0;
begin
  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0
     or jsonb_array_length(p_items) > 500 then
    raise exception using errcode = '22023', message = 'POS_DRAFT_ITEMS_INVALID';
  end if;
  if v_order_discount < 0
     or v_order_discount = 'NaN'::numeric
     or coalesce(p_shipping_fee, 0) < 0
     or coalesce(p_shipping_fee, 0) = 'NaN'::numeric then
    raise exception using errcode = '22023', message = 'POS_DRAFT_TOTAL_INVALID';
  end if;
  if coalesce(p_order_vat_rate, 0) not in (0, 5, 8, 10) then
    raise exception using errcode = '22023', message = 'POS_ORDER_VAT_INVALID';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_quantity := nullif(v_item->>'quantity', '')::numeric;
      v_unit_price := nullif(v_item->>'unitPrice', '')::numeric;
      v_line_discount := coalesce(nullif(v_item->>'discount', '')::numeric, 0);
      v_vat_rate := coalesce(nullif(v_item->>'vatRate', '')::numeric, 0);
    exception when others then
      raise exception using errcode = '22023', message = 'POS_DRAFT_ITEM_INVALID';
    end;

    if v_quantity is null or v_quantity <= 0 or v_quantity = 'NaN'::numeric
       or v_unit_price is null or v_unit_price < 0 or v_unit_price = 'NaN'::numeric
       or v_line_discount < 0 or v_line_discount = 'NaN'::numeric
       or v_line_discount > v_quantity * v_unit_price
       or v_vat_rate not in (0, 5, 8, 10) then
      raise exception using errcode = '22023', message = 'POS_DRAFT_ITEM_INVALID';
    end if;

    v_subtotal := v_subtotal + v_quantity * v_unit_price;
    v_line_discount_total := v_line_discount_total + v_line_discount;
  end loop;

  v_after_line_discount := greatest(0, v_subtotal - v_line_discount_total);
  if v_order_discount > v_after_line_discount then
    raise exception using errcode = '22023', message = 'POS_DRAFT_DISCOUNT_INVALID';
  end if;
  if v_after_line_discount > 0 then
    v_discount_scale := greatest(
      0,
      (v_after_line_discount - v_order_discount) / v_after_line_discount
    );
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_quantity := (v_item->>'quantity')::numeric;
    v_unit_price := (v_item->>'unitPrice')::numeric;
    v_line_discount := coalesce(nullif(v_item->>'discount', '')::numeric, 0);
    v_vat_rate := coalesce(nullif(v_item->>'vatRate', '')::numeric, 0);
    v_line_net := v_quantity * v_unit_price - v_line_discount;
    v_tax_amount := v_tax_amount + round(
      v_line_net * v_discount_scale * v_vat_rate / 100
    );
  end loop;

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

  return public.save_pos_draft_atomic(
    p_branch_id,
    p_customer_id,
    p_items,
    p_payment_method,
    v_subtotal,
    v_line_discount_total + v_order_discount,
    v_total,
    coalesce(p_shipping_fee, 0),
    p_note,
    p_client_session_id,
    p_auto_saved
  );
end;
$$;

revoke all on function public.save_pos_draft_atomic_v2(
  uuid, uuid, jsonb, text, numeric, numeric, numeric, text, text, boolean
) from public, anon;
grant execute on function public.save_pos_draft_atomic_v2(
  uuid, uuid, jsonb, text, numeric, numeric, numeric, text, text, boolean
) to authenticated;

comment on function public.save_pos_draft_atomic_v2(
  uuid, uuid, jsonb, text, numeric, numeric, numeric, text, text, boolean
) is 'Serializes POS draft saves and derives all header totals from the same item snapshot.';

notify pgrst, 'reload schema';

select to_regprocedure(
  'public.save_pos_draft_atomic_v2(uuid,uuid,jsonb,text,numeric,numeric,numeric,text,text,boolean)'
) is not null as pos_draft_v2_ok;
