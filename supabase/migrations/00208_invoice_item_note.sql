-- 00208 — POS: ghi chú từng món (CEO 19/07)
-- 1) invoice_items.note (nullable — an toàn, writer cũ không cần sửa).
-- 2) pos_complete_checkout_atomic: chép NGUYÊN bản sống 00123, chỉ thêm ghi
--    note từ item JSON vào invoice_items (3 chỗ đánh dấu -- [00208]).
-- Luồng nháp (saveDraftOrder) ghi note phía TS, không cần sửa RPC draft.

alter table public.invoice_items
  add column if not exists note text;

comment on column public.invoice_items.note is
  'Ghi chú từng món từ giỏ POS (00208). NULL = không có.';

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
  v_should_cascade boolean;
  v_bom_result jsonb;
  v_bom_results jsonb := '[]'::jsonb;
  v_item_note text; -- [00208]
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

  -- Loop items: insert invoice_items + trừ tồn (theo has_bom + cascade_mode)
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product_id := (v_item->>'productId')::uuid;
    v_product_name := coalesce(nullif(v_item->>'productName', ''), 'Sản phẩm');
    v_unit := coalesce(nullif(v_item->>'unit', ''), 'Cái');
    v_qty := coalesce((v_item->>'quantity')::numeric, 0);
    v_unit_price := coalesce((v_item->>'unitPrice')::numeric, 0);
    v_discount := coalesce((v_item->>'discount')::numeric, 0);
    v_vat_rate := coalesce((v_item->>'vatRate')::numeric, 0);
    v_item_note := nullif(trim(coalesce(v_item->>'note', '')), ''); -- [00208]
    v_line_before_tax := (v_qty * v_unit_price) - v_discount;
    v_vat_amt := round(v_line_before_tax * v_vat_rate / 100);

    if v_product_id is null or v_qty <= 0 then
      raise exception 'Invalid POS item: %', v_item;
    end if;

    insert into public.invoice_items (
      invoice_id, product_id, product_name, unit,
      quantity, unit_price, discount, vat_rate, vat_amount, total, note -- [00208]
    ) values (
      v_invoice_id, v_product_id, v_product_name, v_unit,
      v_qty, v_unit_price, v_discount, v_vat_rate, v_vat_amt, v_line_before_tax,
      v_item_note -- [00208]
    );

    -- ─── CEO 03/06/2026: cascade BOM theo cascade_mode ───
    select coalesce(has_bom, false) into v_has_bom
    from public.products where id = v_product_id;

    if v_has_bom then
      -- Check should cascade tại branch này
      v_should_cascade := public.should_cascade_bom_at_branch(v_product_id, p_branch_id);

      if v_should_cascade then
        -- Production branch HOẶC outlet có BOM riêng → cascade
        v_bom_result := public.consume_bom_for_sale(
          p_tenant_id, p_branch_id, v_product_id, v_qty, v_invoice_id, p_created_by, v_invoice_code
        );
        v_bom_results := v_bom_results || jsonb_build_object(
          'product_id', v_product_id,
          'product_name', v_product_name,
          'sale_qty', v_qty,
          'cascade', true,
          'result', v_bom_result
        );
      else
        -- Outlet branch + BOM global → trừ tồn SKU trực tiếp
        insert into public.stock_movements (
          tenant_id, branch_id, product_id, type, quantity,
          reference_type, reference_id, note, created_by
        ) values (
          p_tenant_id, p_branch_id, v_product_id, 'out', v_qty,
          'invoice', v_invoice_id,
          'POS bán hàng (outlet, không cascade) - ' || v_invoice_code, p_created_by
        );

        perform public.increment_product_stock(v_product_id, -v_qty);
        perform public.upsert_branch_stock(p_tenant_id, p_branch_id, v_product_id, -v_qty);

        begin
          perform public.allocate_lots_fifo(
            p_tenant_id, v_product_id, p_branch_id, v_qty, 'invoice', v_invoice_id
          );
        exception when others then null;
        end;

        v_bom_results := v_bom_results || jsonb_build_object(
          'product_id', v_product_id,
          'product_name', v_product_name,
          'sale_qty', v_qty,
          'cascade', false,
          'reason', 'outlet_no_branch_bom'
        );
      end if;
    else
      -- SP không có BOM: trừ tồn chính nó như cũ
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

  -- Cash transactions (mixed support) — giữ logic v4
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
  'Atomic retail POS checkout v6 (00208): v5 + ghi invoice_items.note từ item JSON.';

-- Giữ khóa client như 00204 (REPLACE giữ ACL nhưng nhắc lại cho chắc).
revoke all on function public.pos_complete_checkout_atomic(
  uuid, uuid, uuid, uuid, text, jsonb, text, jsonb, numeric, numeric,
  numeric, numeric, text, text, uuid, uuid, numeric, numeric, text
) from public, anon, authenticated;
grant execute on function public.pos_complete_checkout_atomic(
  uuid, uuid, uuid, uuid, text, jsonb, text, jsonb, numeric, numeric,
  numeric, numeric, text, text, uuid, uuid, numeric, numeric, text
) to service_role;

notify pgrst, 'reload schema';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'invoice_items' and column_name = 'note'
  ) then
    raise exception '00208 FAIL: thiếu cột invoice_items.note';
  end if;
  raise notice '00208 OK: invoice_items.note + RPC v6 ghi note.';
end $$;
