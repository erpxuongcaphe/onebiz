-- ============================================================
-- 00098: Modify POS + FnB checkout RPC — auto consume NVL theo BOM
-- (CEO 18/05/2026)
--
-- Khi bán SKU có BOM (has_bom=true) → sau khi trừ stock SKU,
-- gọi `consume_bom_for_sale` để trừ NVL theo công thức của chi nhánh.
--
-- Backward compat:
--   - SKU không có BOM (has_bom=false hoặc bom table trống) → behavior cũ
--   - SKU có has_bom=true nhưng chưa setup BOM → log warning, không reject
--   - RPC signature giữ nguyên — không break client
--
-- Logic:
--   1. Trừ stock SKU như cũ (legacy behavior)
--   2. IF products.has_bom = true → gọi consume_bom_for_sale
--   3. Append bom_consume result vào return value (key: bom_consume_results[])
-- ============================================================

-- ────────────────────────────────────────────────────────────────
-- 1. pos_complete_checkout_atomic v3 — thêm BOM consume cho Retail
-- ────────────────────────────────────────────────────────────────
create or replace function public.pos_complete_checkout_atomic(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_created_by uuid,
  p_customer_id uuid default null,
  p_customer_name text default 'Khách lẻ',
  p_items jsonb default '[]'::jsonb,
  p_payment_method text default 'cash',
  p_payment_breakdown jsonb default null,
  p_subtotal numeric default 0,
  p_discount_amount numeric default 0,
  p_total numeric default 0,
  p_paid numeric default 0,
  p_note text default null,
  p_source text default 'pos',
  p_shift_id uuid default null,
  p_promotion_id uuid default null,
  p_promotion_discount numeric default 0,
  p_promotion_free_value numeric default 0,
  p_client_session_id text default null
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_invoice_id uuid;
  v_invoice_code text;
  v_existing record;
  v_item jsonb;
  v_product_id uuid;
  v_product_name text;
  v_unit text;
  v_qty numeric;
  v_unit_price numeric;
  v_discount numeric;
  v_vat_rate numeric;
  v_vat_amt numeric;
  v_line_before_tax numeric;
  v_tax_total numeric := 0;
  v_session_id text := nullif(p_client_session_id, '');
  v_breakdown_item jsonb;
  v_method text;
  v_amount numeric;
  v_cash_code text;
  v_method_label text;
  v_has_bom boolean;
  v_bom_result jsonb;
  v_bom_results jsonb := '[]'::jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'POS checkout requires at least one item';
  end if;

  if p_shift_id is not null and not exists (
    select 1 from public.shifts
    where id = p_shift_id and tenant_id = p_tenant_id
      and branch_id = p_branch_id and status = 'open'
  ) then
    raise exception 'Shift % is not open for this branch', p_shift_id;
  end if;

  if v_session_id is not null then
    select id, code, status into v_existing
    from public.invoices
    where tenant_id = p_tenant_id and client_session_id = v_session_id
    order by created_at desc limit 1;

    if found and v_existing.status = 'completed' then
      return jsonb_build_object(
        'invoice_id', v_existing.id,
        'invoice_code', v_existing.code,
        'idempotent', true
      );
    elsif found and v_existing.status = 'draft' then
      raise exception 'Invoice % is still draft; resume the draft instead', v_existing.code;
    end if;
  end if;

  v_invoice_code := public.next_code(p_tenant_id, 'invoice');
  if v_invoice_code is null or v_invoice_code = '' then
    v_invoice_code := 'HD' || extract(epoch from now())::bigint::text;
  end if;

  -- Pre-compute tax
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_item->>'quantity')::numeric, 0);
    v_unit_price := coalesce((v_item->>'unitPrice')::numeric, 0);
    v_discount := coalesce((v_item->>'discount')::numeric, 0);
    v_vat_rate := coalesce((v_item->>'vatRate')::numeric, 0);
    v_line_before_tax := (v_qty * v_unit_price) - v_discount;
    v_vat_amt := round(v_line_before_tax * v_vat_rate / 100);
    v_tax_total := v_tax_total + v_vat_amt;
  end loop;

  -- Insert invoice
  begin
    insert into public.invoices (
      tenant_id, branch_id, code, customer_id, customer_name, status,
      subtotal, discount_amount, tax_amount, total, paid, debt,
      payment_method, source, note, created_by, shift_id,
      promotion_id, promotion_discount, promotion_free_value,
      client_session_id, auto_saved
    ) values (
      p_tenant_id, p_branch_id, v_invoice_code,
      p_customer_id, coalesce(nullif(p_customer_name, ''), 'Khách lẻ'), 'completed',
      coalesce(p_subtotal, 0), coalesce(p_discount_amount, 0), v_tax_total,
      coalesce(p_total, 0), coalesce(p_paid, 0),
      greatest(0, coalesce(p_total, 0) - coalesce(p_paid, 0)),
      p_payment_method, coalesce(nullif(p_source, ''), 'pos'), p_note,
      p_created_by, p_shift_id,
      p_promotion_id, coalesce(p_promotion_discount, 0), coalesce(p_promotion_free_value, 0),
      v_session_id, false
    ) returning id into v_invoice_id;
  exception when unique_violation then
    if v_session_id is not null then
      select id, code, status into v_existing
      from public.invoices
      where tenant_id = p_tenant_id and client_session_id = v_session_id
      order by created_at desc limit 1;

      if found and v_existing.status = 'completed' then
        return jsonb_build_object(
          'invoice_id', v_existing.id,
          'invoice_code', v_existing.code,
          'idempotent', true
        );
      end if;
    end if;
    raise;
  end;

  -- Loop items: insert invoice_items + trừ stock + consume BOM
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product_id := (v_item->>'productId')::uuid;
    v_product_name := coalesce(nullif(v_item->>'productName', ''), 'Sản phẩm');
    v_unit := coalesce(nullif(v_item->>'unit', ''), 'Cái');
    v_qty := coalesce((v_item->>'quantity')::numeric, 0);
    v_unit_price := coalesce((v_item->>'unitPrice')::numeric, 0);
    v_discount := coalesce((v_item->>'discount')::numeric, 0);
    v_vat_rate := coalesce((v_item->>'vatRate')::numeric, 0);
    v_line_before_tax := (v_qty * v_unit_price) - v_discount;
    v_vat_amt := round(v_line_before_tax * v_vat_rate / 100);

    if v_product_id is null or v_qty <= 0 then
      raise exception 'Invalid POS item: %', v_item;
    end if;

    insert into public.invoice_items (
      invoice_id, product_id, product_name, unit,
      quantity, unit_price, discount, vat_rate, vat_amount, total
    ) values (
      v_invoice_id, v_product_id, v_product_name, v_unit,
      v_qty, v_unit_price, v_discount, v_vat_rate, v_vat_amt, v_line_before_tax
    );

    insert into public.stock_movements (
      tenant_id, branch_id, product_id, type, quantity,
      reference_type, reference_id, note, created_by
    ) values (
      p_tenant_id, p_branch_id, v_product_id, 'out', v_qty,
      'invoice', v_invoice_id, 'POS bán hàng - ' || v_invoice_code, p_created_by
    );

    perform public.increment_product_stock(v_product_id, -v_qty);
    perform public.upsert_branch_stock(p_tenant_id, p_branch_id, v_product_id, -v_qty);

    begin
      perform public.allocate_lots_fifo(
        p_tenant_id, v_product_id, p_branch_id, v_qty, 'invoice', v_invoice_id
      );
    exception when others then null;
    end;

    -- ─── Day 18/05/2026: BOM consume — trừ NVL theo công thức ───
    -- Chỉ gọi nếu SP có has_bom=true
    select coalesce(has_bom, false) into v_has_bom
    from public.products where id = v_product_id;

    if v_has_bom then
      v_bom_result := public.consume_bom_for_sale(
        p_tenant_id, p_branch_id, v_product_id, v_qty, v_invoice_id, p_created_by, v_invoice_code
      );
      v_bom_results := v_bom_results || jsonb_build_object(
        'product_id', v_product_id,
        'product_name', v_product_name,
        'sale_qty', v_qty,
        'result', v_bom_result
      );
    end if;
  end loop;

  -- Cash transactions (mixed support)
  if coalesce(p_paid, 0) > 0 then
    if p_payment_method = 'mixed' and p_payment_breakdown is not null
       and jsonb_typeof(p_payment_breakdown) = 'array'
       and jsonb_array_length(p_payment_breakdown) > 0 then
      for v_breakdown_item in select * from jsonb_array_elements(p_payment_breakdown) loop
        v_amount := coalesce((v_breakdown_item->>'amount')::numeric, 0);
        v_method := v_breakdown_item->>'method';
        if v_amount > 0 and v_method in ('cash', 'transfer', 'card') then
          v_cash_code := public.next_code(p_tenant_id, 'cash_receipt');
          if v_cash_code is null or v_cash_code = '' then
            v_cash_code := 'PT' || extract(epoch from now())::bigint::text;
          end if;
          v_method_label := case v_method
            when 'cash' then 'tiền mặt'
            when 'transfer' then 'chuyển khoản'
            when 'card' then 'thẻ' else v_method end;
          insert into public.cash_transactions (
            tenant_id, branch_id, code, type, category, amount,
            counterparty, payment_method, reference_type, reference_id,
            note, created_by, shift_id
          ) values (
            p_tenant_id, p_branch_id, v_cash_code, 'receipt', 'Bán hàng', v_amount,
            coalesce(nullif(p_customer_name, ''), 'Khách lẻ'), v_method,
            'invoice', v_invoice_id,
            'Thu tiền HĐ ' || v_invoice_code || ' (' || v_method_label || ')',
            p_created_by, p_shift_id
          );
        end if;
      end loop;
    else
      v_cash_code := public.next_code(p_tenant_id, 'cash_receipt');
      if v_cash_code is null or v_cash_code = '' then
        v_cash_code := 'PT' || extract(epoch from now())::bigint::text;
      end if;
      insert into public.cash_transactions (
        tenant_id, branch_id, code, type, category, amount,
        counterparty, payment_method, reference_type, reference_id,
        note, created_by, shift_id
      ) values (
        p_tenant_id, p_branch_id, v_cash_code, 'receipt', 'Bán hàng', p_paid,
        coalesce(nullif(p_customer_name, ''), 'Khách lẻ'),
        case when p_payment_method = 'mixed' then 'cash' else p_payment_method end,
        'invoice', v_invoice_id, 'Thu tiền HĐ ' || v_invoice_code,
        p_created_by, p_shift_id
      );
    end if;
  end if;

  return jsonb_build_object(
    'invoice_id', v_invoice_id,
    'invoice_code', v_invoice_code,
    'total', p_total,
    'paid', p_paid,
    'debt', greatest(0, coalesce(p_total, 0) - coalesce(p_paid, 0)),
    'bom_consume_results', v_bom_results
  );
end;
$$;

comment on function public.pos_complete_checkout_atomic is
  'Atomic retail POS checkout v3: invoice + items + stock + BOM consume + cash. CEO 18/05/2026.';

-- ────────────────────────────────────────────────────────────────
-- 2. fnb_complete_payment_atomic — DI CHUYỂN SANG migration 00100
-- vì có nhiều overload cũ (9/10/11 params) → DROP trước rồi CREATE.
-- Migration 00098 này CHỈ rewrite pos_complete_checkout_atomic.
-- Phần dưới (#### DISABLED ####) giữ để reference, KHÔNG chạy.
-- ────────────────────────────────────────────────────────────────

/*
create or replace function public.fnb_complete_payment_atomic(
  p_kitchen_order_id uuid,
  p_customer_id uuid,
  p_customer_name text,
  p_payment_method text,
  p_payment_breakdown jsonb,
  p_paid numeric,
  p_discount_amount numeric,
  p_note text,
  p_created_by uuid
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_order record;
  v_tenant_id uuid;
  v_branch_id uuid;
  v_invoice_id uuid;
  v_invoice_code text;
  v_items_subtotal numeric := 0;
  v_total_discount numeric;
  v_delivery_fee numeric;
  v_total numeric;
  v_tax_total numeric := 0;
  v_cash_code text;
  v_customer_name text;
  v_note text;
  r record;
  t jsonb;
  v_vat_rate numeric;
  v_vat_amt numeric;
  v_line_before_tax numeric;
  v_topping_qty numeric;
  v_topping_price numeric;
  v_topping_product_id uuid;
  v_topping_name text;
  v_topping_total numeric;
  v_breakdown_item jsonb;
  v_method text;
  v_amount numeric;
  v_method_label text;
  v_has_bom boolean;
  v_bom_result jsonb;
  v_bom_results jsonb := '[]'::jsonb;
begin
  -- 1. Load kitchen_order
  select * into v_order
  from public.kitchen_orders where id = p_kitchen_order_id;

  if not found then
    raise exception 'Kitchen order % not found', p_kitchen_order_id;
  end if;
  if v_order.status = 'completed' then
    raise exception 'Kitchen order % already paid (invoice_id=%)', p_kitchen_order_id, v_order.invoice_id;
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'Kitchen order % was cancelled — cannot pay', p_kitchen_order_id;
  end if;

  v_tenant_id := v_order.tenant_id;
  v_branch_id := v_order.branch_id;
  v_delivery_fee := coalesce(v_order.delivery_fee, 0);
  v_customer_name := coalesce(nullif(p_customer_name, ''), 'Khách lẻ');
  v_note := coalesce(p_note, 'F&B - ' || v_order.order_number);

  -- 2. Invoice code
  v_invoice_code := public.next_code(v_tenant_id, 'invoice');
  if v_invoice_code is null or v_invoice_code = '' then
    v_invoice_code := 'HD' || extract(epoch from now())::bigint::text;
  end if;

  -- 3. Pre-compute subtotal + tax
  for r in
    select product_id, product_name, variant_label, quantity, unit_price, toppings
    from public.kitchen_order_items
    where kitchen_order_id = p_kitchen_order_id
  loop
    v_line_before_tax := r.quantity * r.unit_price;
    select coalesce(vat_rate, 0) into v_vat_rate
    from public.products where id = r.product_id;
    v_vat_rate := coalesce(v_vat_rate, 0);
    v_vat_amt := round(v_line_before_tax * v_vat_rate / 100);
    v_items_subtotal := v_items_subtotal + v_line_before_tax;
    v_tax_total := v_tax_total + v_vat_amt;

    if r.toppings is not null then
      for t in select * from jsonb_array_elements(r.toppings) loop
        v_topping_qty := coalesce((t->>'quantity')::numeric, 0) * r.quantity;
        if v_topping_qty > 0 then
          v_topping_price := coalesce((t->>'price')::numeric, 0);
          v_items_subtotal := v_items_subtotal + v_topping_qty * v_topping_price;
        end if;
      end loop;
    end if;
  end loop;

  v_total_discount := coalesce(p_discount_amount, 0);
  v_total := v_items_subtotal + v_tax_total + v_delivery_fee - v_total_discount;

  -- 4. Insert invoice
  insert into public.invoices (
    tenant_id, branch_id, code, customer_id, customer_name, status,
    subtotal, discount_amount, tax_amount, total, paid, debt,
    payment_method, source, note, created_by
  ) values (
    v_tenant_id, v_branch_id, v_invoice_code,
    p_customer_id, v_customer_name, 'completed',
    v_items_subtotal, v_total_discount, v_tax_total,
    v_total, coalesce(p_paid, 0),
    greatest(0, v_total - coalesce(p_paid, 0)),
    p_payment_method, 'fnb', v_note, p_created_by
  ) returning id into v_invoice_id;

  -- 5. Insert invoice_items + trừ stock + BOM consume
  for r in
    select product_id, product_name, variant_label, quantity, unit_price, toppings
    from public.kitchen_order_items
    where kitchen_order_id = p_kitchen_order_id
  loop
    v_line_before_tax := r.quantity * r.unit_price;
    select coalesce(vat_rate, 0) into v_vat_rate from public.products where id = r.product_id;
    v_vat_rate := coalesce(v_vat_rate, 0);
    v_vat_amt := round(v_line_before_tax * v_vat_rate / 100);

    insert into public.invoice_items (
      invoice_id, product_id, product_name, unit,
      quantity, unit_price, discount, vat_rate, vat_amount, total
    ) values (
      v_invoice_id, r.product_id,
      r.product_name || coalesce(' (' || r.variant_label || ')', ''),
      'Cái',
      r.quantity, r.unit_price, 0, v_vat_rate, v_vat_amt, v_line_before_tax
    );

    insert into public.stock_movements (
      tenant_id, branch_id, product_id, type, quantity,
      reference_type, reference_id, note, created_by
    ) values (
      v_tenant_id, v_branch_id, r.product_id, 'out', r.quantity,
      'invoice', v_invoice_id,
      'F&B bán hàng - ' || v_invoice_code, p_created_by
    );

    perform public.increment_product_stock(r.product_id, -r.quantity);
    perform public.upsert_branch_stock(v_tenant_id, v_branch_id, r.product_id, -r.quantity);

    begin
      perform public.allocate_lots_fifo(
        v_tenant_id, r.product_id, v_branch_id, r.quantity, 'invoice', v_invoice_id
      );
    exception when others then null;
    end;

    -- ─── Day 18/05/2026: BOM consume FnB ───
    select coalesce(has_bom, false) into v_has_bom
    from public.products where id = r.product_id;

    if v_has_bom then
      v_bom_result := public.consume_bom_for_sale(
        v_tenant_id, v_branch_id, r.product_id, r.quantity, v_invoice_id, p_created_by, v_invoice_code
      );
      v_bom_results := v_bom_results || jsonb_build_object(
        'product_id', r.product_id,
        'product_name', r.product_name,
        'sale_qty', r.quantity,
        'result', v_bom_result
      );
    end if;

    -- 5d. Toppings (each = separate invoice_item + stock + BOM if has)
    if r.toppings is not null then
      for t in select * from jsonb_array_elements(r.toppings) loop
        v_topping_qty := coalesce((t->>'quantity')::numeric, 0) * r.quantity;
        if v_topping_qty > 0 then
          v_topping_price := coalesce((t->>'price')::numeric, 0);
          v_topping_product_id := (t->>'productId')::uuid;
          v_topping_name := coalesce(t->>'name', 'Topping');
          v_topping_total := v_topping_qty * v_topping_price;

          insert into public.invoice_items (
            invoice_id, product_id, product_name, unit,
            quantity, unit_price, discount, vat_rate, vat_amount, total
          ) values (
            v_invoice_id, v_topping_product_id, v_topping_name, 'Cái',
            v_topping_qty, v_topping_price, 0, 0, 0, v_topping_total
          );

          insert into public.stock_movements (
            tenant_id, branch_id, product_id, type, quantity,
            reference_type, reference_id, note, created_by
          ) values (
            v_tenant_id, v_branch_id, v_topping_product_id, 'out', v_topping_qty,
            'invoice', v_invoice_id,
            'F&B topping - ' || v_invoice_code, p_created_by
          );

          perform public.increment_product_stock(v_topping_product_id, -v_topping_qty);
          perform public.upsert_branch_stock(v_tenant_id, v_branch_id, v_topping_product_id, -v_topping_qty);

          begin
            perform public.allocate_lots_fifo(
              v_tenant_id, v_topping_product_id, v_branch_id,
              v_topping_qty, 'invoice', v_invoice_id
            );
          exception when others then null;
          end;

          -- BOM consume cho topping (nếu topping cũng là SKU có BOM)
          if v_topping_product_id is not null then
            select coalesce(has_bom, false) into v_has_bom
            from public.products where id = v_topping_product_id;

            if v_has_bom then
              v_bom_result := public.consume_bom_for_sale(
                v_tenant_id, v_branch_id, v_topping_product_id, v_topping_qty,
                v_invoice_id, p_created_by, v_invoice_code
              );
              v_bom_results := v_bom_results || jsonb_build_object(
                'product_id', v_topping_product_id,
                'product_name', v_topping_name,
                'sale_qty', v_topping_qty,
                'topping', true,
                'result', v_bom_result
              );
            end if;
          end if;
        end if;
      end loop;
    end if;
  end loop;

  -- 6. Cash transactions (mixed support)
  if p_paid > 0 then
    if p_payment_method = 'mixed' and p_payment_breakdown is not null
       and jsonb_typeof(p_payment_breakdown) = 'array'
       and jsonb_array_length(p_payment_breakdown) > 0 then
      for v_breakdown_item in select * from jsonb_array_elements(p_payment_breakdown) loop
        v_amount := coalesce((v_breakdown_item->>'amount')::numeric, 0);
        v_method := v_breakdown_item->>'method';
        if v_amount > 0 and v_method in ('cash', 'transfer', 'card') then
          v_cash_code := public.next_code(v_tenant_id, 'cash_receipt');
          if v_cash_code is null or v_cash_code = '' then
            v_cash_code := 'PT' || extract(epoch from now())::bigint::text;
          end if;
          v_method_label := case v_method
            when 'cash' then 'tiền mặt'
            when 'transfer' then 'chuyển khoản'
            when 'card' then 'thẻ' else v_method end;
          insert into public.cash_transactions (
            tenant_id, branch_id, code, type, category, amount,
            counterparty, payment_method, reference_type, reference_id,
            note, created_by
          ) values (
            v_tenant_id, v_branch_id, v_cash_code, 'receipt', 'Bán hàng', v_amount,
            v_customer_name, v_method,
            'invoice', v_invoice_id,
            'Thu tiền HĐ ' || v_invoice_code || ' (' || v_method_label || ')',
            p_created_by
          );
        end if;
      end loop;
    else
      v_cash_code := public.next_code(v_tenant_id, 'cash_receipt');
      if v_cash_code is null or v_cash_code = '' then
        v_cash_code := 'PT' || extract(epoch from now())::bigint::text;
      end if;
      insert into public.cash_transactions (
        tenant_id, branch_id, code, type, category, amount,
        counterparty, payment_method, reference_type, reference_id,
        note, created_by
      ) values (
        v_tenant_id, v_branch_id, v_cash_code, 'receipt', 'Bán hàng', p_paid,
        v_customer_name,
        case when p_payment_method = 'mixed' then 'cash' else p_payment_method end,
        'invoice', v_invoice_id,
        'Thu tiền HĐ ' || v_invoice_code, p_created_by
      );
    end if;
  end if;

  -- 7. Link invoice → kitchen_order + mark completed
  update public.kitchen_orders
  set invoice_id = v_invoice_id,
      status = 'completed',
      updated_at = now()
  where id = p_kitchen_order_id;

  -- 8. Release table
  if v_order.table_id is not null then
    update public.restaurant_tables
    set status = 'available',
        current_order_id = null,
        updated_at = now()
    where id = v_order.table_id
      and current_order_id = p_kitchen_order_id;
  end if;

  return jsonb_build_object(
    'invoice_id', v_invoice_id,
    'invoice_code', v_invoice_code,
    'total', v_total,
    'paid', coalesce(p_paid, 0),
    'debt', greatest(0, v_total - coalesce(p_paid, 0)),
    'bom_consume_results', v_bom_results
  );
end;
$$;

*/
-- END DISABLED block — fnb_complete_payment_atomic xem migration 00100

notify pgrst, 'reload schema';
