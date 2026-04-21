-- ============================================================
-- 00027 — Atomic FnB Payment RPC
-- ============================================================
-- Sprint Go-Live Hardening — P2 CRITICAL.
--
-- Vấn đề: fnbPayment() hiện tại chia 4 round-trip client→server:
--   1) getKitchenOrderById
--   2) posCheckout (tự nó gồm ~6 calls: invoice + items + stock_movements + product_stock + branch_stock + cash_transaction)
--   3) linkInvoiceToOrder
--   4) releaseTable
--
-- Nếu mạng drop giữa bất kỳ bước → inconsistent state:
--   - Invoice đã tạo nhưng kitchen_order chưa link → orphan
--   - Table đã claim nhưng không release
--   - Stock đã trừ nhưng cash chưa ghi → lệch sổ quỹ
--
-- Giải pháp: 1 RPC Postgres `fnb_complete_payment_atomic` bọc toàn bộ
-- trong 1 transaction. Hoặc commit tất cả, hoặc rollback tất cả.
-- ============================================================

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
begin
  -- ────────────────────────────────────────────────
  -- 1. Load + validate kitchen order
  -- ────────────────────────────────────────────────
  select * into v_order
  from public.kitchen_orders
  where id = p_kitchen_order_id;

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

  -- ────────────────────────────────────────────────
  -- 2. Generate invoice code
  -- ────────────────────────────────────────────────
  v_invoice_code := public.next_code(v_tenant_id, 'invoice');
  if v_invoice_code is null or v_invoice_code = '' then
    v_invoice_code := 'HD' || extract(epoch from now())::bigint::text;
  end if;

  -- ────────────────────────────────────────────────
  -- 3. Pre-compute subtotal + tax (iterate items + toppings)
  -- ────────────────────────────────────────────────
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
      for t in select * from jsonb_array_elements(r.toppings)
      loop
        v_topping_qty := coalesce((t->>'quantity')::numeric, 0);
        if v_topping_qty > 0 then
          v_topping_price := coalesce((t->>'price')::numeric, 0);
          v_items_subtotal := v_items_subtotal + (v_topping_qty * v_topping_price * r.quantity);
        end if;
      end loop;
    end if;
  end loop;

  v_total_discount := coalesce(v_order.discount_amount, 0) + coalesce(p_discount_amount, 0);
  v_total := v_items_subtotal - v_total_discount + v_delivery_fee;

  -- ────────────────────────────────────────────────
  -- 4. Insert invoice (status=completed)
  -- ────────────────────────────────────────────────
  insert into public.invoices (
    tenant_id, branch_id, code,
    customer_id, customer_name, status,
    subtotal, discount_amount, tax_amount, total, paid, debt,
    payment_method, source, note, created_by
  ) values (
    v_tenant_id, v_branch_id, v_invoice_code,
    p_customer_id, v_customer_name, 'completed',
    v_items_subtotal, v_total_discount, v_tax_total, v_total, p_paid,
    greatest(0, v_total - p_paid),
    p_payment_method, 'fnb', v_note, p_created_by
  ) returning id into v_invoice_id;

  -- ────────────────────────────────────────────────
  -- 5. Expand items + toppings → invoice_items + stock_movements + decrement stock
  -- ────────────────────────────────────────────────
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

    -- 5a. Main invoice item
    insert into public.invoice_items (
      invoice_id, product_id, product_name, unit,
      quantity, unit_price, discount, vat_rate, vat_amount, total
    ) values (
      v_invoice_id, r.product_id,
      case when r.variant_label is not null and r.variant_label <> ''
           then r.product_name || ' (' || r.variant_label || ')'
           else r.product_name end,
      'Cái',
      r.quantity, r.unit_price, 0, v_vat_rate, v_vat_amt, v_line_before_tax
    );

    -- 5b. Stock movement + decrement (main)
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

    -- 5c. FIFO lot allocation (best-effort — swallow errors nếu product không track lot)
    begin
      perform public.allocate_lots_fifo(
        v_tenant_id, r.product_id, v_branch_id,
        r.quantity, 'invoice', v_invoice_id
      );
    exception when others then
      null;
    end;

    -- 5d. Toppings (each = separate invoice_item + stock)
    if r.toppings is not null then
      for t in select * from jsonb_array_elements(r.toppings)
      loop
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
            v_invoice_id, v_topping_product_id, v_topping_name,
            'Cái',
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
          exception when others then
            null;
          end;
        end if;
      end loop;
    end if;
  end loop;

  -- ────────────────────────────────────────────────
  -- 6. Cash transactions (phiếu thu) — support mixed
  -- ────────────────────────────────────────────────
  if p_paid > 0 then
    if p_payment_method = 'mixed'
       and p_payment_breakdown is not null
       and jsonb_typeof(p_payment_breakdown) = 'array'
       and jsonb_array_length(p_payment_breakdown) > 0
    then
      for v_breakdown_item in select * from jsonb_array_elements(p_payment_breakdown)
      loop
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
            when 'card' then 'thẻ'
            else v_method
          end;

          insert into public.cash_transactions (
            tenant_id, branch_id, code, type, category, amount,
            counterparty, payment_method,
            reference_type, reference_id, note, created_by
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
        counterparty, payment_method,
        reference_type, reference_id, note, created_by
      ) values (
        v_tenant_id, v_branch_id, v_cash_code, 'receipt', 'Bán hàng', p_paid,
        v_customer_name,
        case when p_payment_method = 'mixed' then 'cash' else p_payment_method end,
        'invoice', v_invoice_id,
        'Thu tiền HĐ ' || v_invoice_code, p_created_by
      );
    end if;
  end if;

  -- ────────────────────────────────────────────────
  -- 7. Link invoice → kitchen_order + mark completed
  -- ────────────────────────────────────────────────
  update public.kitchen_orders
  set invoice_id = v_invoice_id,
      status = 'completed',
      updated_at = now()
  where id = p_kitchen_order_id;

  -- ────────────────────────────────────────────────
  -- 8. Release table (chỉ khi table hiện đang claim đúng order này)
  -- ────────────────────────────────────────────────
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
    'paid', p_paid,
    'debt', greatest(0, v_total - p_paid)
  );
end;
$$;

comment on function public.fnb_complete_payment_atomic is
  'Atomic F&B payment: creates invoice + items + stock + cash + links kitchen_order + releases table. All-or-nothing transaction — replaces multi-step fnbPayment() that had data integrity risk.';
