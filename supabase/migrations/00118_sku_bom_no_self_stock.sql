-- ============================================================
-- 00118: SKU có BOM KHÔNG tự trừ tồn — chỉ trừ NVL theo công thức
-- (CEO 29/05/2026)
--
-- VẤN ĐỀ: Khi bán 1 SKU ghép từ NVL (vd "Sữa đặc Lamosa" SKU = 1 Lon NVL),
-- checkout LUÔN trừ tồn của chính SKU (→ âm) RỒI mới trừ thêm NVL. SKU không
-- giữ tồn kho thật → tồn SKU cứ âm dần, gây hiểu nhầm.
--
-- QUY TẮC MỚI (CEO): SKU không có tồn kho. Bán SKU có BOM → CHỈ trừ NVL theo
-- công thức, KHÔNG trừ tồn SKU. SP KHÔNG có BOM (NVL bán thẳng, hàng đơn giản)
-- → trừ tồn chính nó như cũ.
--
-- THAY ĐỔI:
--   1. pos_complete_checkout_atomic  — has_bom ? consume_bom_for_sale : trừ tồn
--   2. fnb_complete_payment_atomic   — áp dụng cho cả item + topping
--   3. Sửa data cũ: SKU-SUA-003 về 0, NVL-SUA-002 trừ 1 Lon (HD001191 bán thật)
--
-- AN TOÀN: chỉ đổi nhánh trừ tồn; giữ nguyên invoice_items, thuế, sổ quỹ,
-- commission, tip, idempotency, toppings sale-line.
-- ============================================================

-- ────────────────────────────────────────────────────────────────
-- 1. pos_complete_checkout_atomic v4 — SKU có BOM không tự trừ tồn
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

  -- Loop items: insert invoice_items + trừ tồn (theo has_bom)
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

    -- ─── CEO 29/05/2026: SKU có BOM → chỉ trừ NVL, KHÔNG trừ tồn SKU ───
    select coalesce(has_bom, false) into v_has_bom
    from public.products where id = v_product_id;

    if v_has_bom then
      -- SKU ghép từ NVL: tiêu hao NVL theo công thức, KHÔNG đụng tồn SKU
      v_bom_result := public.consume_bom_for_sale(
        p_tenant_id, p_branch_id, v_product_id, v_qty, v_invoice_id, p_created_by, v_invoice_code
      );
      v_bom_results := v_bom_results || jsonb_build_object(
        'product_id', v_product_id,
        'product_name', v_product_name,
        'sale_qty', v_qty,
        'result', v_bom_result
      );
    else
      -- SP thường (NVL bán thẳng / hàng đơn giản): trừ tồn chính nó như cũ
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
  'Atomic retail POS checkout v4: SKU có BOM chỉ trừ NVL (không tự trừ tồn). CEO 29/05/2026.';

-- ────────────────────────────────────────────────────────────────
-- 2. fnb_complete_payment_atomic v5 — SKU/topping có BOM không tự trừ tồn
-- ────────────────────────────────────────────────────────────────
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
  v_order record;
  v_tenant_id uuid;
  v_branch_id uuid;
  v_invoice_id uuid;
  v_invoice_code text;
  v_items_subtotal numeric := 0;
  v_total_discount numeric;
  v_delivery_fee numeric;
  v_tip numeric;
  v_commission_percent numeric;
  v_commission_amount numeric;
  v_total numeric;
  v_total_gross numeric;
  v_tax_total numeric := 0;
  v_cash_code text;
  v_customer_name text;
  v_note text;
  v_actual_paid numeric;
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
  v_payment_method_effective text;
  v_has_bom boolean;
  v_bom_result jsonb;
  v_bom_results jsonb := '[]'::jsonb;
begin
  -- 1. Load + validate kitchen order
  select * into v_order from public.kitchen_orders where id = p_kitchen_order_id;
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
  v_tip := greatest(0, coalesce(p_tip_amount, 0));
  v_commission_percent := coalesce(v_order.platform_commission_percent, 0);
  v_customer_name := coalesce(nullif(p_customer_name, ''), 'Khách lẻ');
  v_note := coalesce(p_note, 'F&B - ' || v_order.order_number);

  -- Shift guard
  if p_shift_id is not null then
    if not exists (
      select 1 from public.shifts
      where id = p_shift_id and status = 'open' and branch_id = v_branch_id
    ) then
      raise exception 'Ca % không tồn tại hoặc đã đóng', p_shift_id;
    end if;
  end if;

  -- 2. Invoice code
  v_invoice_code := public.next_code(v_tenant_id, 'invoice');
  if v_invoice_code is null or v_invoice_code = '' then
    v_invoice_code := 'HD' || extract(epoch from now())::bigint::text;
  end if;

  -- 3. Tính subtotal + tax (items + toppings)
  for r in
    select product_id, product_name, variant_label, quantity, unit_price, toppings
    from public.kitchen_order_items where kitchen_order_id = p_kitchen_order_id
  loop
    v_line_before_tax := r.quantity * r.unit_price;
    select coalesce(vat_rate, 0) into v_vat_rate from public.products where id = r.product_id;
    v_vat_rate := coalesce(v_vat_rate, 0);
    v_vat_amt := round(v_line_before_tax * v_vat_rate / 100);
    v_items_subtotal := v_items_subtotal + v_line_before_tax;
    v_tax_total := v_tax_total + v_vat_amt;

    if r.toppings is not null then
      for t in select * from jsonb_array_elements(r.toppings) loop
        v_topping_qty := coalesce((t->>'quantity')::numeric, 0);
        if v_topping_qty > 0 then
          v_topping_price := coalesce((t->>'price')::numeric, 0);
          v_items_subtotal := v_items_subtotal + (v_topping_qty * v_topping_price * r.quantity);
        end if;
      end loop;
    end if;
  end loop;

  v_total_discount := coalesce(v_order.discount_amount, 0) + coalesce(p_discount_amount, 0);

  -- 4. Tổng gross + commission + thực thu
  v_total_gross := v_items_subtotal - v_total_discount + v_delivery_fee + v_tip;
  v_commission_amount := round(v_total_gross * v_commission_percent / 100);
  v_total := v_total_gross - v_commission_amount;
  if v_total < 0 then v_total := 0; end if;

  if v_commission_amount > 0 then
    v_actual_paid := v_total;
    v_payment_method_effective := 'transfer';
  else
    v_actual_paid := p_paid;
    v_payment_method_effective := p_payment_method;
  end if;

  -- 5. Insert invoice
  insert into public.invoices (
    tenant_id, branch_id, code, customer_id, customer_name, status,
    subtotal, discount_amount, tax_amount, total, paid, debt,
    delivery_fee, platform_commission, platform_commission_percent,
    payment_method, source, note, created_by, shift_id, tip_amount
  ) values (
    v_tenant_id, v_branch_id, v_invoice_code, p_customer_id, v_customer_name, 'completed',
    v_items_subtotal, v_total_discount, v_tax_total, v_total, v_actual_paid,
    greatest(0, v_total - v_actual_paid),
    v_delivery_fee, v_commission_amount, v_commission_percent,
    v_payment_method_effective, 'fnb', v_note, p_created_by, p_shift_id, v_tip
  ) returning id into v_invoice_id;

  -- Snapshot commission vào kitchen_orders
  update public.kitchen_orders
  set platform_commission_amount = v_commission_amount
  where id = p_kitchen_order_id;

  -- 6. Insert invoice_items + trừ tồn (theo has_bom) + BOM consume
  for r in
    select product_id, product_name, variant_label, quantity, unit_price, toppings
    from public.kitchen_order_items where kitchen_order_id = p_kitchen_order_id
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
      case when r.variant_label is not null and r.variant_label <> ''
           then r.product_name || ' (' || r.variant_label || ')'
           else r.product_name end,
      'Cái', r.quantity, r.unit_price, 0, v_vat_rate, v_vat_amt, v_line_before_tax
    );

    -- ─── CEO 29/05/2026: SKU có BOM → chỉ trừ NVL, KHÔNG trừ tồn SKU ───
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
    else
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
        perform public.allocate_lots_fifo(v_tenant_id, r.product_id, v_branch_id, r.quantity, 'invoice', v_invoice_id);
      exception when others then null;
      end;
    end if;

    -- Topping: mỗi topping = 1 dòng bán + trừ tồn (theo has_bom của topping)
    if r.toppings is not null then
      for t in select * from jsonb_array_elements(r.toppings) loop
        v_topping_qty := coalesce((t->>'quantity')::numeric, 0);
        if v_topping_qty > 0 then
          v_topping_product_id := nullif(t->>'product_id', '')::uuid;
          if v_topping_product_id is not null then
            v_topping_name := coalesce(t->>'name', 'Topping');
            v_topping_price := coalesce((t->>'price')::numeric, 0);
            v_topping_total := v_topping_qty * v_topping_price * r.quantity;

            select coalesce(has_bom, false) into v_has_bom
            from public.products where id = v_topping_product_id;

            if v_has_bom then
              v_bom_result := public.consume_bom_for_sale(
                v_tenant_id, v_branch_id, v_topping_product_id, v_topping_qty * r.quantity,
                v_invoice_id, p_created_by, v_invoice_code
              );
              v_bom_results := v_bom_results || jsonb_build_object(
                'product_id', v_topping_product_id,
                'product_name', v_topping_name,
                'sale_qty', v_topping_qty * r.quantity,
                'topping', true,
                'result', v_bom_result
              );
            else
              insert into public.stock_movements (
                tenant_id, branch_id, product_id, type, quantity,
                reference_type, reference_id, note, created_by
              ) values (
                v_tenant_id, v_branch_id, v_topping_product_id, 'out',
                v_topping_qty * r.quantity, 'invoice', v_invoice_id,
                'Topping ' || v_topping_name || ' - ' || v_invoice_code, p_created_by
              );

              perform public.increment_product_stock(v_topping_product_id, -(v_topping_qty * r.quantity));
              perform public.upsert_branch_stock(v_tenant_id, v_branch_id, v_topping_product_id, -(v_topping_qty * r.quantity));

              begin
                perform public.allocate_lots_fifo(v_tenant_id, v_topping_product_id, v_branch_id, v_topping_qty * r.quantity, 'invoice', v_invoice_id);
              exception when others then null;
              end;
            end if;
          end if;
        end if;
      end loop;
    end if;
  end loop;

  -- 7. Cash transactions (giữ logic commission-aware)
  if v_actual_paid > 0 then
    if p_payment_method = 'mixed'
       and p_payment_breakdown is not null
       and jsonb_typeof(p_payment_breakdown) = 'array'
       and jsonb_array_length(p_payment_breakdown) > 0
       and v_commission_amount = 0
    then
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
            counterparty, payment_method,
            reference_type, reference_id, note, created_by, shift_id
          ) values (
            v_tenant_id, v_branch_id, v_cash_code, 'receipt', 'Bán hàng', v_amount,
            v_customer_name, v_method,
            'invoice', v_invoice_id,
            'Thu tiền HĐ ' || v_invoice_code || ' (' || v_method_label || ')',
            p_created_by, p_shift_id
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
        counterparty, payment_method,
        reference_type, reference_id, note, created_by, shift_id
      ) values (
        v_tenant_id, v_branch_id, v_cash_code, 'receipt', 'Bán hàng',
        v_actual_paid, v_customer_name,
        case
          when v_commission_amount > 0 then 'transfer'
          when p_payment_method = 'mixed' then 'cash'
          else p_payment_method
        end,
        'invoice', v_invoice_id,
        case
          when v_commission_amount > 0
          then 'Thu thực HĐ ' || v_invoice_code
               || ' (gross ' || v_total_gross::text
               || ' - phí sàn ' || v_commission_amount::text || ')'
          else 'Thu tiền HĐ ' || v_invoice_code
        end,
        p_created_by, p_shift_id
      );
    end if;
  end if;

  -- 8. Link invoice + release table
  update public.kitchen_orders
  set invoice_id = v_invoice_id, status = 'completed', updated_at = now()
  where id = p_kitchen_order_id;

  if v_order.table_id is not null then
    update public.restaurant_tables
    set status = 'available', current_order_id = null, updated_at = now()
    where id = v_order.table_id and current_order_id = p_kitchen_order_id;
  end if;

  return jsonb_build_object(
    'invoice_id', v_invoice_id,
    'invoice_code', v_invoice_code,
    'total', v_total,
    'total_gross', v_total_gross,
    'platform_commission', v_commission_amount,
    'platform_commission_percent', v_commission_percent,
    'paid', v_actual_paid,
    'debt', greatest(0, v_total - v_actual_paid),
    'bom_consume_results', v_bom_results
  );
end;
$$;

grant execute on function public.fnb_complete_payment_atomic(uuid, uuid, text, text, jsonb, numeric, numeric, text, uuid, uuid, numeric) to authenticated;

comment on function public.fnb_complete_payment_atomic is
  'FnB payment v5 — SKU/topping có BOM chỉ trừ NVL (không tự trừ tồn). CEO 29/05/2026.';

-- ────────────────────────────────────────────────────────────────
-- 3. SỬA DATA CŨ (chạy 1 lần, có guard idempotent) — tenant OneBiz Coffee Demo
--    HD001191 bán thật 1 lon nhưng đường cũ trừ tồn SKU thay vì NVL.
--    → SKU-SUA-003 về 0, NVL-SUA-002 trừ 1 Lon (1938.68 → 1937.68).
-- ────────────────────────────────────────────────────────────────
do $$
declare
  v_tenant uuid := '148e8ac5-b891-4de3-9055-cfa41f39ddb0';
  v_branch uuid := '558adc8f-a629-4ae6-90a6-d13c2a83896c';
  v_sku uuid := 'f726a3af-ee3c-4b83-ac14-a60fdbb1cb80';  -- SKU-SUA-003
  v_nvl uuid := '3ad49c9e-03bd-4840-8425-c80dc921b46d';  -- NVL-SUA-002
  v_inv uuid;
  v_creator uuid;
begin
  select id, created_by into v_inv, v_creator
  from public.invoices
  where code = 'HD001191' and tenant_id = v_tenant
  limit 1;

  -- Chỉ chạy nếu chưa từng bù trừ NVL cho hóa đơn này (idempotent)
  if v_inv is not null and not exists (
    select 1 from public.stock_movements
    where reference_id = v_inv and product_id = v_nvl and reference_type = 'bom_consume'
  ) then
    -- 3a. SKU về 0 (SKU không giữ tồn) — bù 'in' để ledger khớp snapshot
    insert into public.stock_movements (
      tenant_id, branch_id, product_id, type, quantity,
      reference_type, reference_id, note, created_by
    ) values (
      v_tenant, v_branch, v_sku, 'in', 1,
      'adjustment', v_inv,
      'Sửa lỗi BOM: SKU không giữ tồn — đưa tồn SKU-SUA-003 về 0 (HD001191)', v_creator
    );
    update public.products set stock = 0 where id = v_sku;
    update public.branch_stock set quantity = 0
      where product_id = v_sku and branch_id = v_branch;

    -- 3b. NVL trừ 1 Lon (HD001191 bán thật) + ghi movement bom_consume
    insert into public.stock_movements (
      tenant_id, branch_id, product_id, type, quantity,
      reference_type, reference_id, note, created_by
    ) values (
      v_tenant, v_branch, v_nvl, 'out', 1,
      'bom_consume', v_inv,
      'Bù trừ NVL cho HD001191 (lỗi cũ trừ tồn SKU thay vì NVL)', v_creator
    );
    perform public.increment_product_stock(v_nvl, -1);
    perform public.upsert_branch_stock(v_tenant, v_branch, v_nvl, -1);
  end if;
end $$;

notify pgrst, 'reload schema';

-- ============================================================
-- VERIFY (chạy thủ công sau migration):
--   select code, stock from public.products
--   where code in ('SKU-SUA-003','NVL-SUA-002');
--   → kỳ vọng: SKU-SUA-003 = 0, NVL-SUA-002 = 1937.68
-- ============================================================
