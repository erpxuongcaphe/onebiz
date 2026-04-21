-- ============================================================
-- 00030 — Shift Integrity: gắn shift_id vào cash_transactions
--         + atomic close_shift RPC lọc theo shift_id (không theo thời gian)
-- ============================================================
--
-- Vấn đề hiện tại:
--   1. closeShift() tính expected_cash bằng query theo branch_id + time range
--      → NHIỀU CA TRÙNG CHI NHÁNH → số liệu bị trộn (cashier A kết ca tính
--      luôn cash của cashier B).
--   2. cash_transactions KHÔNG có shift_id → không filter được chuẩn.
--   3. fnb_complete_payment_atomic KHÔNG nhận shift_id → invoices.shift_id
--      luôn null → báo cáo ca không có data.
--   4. POS Retail KHÔNG link invoice.shift_id.
--
-- Giải pháp:
--   1. Thêm cột shift_id vào cash_transactions (FK → shifts, on delete set null).
--   2. Override fnb_complete_payment_atomic để nhận p_shift_id và ghi vào
--      cả invoices.shift_id + cash_transactions.shift_id.
--   3. Tạo RPC close_shift_atomic:
--      - Lọc CHỈ theo invoice.shift_id = v_shift_id + cash_transactions.shift_id
--      - All-or-nothing update (status + expected + actual + variance)
--      - Return JSON để UI in báo cáo.
-- ============================================================

-- 1. Column ──────────────────────────────────────────────────

alter table public.cash_transactions
  add column if not exists shift_id uuid references public.shifts(id) on delete set null;

create index if not exists idx_cash_transactions_shift on public.cash_transactions(shift_id);
create index if not exists idx_invoices_shift on public.invoices(shift_id);

comment on column public.cash_transactions.shift_id is
  'FK → shifts.id. Set khi giao dịch được tạo trong 1 ca mở. NULL cho giao dịch ngoài ca (migration data).';

-- 2. Override fnb_complete_payment_atomic với p_shift_id ─────

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
  p_shift_id uuid default null
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
  v_customer_name := coalesce(nullif(p_customer_name, ''), 'Khách lẻ');
  v_note := coalesce(p_note, 'F&B - ' || v_order.order_number);

  -- Validate shift (nếu có)
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

  -- 3. Pre-compute subtotal + tax
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
  v_total := v_items_subtotal - v_total_discount + v_delivery_fee;

  -- 4. Insert invoice với shift_id
  insert into public.invoices (
    tenant_id, branch_id, code, customer_id, customer_name, status,
    subtotal, discount_amount, tax_amount, total, paid, debt,
    payment_method, source, note, created_by, shift_id
  ) values (
    v_tenant_id, v_branch_id, v_invoice_code, p_customer_id, v_customer_name, 'completed',
    v_items_subtotal, v_total_discount, v_tax_total, v_total, p_paid,
    greatest(0, v_total - p_paid),
    p_payment_method, 'fnb', v_note, p_created_by, p_shift_id
  ) returning id into v_invoice_id;

  -- 5. Expand items + toppings (giữ nguyên logic cũ)
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
            perform public.allocate_lots_fifo(v_tenant_id, v_topping_product_id, v_branch_id, v_topping_qty, 'invoice', v_invoice_id);
          exception when others then null;
          end;
        end if;
      end loop;
    end if;
  end loop;

  -- 6. Cash transactions — GHI SHIFT_ID
  if p_paid > 0 then
    if p_payment_method = 'mixed'
       and p_payment_breakdown is not null
       and jsonb_typeof(p_payment_breakdown) = 'array'
       and jsonb_array_length(p_payment_breakdown) > 0
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
        v_tenant_id, v_branch_id, v_cash_code, 'receipt', 'Bán hàng', p_paid,
        v_customer_name,
        case when p_payment_method = 'mixed' then 'cash' else p_payment_method end,
        'invoice', v_invoice_id,
        'Thu tiền HĐ ' || v_invoice_code, p_created_by, p_shift_id
      );
    end if;
  end if;

  -- 7. Link invoice → kitchen_order
  update public.kitchen_orders
  set invoice_id = v_invoice_id, status = 'completed', updated_at = now()
  where id = p_kitchen_order_id;

  -- 8. Release table
  if v_order.table_id is not null then
    update public.restaurant_tables
    set status = 'available', current_order_id = null, updated_at = now()
    where id = v_order.table_id and current_order_id = p_kitchen_order_id;
  end if;

  return jsonb_build_object(
    'invoice_id', v_invoice_id,
    'invoice_code', v_invoice_code,
    'total', v_total,
    'paid', p_paid,
    'debt', greatest(0, v_total - p_paid),
    'shift_id', p_shift_id
  );
end;
$$;

-- 3. Atomic close_shift RPC ─────────────────────────────────

create or replace function public.close_shift_atomic(
  p_shift_id uuid,
  p_actual_cash numeric,
  p_note text default null
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_shift record;
  v_cash_in numeric := 0;
  v_cash_out numeric := 0;
  v_expected numeric;
  v_variance numeric;
  v_total_sales numeric := 0;
  v_total_orders int := 0;
  v_sales_by_method jsonb := '{}'::jsonb;
  r record;
begin
  -- Load shift
  select * into v_shift from public.shifts
  where id = p_shift_id and status = 'open'
  for update;
  if not found then
    raise exception 'Ca % không tồn tại hoặc đã đóng', p_shift_id;
  end if;

  -- ── Tính tiền mặt vào/ra TRONG CA (filter theo shift_id) ──
  for r in
    select type, coalesce(amount, 0) as amount,
           coalesce(payment_method, 'cash') as method
    from public.cash_transactions
    where shift_id = p_shift_id
  loop
    if r.method = 'cash' then
      if r.type = 'receipt' then
        v_cash_in := v_cash_in + r.amount;
      else
        v_cash_out := v_cash_out + r.amount;
      end if;
    end if;
  end loop;

  v_expected := coalesce(v_shift.starting_cash, 0) + v_cash_in - v_cash_out;
  v_variance := p_actual_cash - v_expected;

  -- ── Tổng doanh thu + breakdown phương thức (filter theo shift_id) ──
  for r in
    select coalesce(total, 0) as total,
           coalesce(payment_method, 'cash') as method
    from public.invoices
    where shift_id = p_shift_id
      and status <> 'cancelled'
  loop
    v_total_sales := v_total_sales + r.total;
    v_total_orders := v_total_orders + 1;
    v_sales_by_method := jsonb_set(
      v_sales_by_method,
      array[r.method],
      to_jsonb(coalesce((v_sales_by_method->>r.method)::numeric, 0) + r.total)
    );
  end loop;

  -- ── Update shift (atomic) ──
  update public.shifts
  set status          = 'closed',
      closed_at       = now(),
      expected_cash   = v_expected,
      actual_cash     = p_actual_cash,
      cash_difference = v_variance,
      total_sales     = v_total_sales,
      total_orders    = v_total_orders,
      sales_by_method = v_sales_by_method,
      note            = p_note
  where id = p_shift_id;

  return jsonb_build_object(
    'shift_id', p_shift_id,
    'starting_cash', v_shift.starting_cash,
    'cash_in', v_cash_in,
    'cash_out', v_cash_out,
    'expected_cash', v_expected,
    'actual_cash', p_actual_cash,
    'cash_difference', v_variance,
    'total_sales', v_total_sales,
    'total_orders', v_total_orders,
    'sales_by_method', v_sales_by_method,
    'opened_at', v_shift.opened_at,
    'closed_at', now()
  );
end;
$$;

comment on function public.close_shift_atomic is
  'Đóng ca atomic — tính expected_cash + variance + sales breakdown từ invoices/cash_transactions lọc theo shift_id (chính xác tuyệt đối, không trùng với ca khác cùng chi nhánh).';
