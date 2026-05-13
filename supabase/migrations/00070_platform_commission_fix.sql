-- ============================================================
-- 00070: Fix platform commission tracking — Phương án A (Cash basis)
--
-- CEO 13/05/2026 chốt: khi đơn Shopee Food/Grab hoàn thành, ghi sổ quỹ
-- NGAY số THỰC THU (đã trừ phí sàn). Sàn giữ phí sàn, quán nhận thực thu
-- sau 7-30 ngày (real cashflow), nhưng theo Cash basis mình ghi nhận ngay
-- để báo cáo doanh thu khớp realtime.
--
-- BUG ĐÃ FIX:
--   1. kitchen_orders.platform_commission lưu nhầm lẫn % và VND
--      → Tách thành 2 cột: _percent (%) và _amount (VND)
--   2. RPC fnb_complete_payment_atomic KHÔNG trừ commission vào total
--      → Total = subtotal - discount + delivery + tip - commission_amount
--   3. cash_transactions.amount = full total (sai)
--      → Đổi thành = total_net (thực thu)
--
-- Sau migration:
--   invoices.subtotal           = giá khách trả qua app (gross)
--   invoices.total              = thực thu (đã trừ commission)
--   invoices.platform_commission = số VND phí sàn
--   invoices.platform_commission_percent = số % để audit
--   cash_transactions.amount    = thực thu (= invoices.total)
-- ============================================================

-- ────────────────────────────────────────────────────────────────
-- 1. Tách field ở kitchen_orders + invoices
-- ────────────────────────────────────────────────────────────────
alter table public.kitchen_orders
  add column if not exists platform_commission_percent numeric(5, 2) not null default 0,
  add column if not exists platform_commission_amount numeric(15, 2) not null default 0;

alter table public.invoices
  add column if not exists platform_commission_percent numeric(5, 2) not null default 0;

comment on column public.kitchen_orders.platform_commission_percent is
  'Phần trăm phí sàn (Shopee Food/Grab/...). 0-100. Lưu khi cashier setDeliveryPlatform.';
comment on column public.kitchen_orders.platform_commission_amount is
  'Số tiền phí sàn = subtotal × percent / 100. Tính khi thanh toán (RPC fnb_complete_payment_atomic).';
comment on column public.invoices.platform_commission_percent is
  'Snapshot % phí sàn lúc thanh toán. Audit để biết tại sao commission_amount ra số này.';
comment on column public.invoices.platform_commission is
  '[Sau migration 00070] Số tiền phí sàn (VND), trừ vào total. Trước đây có thể lưu lẫn lộn % và VND.';

-- ────────────────────────────────────────────────────────────────
-- 2. Backfill — Anh đang setup chưa có data → an toàn set 0
-- ────────────────────────────────────────────────────────────────
-- Nếu kitchen_orders.platform_commission cũ có giá trị > 0 và <= 100,
-- ta assume đó là % (theo logic client hiện tại) → migrate sang _percent.
-- Nếu > 100, an toàn ignore (set 0 cho cả 2 column mới).
update public.kitchen_orders
set platform_commission_percent = case
      when platform_commission > 0 and platform_commission <= 100
        then platform_commission
      else 0
    end,
    platform_commission_amount = 0  -- chưa biết subtotal lúc gửi bếp → để 0
where platform_commission_percent = 0;  -- chỉ backfill row chưa có giá trị mới

-- Invoices cũ: platform_commission đa số = 0 (RPC cũ không populate),
-- giữ nguyên 0. _percent cũng giữ 0. Đơn mới sau migration sẽ ghi đúng.

-- ────────────────────────────────────────────────────────────────
-- 3. Patch fnb_complete_payment_atomic — tính commission_amount + trừ vào total
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
  v_total numeric;          -- THỰC THU (gross - discount + fee + tip - commission)
  v_total_gross numeric;    -- Khách trả qua app (chưa trừ commission, dùng để audit)
  v_tax_total numeric := 0;
  v_cash_code text;
  v_customer_name text;
  v_note text;
  v_actual_paid numeric;    -- Số ghi sổ quỹ — với delivery commission > 0, force = v_total
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
begin
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

  if p_shift_id is not null then
    if not exists (
      select 1 from public.shifts
      where id = p_shift_id and status = 'open' and branch_id = v_branch_id
    ) then
      raise exception 'Ca % không tồn tại hoặc đã đóng', p_shift_id;
    end if;
  end if;

  v_invoice_code := public.next_code(v_tenant_id, 'invoice');
  if v_invoice_code is null or v_invoice_code = '' then
    v_invoice_code := 'HD' || extract(epoch from now())::bigint::text;
  end if;

  -- Tính subtotal từ items + toppings
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

  -- TỔNG GROSS (giá khách trả qua app — chỉ dùng để audit, KHÔNG ghi sổ quỹ)
  v_total_gross := v_items_subtotal - v_total_discount + v_delivery_fee + v_tip;

  -- COMMISSION AMOUNT — tính trên gross (chuẩn Shopee Food/Grab)
  -- Round 0 decimal (VND không có lẻ)
  v_commission_amount := round(v_total_gross * v_commission_percent / 100);

  -- THỰC THU (số ghi vào invoices.total + cash_transactions.amount)
  v_total := v_total_gross - v_commission_amount;
  if v_total < 0 then
    v_total := 0;  -- guard edge case (commission > 100%, đáng raise nhưng giữ safe)
  end if;

  -- Phương án A (Cash basis): nếu commission > 0 (đơn online qua sàn) →
  -- force ghi sổ quỹ NGAY số thực thu, ignore p_paid client truyền
  -- (vì khách thanh toán qua app, không qua tay quán).
  -- Với đơn dine_in/takeaway/direct: dùng p_paid như cũ.
  if v_commission_amount > 0 then
    v_actual_paid := v_total;  -- thực thu = sẽ ghi sổ ngay
    v_payment_method_effective := 'transfer';  -- sàn chuyển khoản
  else
    v_actual_paid := p_paid;
    v_payment_method_effective := p_payment_method;
  end if;

  -- Insert invoice với đầy đủ trường commission
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

  -- Update kitchen_orders.platform_commission_amount snapshot (để audit)
  update public.kitchen_orders
  set platform_commission_amount = v_commission_amount
  where id = p_kitchen_order_id;

  -- Invoice items + stock decrements (giống logic cũ)
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

    -- Topping stock
    if r.toppings is not null then
      for t in select * from jsonb_array_elements(r.toppings) loop
        v_topping_qty := coalesce((t->>'quantity')::numeric, 0);
        if v_topping_qty > 0 then
          v_topping_product_id := nullif(t->>'product_id', '')::uuid;
          if v_topping_product_id is not null then
            v_topping_name := coalesce(t->>'name', 'Topping');
            v_topping_price := coalesce((t->>'price')::numeric, 0);
            v_topping_total := v_topping_qty * v_topping_price * r.quantity;

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
      end loop;
    end if;
  end loop;

  -- Cash transactions — ghi sổ quỹ THỰC THU
  if v_actual_paid > 0 then
    if p_payment_method = 'mixed'
       and p_payment_breakdown is not null
       and jsonb_typeof(p_payment_breakdown) = 'array'
       and jsonb_array_length(p_payment_breakdown) > 0
       and v_commission_amount = 0  -- chỉ mixed cho đơn dine_in/takeaway
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
            when 'card' then 'thẻ'
            else v_method
          end;

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
        v_actual_paid,  -- THỰC THU (đã trừ commission nếu đơn online)
        v_customer_name,
        case
          when v_commission_amount > 0 then 'transfer'  -- sàn chuyển khoản
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
    'debt', greatest(0, v_total - v_actual_paid)
  );
end;
$$;

grant execute on function public.fnb_complete_payment_atomic(uuid, uuid, text, text, jsonb, numeric, numeric, text, uuid, uuid, numeric) to authenticated;

notify pgrst, 'reload schema';
