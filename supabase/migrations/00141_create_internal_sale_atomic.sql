-- ============================================================
-- 00141: RPC create_internal_sale_atomic — gộp 10+ op internal sale
-- vào 1 transaction (CEO P0-10, 13/06/2026)
--
-- VẤN ĐỀ:
--   createInternalSale() ở service chạy 10+ op rời rạc client-side:
--   1. Resolve internal customer + supplier
--   2. Generate codes (invoice/input_invoice/sale)
--   3. Insert invoice (bên BÁN)
--   4. Insert invoice_items
--   5. Insert input_invoice (bên MUA)
--   6. Stock OUT per line (internal_sale_apply_stock_out)
--   7. Stock IN per line (insert stock_movements + RPCs)
--   8. Cash receipt (bên BÁN, if paid > 0)
--   9. Cash payment (bên MUA, if paid > 0)
--   10. Insert internal_sales header
--   11. Insert internal_sale_items
--
--   Nếu bước 7+ fail giữa chừng → invoice bên BÁN đã completed, stock đã
--   trừ, nhưng bên MUA chưa nhập đủ → data inconsistency. Không có header
--   internal_sales → khó debug.
--
-- GIẢI PHÁP:
--   RPC PG wrap toàn bộ. Nếu bất kỳ step nào throw → ROLLBACK.
--   Service createInternalSale() ưu tiên RPC, fallback luồng cũ nếu
--   RPC chưa apply.
--
-- DEPENDENCIES (đã có sẵn):
--   - public.next_code(tenant_id, entity_type)
--   - public.internal_sale_apply_stock_out(...) — Sprint 3
--   - public.increment_product_stock(product_id, delta)
--   - public.upsert_branch_stock(tenant_id, branch_id, product_id, delta)
--
-- Validation channel + resolve customer/supplier vẫn ở service layer
-- vì cần error message UX-friendly (vd "Chi nhánh mua không có SKU FnB...").
-- ============================================================

create or replace function public.create_internal_sale_atomic(
  p_tenant_id uuid,
  p_from_branch_id uuid,
  p_to_branch_id uuid,
  p_created_by uuid,
  p_int_customer_id uuid,
  p_int_customer_name text,
  p_int_supplier_id uuid,
  p_int_supplier_name text,
  p_items jsonb,
  p_payment_method text default 'transfer',
  p_paid_full boolean default true,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_item jsonb;
  v_product_id uuid;
  v_product_name text;
  v_unit text;
  v_qty numeric;
  v_unit_price numeric;
  v_vat_rate numeric;
  v_line_amount numeric;
  v_line_tax numeric;
  v_subtotal numeric := 0;
  v_tax_total numeric := 0;
  v_total numeric;
  v_paid numeric;
  v_debt numeric;
  v_invoice_code text;
  v_input_inv_code text;
  v_sale_code text;
  v_invoice_id uuid;
  v_input_inv_id uuid;
  v_sale_id uuid;
  v_cash_code text;
  v_pay_method text;
begin
  -- Validate inputs
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'Internal sale requires at least one item';
  end if;
  if p_from_branch_id = p_to_branch_id then
    raise exception 'Chi nhánh bán và chi nhánh mua không được giống nhau';
  end if;

  -- Pre-compute totals
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_item->>'quantity')::numeric, 0);
    v_unit_price := coalesce((v_item->>'unitPrice')::numeric, 0);
    v_vat_rate := coalesce((v_item->>'vatRate')::numeric, 0);
    v_line_amount := round(v_qty * v_unit_price);
    v_line_tax := round(v_line_amount * v_vat_rate / 100);
    v_subtotal := v_subtotal + v_line_amount;
    v_tax_total := v_tax_total + v_line_tax;
  end loop;
  v_total := v_subtotal + v_tax_total;

  -- Payment method: 'debt' → paid=0, else paid=total
  v_pay_method := case when p_payment_method = 'debt' then 'cash'
                       else coalesce(p_payment_method, 'transfer') end;
  v_paid := case when p_paid_full and p_payment_method <> 'debt' then v_total else 0 end;
  v_debt := v_total - v_paid;

  -- Generate codes
  v_invoice_code := public.next_code(p_tenant_id, 'invoice');
  v_input_inv_code := public.next_code(p_tenant_id, 'input_invoice');
  v_sale_code := public.next_code(p_tenant_id, 'internal_sale');
  if v_invoice_code is null or v_invoice_code = '' then
    v_invoice_code := 'HD' || extract(epoch from now())::bigint::text;
  end if;
  if v_input_inv_code is null or v_input_inv_code = '' then
    v_input_inv_code := 'HDV' || extract(epoch from now())::bigint::text;
  end if;
  if v_sale_code is null or v_sale_code = '' then
    v_sale_code := 'BNB' || extract(epoch from now())::bigint::text;
  end if;

  -- 1. Invoice bên BÁN (doanh thu)
  insert into public.invoices (
    tenant_id, branch_id, code, customer_id, customer_name,
    status, subtotal, discount_amount, tax_amount, total, paid, debt,
    payment_method, source, note, created_by
  ) values (
    p_tenant_id, p_from_branch_id, v_invoice_code,
    p_int_customer_id, coalesce(p_int_customer_name, 'Khách nội bộ'),
    'completed', v_subtotal, 0, v_tax_total, v_total, v_paid, v_debt,
    v_pay_method, 'internal',
    'Bán nội bộ ' || v_sale_code || ' → ' || coalesce(p_int_customer_name, 'CN'),
    p_created_by
  ) returning id into v_invoice_id;

  -- 2. Invoice items + stock out + BOM consume per line
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product_id := (v_item->>'productId')::uuid;
    v_product_name := coalesce(nullif(v_item->>'productName', ''), 'Sản phẩm');
    v_unit := coalesce(nullif(v_item->>'unit', ''), 'Cái');
    v_qty := coalesce((v_item->>'quantity')::numeric, 0);
    v_unit_price := coalesce((v_item->>'unitPrice')::numeric, 0);
    v_vat_rate := coalesce((v_item->>'vatRate')::numeric, 0);
    v_line_amount := round(v_qty * v_unit_price);
    v_line_tax := round(v_line_amount * v_vat_rate / 100);

    if v_product_id is null or v_qty <= 0 then
      raise exception 'Invalid internal sale item: %', v_item;
    end if;

    insert into public.invoice_items (
      invoice_id, product_id, product_name, unit,
      quantity, unit_price, discount, vat_rate, vat_amount, total
    ) values (
      v_invoice_id, v_product_id, v_product_name, v_unit,
      v_qty, v_unit_price, 0, v_vat_rate, v_line_tax,
      v_line_amount + v_line_tax
    );

    -- Stock OUT bên BÁN (cascade BOM nếu production branch + has_bom)
    perform public.internal_sale_apply_stock_out(
      p_tenant_id, p_from_branch_id, v_product_id, v_qty,
      v_invoice_id, v_sale_code, p_created_by
    );
  end loop;

  -- 3. Input invoice bên MUA (chi phí)
  insert into public.input_invoices (
    tenant_id, branch_id, code, supplier_id, supplier_name,
    total_amount, tax_amount, status, note, created_by
  ) values (
    p_tenant_id, p_to_branch_id, v_input_inv_code,
    p_int_supplier_id, coalesce(p_int_supplier_name, 'NCC nội bộ'),
    v_total, v_tax_total, 'recorded',
    'Mua nội bộ ' || v_sale_code || ' ← ' || coalesce(p_int_supplier_name, 'CN'),
    p_created_by
  ) returning id into v_input_inv_id;

  -- 4. Stock IN bên MUA per line
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product_id := (v_item->>'productId')::uuid;
    v_product_name := coalesce(nullif(v_item->>'productName', ''), 'Sản phẩm');
    v_qty := coalesce((v_item->>'quantity')::numeric, 0);

    insert into public.stock_movements (
      tenant_id, branch_id, product_id, type, quantity,
      reference_type, reference_id, note, created_by
    ) values (
      p_tenant_id, p_to_branch_id, v_product_id, 'in', v_qty,
      'internal_sale', v_input_inv_id,
      'Nhập nội bộ ' || v_sale_code || ' - ' || v_product_name,
      p_created_by
    );

    perform public.increment_product_stock(v_product_id, v_qty);
    perform public.upsert_branch_stock(p_tenant_id, p_to_branch_id, v_product_id, v_qty);
  end loop;

  -- 5. Cash transactions (nếu không ghi nợ)
  if v_paid > 0 then
    -- Thu tiền bên BÁN
    v_cash_code := public.next_code(p_tenant_id, 'cash_receipt');
    if v_cash_code is null or v_cash_code = '' then
      v_cash_code := 'PT' || extract(epoch from now())::bigint::text;
    end if;
    insert into public.cash_transactions (
      tenant_id, branch_id, code, type, category, amount,
      payment_method, reference_type, reference_id, note, created_by
    ) values (
      p_tenant_id, p_from_branch_id, v_cash_code, 'receipt', 'Bán hàng nội bộ',
      v_paid, v_pay_method, 'invoice', v_invoice_id,
      'Giao dịch nội bộ ' || v_sale_code, p_created_by
    );

    -- Chi tiền bên MUA
    v_cash_code := public.next_code(p_tenant_id, 'cash_payment');
    if v_cash_code is null or v_cash_code = '' then
      v_cash_code := 'PC' || extract(epoch from now())::bigint::text;
    end if;
    insert into public.cash_transactions (
      tenant_id, branch_id, code, type, category, amount,
      payment_method, reference_type, reference_id, note, created_by
    ) values (
      p_tenant_id, p_to_branch_id, v_cash_code, 'payment', 'Mua hàng nội bộ',
      v_paid, v_pay_method, 'input_invoice', v_input_inv_id,
      'Giao dịch nội bộ ' || v_sale_code, p_created_by
    );
  end if;

  -- 6. Internal sale header + items
  insert into public.internal_sales (
    tenant_id, code, from_branch_id, to_branch_id,
    invoice_id, input_invoice_id, status,
    subtotal, tax_amount, total, note, created_by
  ) values (
    p_tenant_id, v_sale_code, p_from_branch_id, p_to_branch_id,
    v_invoice_id, v_input_inv_id, 'completed',
    v_subtotal, v_tax_total, v_total, p_note, p_created_by
  ) returning id into v_sale_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product_id := (v_item->>'productId')::uuid;
    v_product_name := coalesce(nullif(v_item->>'productName', ''), 'Sản phẩm');
    v_unit := coalesce(nullif(v_item->>'unit', ''), 'Cái');
    v_qty := coalesce((v_item->>'quantity')::numeric, 0);
    v_unit_price := coalesce((v_item->>'unitPrice')::numeric, 0);
    v_vat_rate := coalesce((v_item->>'vatRate')::numeric, 0);
    v_line_amount := round(v_qty * v_unit_price);

    insert into public.internal_sale_items (
      internal_sale_id, product_id, product_code, product_name, unit,
      quantity, unit_price, vat_rate, amount, note
    ) values (
      v_sale_id, v_product_id,
      coalesce(nullif(v_item->>'productCode', ''), ''),
      v_product_name, v_unit,
      v_qty, v_unit_price, v_vat_rate, v_line_amount,
      v_item->>'note'
    );
  end loop;

  return jsonb_build_object(
    'internal_sale_id', v_sale_id,
    'code', v_sale_code,
    'invoice_id', v_invoice_id,
    'invoice_code', v_invoice_code,
    'input_invoice_id', v_input_inv_id,
    'input_invoice_code', v_input_inv_code,
    'total', v_total
  );
end;
$$;

comment on function public.create_internal_sale_atomic is
  'Atomic internal sale (P0-10, CEO 13/06/2026): 10+ op trong 1 transaction. '
  'Trước đây client-side gọi rời rạc → ghost data nếu fail giữa chừng.';

grant execute on function public.create_internal_sale_atomic to authenticated;
