-- ============================================================
-- 00055 - POS/FnB atomic hardening
-- ============================================================
-- Adds transactional RPCs for flows that previously spanned multiple
-- browser round-trips. Code calls these RPCs when present and falls back to
-- the legacy flow when the migration has not been applied yet.
-- ============================================================

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
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'POS checkout requires at least one item';
  end if;

  if p_shift_id is not null and not exists (
    select 1
    from public.shifts
    where id = p_shift_id
      and tenant_id = p_tenant_id
      and branch_id = p_branch_id
      and status = 'open'
  ) then
    raise exception 'Shift % is not open for this branch', p_shift_id;
  end if;

  if v_session_id is not null then
    select id, code, status into v_existing
    from public.invoices
    where tenant_id = p_tenant_id
      and client_session_id = v_session_id
    order by created_at desc
    limit 1;

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

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := coalesce((v_item->>'quantity')::numeric, 0);
    v_unit_price := coalesce((v_item->>'unitPrice')::numeric, 0);
    v_discount := coalesce((v_item->>'discount')::numeric, 0);
    v_vat_rate := coalesce((v_item->>'vatRate')::numeric, 0);
    v_line_before_tax := (v_qty * v_unit_price) - v_discount;
    v_vat_amt := round(v_line_before_tax * v_vat_rate / 100);
    v_tax_total := v_tax_total + v_vat_amt;
  end loop;

  begin
    insert into public.invoices (
      tenant_id, branch_id, code,
      customer_id, customer_name, status,
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
      where tenant_id = p_tenant_id
        and client_session_id = v_session_id
      order by created_at desc
      limit 1;

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

  for v_item in select * from jsonb_array_elements(p_items)
  loop
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
    exception when others then
      null;
    end;
  end loop;

  if coalesce(p_paid, 0) > 0 then
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
          v_cash_code := public.next_code(p_tenant_id, 'cash_receipt');
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
    'debt', greatest(0, coalesce(p_total, 0) - coalesce(p_paid, 0))
  );
end;
$$;

comment on function public.pos_complete_checkout_atomic is
  'Atomic retail POS checkout: invoice, items, stock movements, stock snapshots, cash receipt.';

create or replace function public.fnb_send_to_kitchen_atomic(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_created_by uuid,
  p_table_id uuid default null,
  p_order_type text default 'dine_in',
  p_note text default null,
  p_idempotency_key text default null,
  p_order_number text default null,
  p_items jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_order_id uuid;
  v_order_number text;
  v_existing record;
  v_item jsonb;
  v_product_id uuid;
  v_station_id uuid;
  v_claimed int;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Kitchen order requires at least one item';
  end if;

  if p_idempotency_key is not null and p_idempotency_key <> '' then
    select id, order_number into v_existing
    from public.kitchen_orders
    where tenant_id = p_tenant_id
      and idempotency_key = p_idempotency_key
    limit 1;

    if found then
      return jsonb_build_object(
        'kitchen_order_id', v_existing.id,
        'order_number', v_existing.order_number,
        'idempotent', true
      );
    end if;
  end if;

  v_order_number := coalesce(nullif(p_order_number, ''), public.next_code(p_tenant_id, 'kitchen_order'));
  if v_order_number is null or v_order_number = '' then
    v_order_number := 'KB' || extract(epoch from now())::bigint::text;
  end if;

  insert into public.kitchen_orders (
    tenant_id, branch_id, table_id, order_number, order_type,
    note, created_by, idempotency_key
  ) values (
    p_tenant_id, p_branch_id, p_table_id, v_order_number, p_order_type,
    p_note, p_created_by, nullif(p_idempotency_key, '')
  ) returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'productId')::uuid;
    select c.kitchen_station_id into v_station_id
    from public.products p
    left join public.categories c on c.id = p.category_id and c.tenant_id = p.tenant_id
    where p.tenant_id = p_tenant_id and p.id = v_product_id
    limit 1;

    insert into public.kitchen_order_items (
      kitchen_order_id, product_id, product_name,
      variant_id, variant_label, quantity, unit_price,
      note, toppings, kitchen_station_id
    ) values (
      v_order_id,
      v_product_id,
      coalesce(nullif(v_item->>'productName', ''), 'Sản phẩm'),
      nullif(v_item->>'variantId', '')::uuid,
      nullif(v_item->>'variantLabel', ''),
      coalesce((v_item->>'quantity')::numeric, 0),
      coalesce((v_item->>'unitPrice')::numeric, 0),
      nullif(v_item->>'note', ''),
      v_item->'toppings',
      v_station_id
    );
  end loop;

  if p_order_type = 'dine_in' and p_table_id is not null then
    update public.restaurant_tables
    set status = 'occupied', current_order_id = v_order_id, updated_at = now()
    where tenant_id = p_tenant_id
      and id = p_table_id
      and status = 'available';

    get diagnostics v_claimed = row_count;
    if v_claimed = 0 then
      raise exception 'Table % is not available', p_table_id;
    end if;
  end if;

  return jsonb_build_object(
    'kitchen_order_id', v_order_id,
    'order_number', v_order_number
  );
exception when unique_violation then
  if p_idempotency_key is not null and p_idempotency_key <> '' then
    select id, order_number into v_existing
    from public.kitchen_orders
    where tenant_id = p_tenant_id
      and idempotency_key = p_idempotency_key
    limit 1;

    if found then
      return jsonb_build_object(
        'kitchen_order_id', v_existing.id,
        'order_number', v_existing.order_number,
        'idempotent', true
      );
    end if;
  end if;
  raise;
end;
$$;

comment on function public.fnb_send_to_kitchen_atomic is
  'Atomic F&B send-to-kitchen: order, items, and table claim in one transaction.';

create or replace function public.fnb_transfer_table_atomic(
  p_tenant_id uuid,
  p_order_id uuid,
  p_from_table_id uuid,
  p_to_table_id uuid
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_count int;
begin
  update public.restaurant_tables
  set status = 'occupied', current_order_id = p_order_id, updated_at = now()
  where tenant_id = p_tenant_id
    and id = p_to_table_id
    and status = 'available';

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'Destination table % is not available', p_to_table_id;
  end if;

  update public.restaurant_tables
  set status = 'available', current_order_id = null, updated_at = now()
  where tenant_id = p_tenant_id
    and id = p_from_table_id
    and current_order_id = p_order_id;

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'Source table % is not linked to order %', p_from_table_id, p_order_id;
  end if;

  update public.kitchen_orders
  set table_id = p_to_table_id, original_table_id = p_from_table_id, updated_at = now()
  where tenant_id = p_tenant_id
    and id = p_order_id;

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'Kitchen order % not found', p_order_id;
  end if;

  return jsonb_build_object('success', true);
end;
$$;

comment on function public.fnb_transfer_table_atomic is
  'Atomic F&B table transfer with rollback if any table/order update fails.';

create or replace function public.fnb_void_invoice_atomic(
  p_invoice_id uuid,
  p_kitchen_order_id uuid,
  p_void_reason text,
  p_voided_by uuid,
  p_tenant_id uuid,
  p_branch_id uuid,
  p_shift_id uuid default null
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_invoice record;
  v_item record;
  v_cash_code text;
begin
  select id, code, status, paid, shift_id into v_invoice
  from public.invoices
  where tenant_id = p_tenant_id
    and id = p_invoice_id
  for update;

  if not found then
    raise exception 'Invoice % not found', p_invoice_id;
  end if;

  if v_invoice.status = 'cancelled' then
    raise exception 'Invoice % was already voided', v_invoice.code;
  end if;

  update public.invoices
  set status = 'cancelled',
      void_reason = p_void_reason,
      voided_at = now(),
      voided_by = p_voided_by
  where tenant_id = p_tenant_id
    and id = p_invoice_id;

  for v_item in
    select product_id, product_name, quantity
    from public.invoice_items
    where invoice_id = p_invoice_id
      and product_id is not null
  loop
    insert into public.stock_movements (
      tenant_id, branch_id, product_id, type, quantity,
      reference_type, reference_id, note, created_by
    ) values (
      p_tenant_id, p_branch_id, v_item.product_id, 'in', v_item.quantity,
      'invoice_void', p_invoice_id,
      'Hoàn trả - hủy HĐ ' || v_invoice.code || ': ' || coalesce(p_void_reason, ''),
      p_voided_by
    );

    perform public.increment_product_stock(v_item.product_id, v_item.quantity);
    perform public.upsert_branch_stock(p_tenant_id, p_branch_id, v_item.product_id, v_item.quantity);
  end loop;

  if coalesce(v_invoice.paid, 0) > 0 then
    v_cash_code := public.next_code(p_tenant_id, 'cash_payment');
    if v_cash_code is null or v_cash_code = '' then
      v_cash_code := 'PC' || extract(epoch from now())::bigint::text;
    end if;

    insert into public.cash_transactions (
      tenant_id, branch_id, code, type, category, amount,
      counterparty, payment_method, reference_type, reference_id,
      note, created_by, shift_id
    ) values (
      p_tenant_id, p_branch_id, v_cash_code, 'payment', 'Hoàn trả', v_invoice.paid,
      'Khách hàng', 'cash', 'invoice', p_invoice_id,
      'Hoàn tiền HĐ ' || v_invoice.code || ': ' || coalesce(p_void_reason, ''),
      p_voided_by, coalesce(p_shift_id, v_invoice.shift_id)
    );
  end if;

  update public.kitchen_orders
  set status = 'cancelled', updated_at = now()
  where tenant_id = p_tenant_id
    and id = p_kitchen_order_id;

  return jsonb_build_object('success', true);
end;
$$;

comment on function public.fnb_void_invoice_atomic is
  'Atomic F&B invoice void: cancel invoice, reverse stock, create refund cash transaction, cancel kitchen order.';
