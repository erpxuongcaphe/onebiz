-- ============================================================
-- 00139: RPC complete_draft_atomic — gộp 5 op hoàn tất nháp vào 1 transaction
-- (CEO P0-7, 13/06/2026)
--
-- Vấn đề: completeDraftOrder() ở orders.ts chạy 5 op rời rạc client-side:
--   1. UPDATE invoice status='draft' → 'completed'
--   2. UPDATE debt sau khi biết total
--   3. SELECT invoice_items
--   4. applyStockDecrement (stock_movements + products.stock + branch_stock
--      + allocate_lots_fifo + BOM consume nếu has_bom)
--   5. createAutoCashReceipt (cash_transactions, hỗ trợ mixed)
--
-- Nếu bước 4 lỗi giữa chừng → invoice đã marked 'completed' nhưng tồn
-- chưa trừ → ghost invoice. Cashier không hủy được vì status=completed.
--
-- Migration này tạo RPC PG wrap 5 op vào 1 transaction → all-or-nothing.
-- Nếu bất kỳ step nào throw → ENTIRE transaction rollback → invoice
-- giữ nguyên 'draft' để cashier retry.
--
-- Idempotency: WHERE status='draft' trong UPDATE → 2 concurrent calls
-- chỉ 1 cái claim được, cái kia raise exception.
--
-- ============================================================

create or replace function public.complete_draft_atomic(
  p_invoice_id uuid,
  p_tenant_id uuid,
  p_branch_id uuid,
  p_created_by uuid,
  p_method text,
  p_paid numeric,
  p_payment_breakdown jsonb default null,
  p_shift_id uuid default null
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_invoice record;
  v_item record;
  v_total numeric;
  v_debt numeric;
  v_has_bom boolean;
  v_bom_result jsonb;
  v_bom_results jsonb := '[]'::jsonb;
  v_breakdown_item jsonb;
  v_method text;
  v_amount numeric;
  v_cash_code text;
  v_method_label text;
begin
  -- Bước 1+2: ATOMIC claim status='draft' → 'completed' với shift_id + payment_method.
  -- Nếu 2 concurrent calls → chỉ 1 cái match WHERE status='draft'.
  update public.invoices
  set
    status = 'completed',
    paid = coalesce(p_paid, 0),
    payment_method = p_method,
    shift_id = case when p_shift_id is not null then p_shift_id else shift_id end
  where id = p_invoice_id
    and tenant_id = p_tenant_id
    and status = 'draft'
  returning id, code, total, customer_name, branch_id
  into v_invoice;

  if not found then
    -- Kiểm tra status hiện tại để báo lỗi rõ ràng
    select status into v_method
    from public.invoices
    where id = p_invoice_id and tenant_id = p_tenant_id;
    if not found then
      raise exception 'Không tìm thấy đơn nháp (id=%)', p_invoice_id;
    else
      raise exception 'Đơn này đã được xử lý (trạng thái: %). Không thể hoàn tất lại.', v_method;
    end if;
  end if;

  v_total := coalesce(v_invoice.total, 0);
  v_debt := greatest(0, v_total - coalesce(p_paid, 0));

  -- Update debt sau khi biết real total
  update public.invoices
  set debt = v_debt
  where id = p_invoice_id and tenant_id = p_tenant_id;

  -- Bước 3+4: Loop invoice_items, trừ stock + BOM consume.
  -- Nếu bất kỳ step nào fail → exception → rollback toàn bộ.
  for v_item in
    select product_id, product_name, unit, quantity
    from public.invoice_items
    where invoice_id = p_invoice_id
  loop
    if v_item.product_id is null or v_item.quantity <= 0 then
      continue;
    end if;

    select coalesce(has_bom, false) into v_has_bom
    from public.products where id = v_item.product_id;

    if v_has_bom then
      -- SKU có BOM → chỉ trừ NVL theo công thức, KHÔNG trừ tồn SKU.
      v_bom_result := public.consume_bom_for_sale(
        p_tenant_id, p_branch_id, v_item.product_id, v_item.quantity,
        p_invoice_id, p_created_by, v_invoice.code
      );
      v_bom_results := v_bom_results || jsonb_build_object(
        'product_id', v_item.product_id,
        'product_name', v_item.product_name,
        'sale_qty', v_item.quantity,
        'result', v_bom_result
      );
    else
      -- SP thường → ghi stock_movement 'out' + trừ tồn chính nó.
      insert into public.stock_movements (
        tenant_id, branch_id, product_id, type, quantity,
        reference_type, reference_id, note, created_by
      ) values (
        p_tenant_id, p_branch_id, v_item.product_id, 'out', v_item.quantity,
        'invoice', p_invoice_id,
        'POS hoàn tất nháp - ' || v_invoice.code, p_created_by
      );

      perform public.increment_product_stock(v_item.product_id, -v_item.quantity);
      perform public.upsert_branch_stock(
        p_tenant_id, p_branch_id, v_item.product_id, -v_item.quantity
      );

      -- FIFO lot allocation — best-effort, không block nếu SP không có lot.
      begin
        perform public.allocate_lots_fifo(
          p_tenant_id, v_item.product_id, p_branch_id, v_item.quantity,
          'invoice', p_invoice_id
        );
      exception when others then null;
      end;
    end if;
  end loop;

  -- Bước 5: Cash transactions (chỉ khi paid > 0).
  -- Mixed có breakdown → tạo N phiếu thu riêng cho mỗi method.
  if coalesce(p_paid, 0) > 0 then
    if p_method = 'mixed' and p_payment_breakdown is not null
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
            coalesce(v_invoice.customer_name, 'Khách lẻ'), v_method,
            'invoice', p_invoice_id,
            'Thu tiền HĐ ' || v_invoice.code || ' (' || v_method_label || ')',
            p_created_by, p_shift_id
          );
        end if;
      end loop;
    else
      -- Single method (cash / transfer / card) hoặc mixed legacy fallback.
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
        coalesce(v_invoice.customer_name, 'Khách lẻ'),
        case when p_method = 'mixed' then 'cash' else p_method end,
        'invoice', p_invoice_id,
        'Thu tiền HĐ ' || v_invoice.code,
        p_created_by, p_shift_id
      );
    end if;
  end if;

  return jsonb_build_object(
    'invoice_id', p_invoice_id,
    'invoice_code', v_invoice.code,
    'total', v_total,
    'paid', p_paid,
    'debt', v_debt,
    'bom_consume_results', v_bom_results
  );
end;
$$;

comment on function public.complete_draft_atomic is
  'Atomic complete draft → invoice (P0-7, CEO 13/06/2026): 5 op trong 1 transaction. '
  'Trước đây client-side gọi rời rạc → ghost invoice nếu stock decrement lỗi giữa chừng.';

grant execute on function public.complete_draft_atomic to authenticated;
