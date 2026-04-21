-- ============================================================
-- 00028 — Atomic Receive Purchase Items RPC
-- ============================================================
-- Sprint Go-Live Hardening — K2.
--
-- Vấn đề:
--   `receivePurchaseOrder` + `receivePurchaseOrderPartial` hiện chạy 6-8
--   round-trip (status flip → read items → N× stock_movements →
--   N× increment_stock → N× upsert_branch_stock → insert lots → update
--   received_quantity per line → input_invoice). Nếu mạng rớt giữa chừng
--   → kho đã cộng nhưng received_quantity chưa update → lần sau nhập
--   lại sẽ cộng thêm lần nữa (double stock-in). Hoặc input_invoice
--   không được tạo → sổ sách không khớp.
--
-- Giải pháp: bọc tất cả trong 1 Postgres transaction qua RPC. Postgres
-- tự rollback nếu bất kỳ bước nào fail → zero orphan state.
--
-- Signature:
--   p_lines = jsonb array of {item_id, receive_qty}
--             hoặc NULL / [] → "nhận toàn bộ remaining của tất cả line"
--
-- Returns:
--   {
--     new_status: 'partial' | 'completed',
--     received_lines: int,
--     received_qty_total: numeric,
--     input_invoice_id: uuid | null,
--     input_invoice_code: text | null
--   }
-- ============================================================

create or replace function public.receive_purchase_items_atomic(
  p_order_id uuid,
  p_lines jsonb,
  p_created_by uuid
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_po record;
  v_tenant_id uuid;
  v_branch_id uuid;
  v_received_lines int := 0;
  v_received_qty_total numeric := 0;
  v_all_received boolean;
  v_new_status text;
  v_input_invoice_id uuid := null;
  v_input_invoice_code text := null;
  v_input_invoice_total numeric := 0;
  v_today date := current_date;
  v_lot_stamp text := to_char(now(), 'YYYYMMDD');
  v_lot_idx int := 0;
  v_has_full_receive boolean;
  r record;
  v_requested_qty numeric;
  v_actual_qty numeric;
  v_remaining numeric;
  v_new_received numeric;
  v_map_item_id uuid;
  v_line_total numeric;
begin
  -- ────────────────────────────────────────────────
  -- 1. Load PO + validate
  -- ────────────────────────────────────────────────
  select id, code, status, branch_id, tenant_id, supplier_id
    into v_po
  from public.purchase_orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Purchase order % not found', p_order_id;
  end if;

  if v_po.status not in ('ordered', 'partial') then
    raise exception
      'Không thể nhập hàng ở trạng thái "%" (chỉ cho phép ordered/partial)',
      v_po.status;
  end if;

  v_tenant_id := v_po.tenant_id;
  v_branch_id := v_po.branch_id;

  -- ────────────────────────────────────────────────
  -- 2. Detect "full receive all" mode (lines null/empty → receive all remaining)
  -- ────────────────────────────────────────────────
  v_has_full_receive :=
    p_lines is null
    or jsonb_typeof(p_lines) <> 'array'
    or jsonb_array_length(p_lines) = 0;

  -- ────────────────────────────────────────────────
  -- 3. Loop items, apply stock + update received_quantity
  --    (Postgres transaction ensures all-or-nothing)
  -- ────────────────────────────────────────────────
  for r in
    select id, product_id, product_name, quantity, received_quantity, unit_price
    from public.purchase_order_items
    where purchase_order_id = p_order_id
    for update
  loop
    v_remaining := greatest(0, coalesce(r.quantity, 0) - coalesce(r.received_quantity, 0));
    if v_remaining <= 0 then
      continue;
    end if;

    if v_has_full_receive then
      v_requested_qty := v_remaining;
    else
      -- Look up requested qty from p_lines; default 0 if not present
      select coalesce((elem->>'receive_qty')::numeric, 0)
        into v_requested_qty
      from jsonb_array_elements(p_lines) elem
      where (elem->>'item_id')::uuid = r.id
      limit 1;

      if v_requested_qty is null then
        v_requested_qty := 0;
      end if;
    end if;

    v_actual_qty := least(greatest(v_requested_qty, 0), v_remaining);
    if v_actual_qty <= 0 then
      continue;
    end if;

    -- 3a. Stock movement ledger
    insert into public.stock_movements (
      tenant_id, branch_id, product_id, type, quantity,
      reference_type, reference_id, note, created_by
    ) values (
      v_tenant_id, v_branch_id, r.product_id, 'in', v_actual_qty,
      'purchase_order', p_order_id,
      v_po.code || ' - Nhập hàng NCC - ' || r.product_name,
      p_created_by
    );

    -- 3b. Atomic stock updates (products.stock + branch_stock)
    perform public.increment_product_stock(r.product_id, v_actual_qty);
    perform public.upsert_branch_stock(
      v_tenant_id, v_branch_id, r.product_id, v_actual_qty
    );

    -- 3c. Create product lot (FIFO)
    v_lot_idx := v_lot_idx + 1;
    insert into public.product_lots (
      tenant_id, product_id, variant_id, lot_number,
      source_type, purchase_order_id, supplier_id,
      received_date, initial_qty, current_qty,
      branch_id, status, note
    ) values (
      v_tenant_id, r.product_id, null,
      v_po.code || '-' || v_lot_stamp || '-' || lpad(v_lot_idx::text, 2, '0'),
      'purchase', p_order_id, v_po.supplier_id,
      v_today, v_actual_qty, v_actual_qty,
      v_branch_id, 'active', 'Nhập từ ' || v_po.code
    );

    -- 3d. Update received_quantity
    v_new_received := coalesce(r.received_quantity, 0) + v_actual_qty;
    update public.purchase_order_items
    set received_quantity = v_new_received
    where id = r.id;

    v_received_lines := v_received_lines + 1;
    v_received_qty_total := v_received_qty_total + v_actual_qty;
    v_input_invoice_total := v_input_invoice_total +
      (v_actual_qty * coalesce(r.unit_price, 0));
  end loop;

  if v_received_lines = 0 then
    raise exception 'Không có dòng hợp lệ nào để nhập — kiểm tra lại số lượng';
  end if;

  -- ────────────────────────────────────────────────
  -- 4. Compute new status (all lines fully received → completed)
  -- ────────────────────────────────────────────────
  select
    bool_and(coalesce(received_quantity, 0) >= coalesce(quantity, 0))
    into v_all_received
  from public.purchase_order_items
  where purchase_order_id = p_order_id;

  v_new_status := case when v_all_received then 'completed' else 'partial' end;

  -- Atomic status update with guard (still in ordered/partial)
  update public.purchase_orders
  set status = v_new_status,
      updated_at = now()
  where id = p_order_id
    and status in ('ordered', 'partial');

  if not found then
    raise exception
      'Purchase order % đã bị thay đổi trạng thái bởi request khác — vui lòng thử lại',
      p_order_id;
  end if;

  -- ────────────────────────────────────────────────
  -- 5. Input invoice — tạo khi đơn vừa hoàn thành
  --    (chỉ 1 input_invoice/PO — theo logic legacy receivePurchaseOrder)
  -- ────────────────────────────────────────────────
  if v_new_status = 'completed' and v_input_invoice_total > 0 then
    -- Kiểm tra đã có input_invoice cho PO này chưa
    if not exists (
      select 1 from public.input_invoices
      where purchase_order_id = p_order_id
    ) then
      v_input_invoice_code := public.next_code(v_tenant_id, 'input_invoice');
      if v_input_invoice_code is null or v_input_invoice_code = '' then
        v_input_invoice_code := 'HDV' || extract(epoch from now())::bigint::text;
      end if;

      insert into public.input_invoices (
        tenant_id, branch_id, code,
        supplier_id, supplier_name,
        total_amount, tax_amount, status,
        purchase_order_id, note, created_by
      ) values (
        v_tenant_id, v_branch_id, v_input_invoice_code,
        v_po.supplier_id, '',
        v_input_invoice_total, 0, 'unrecorded',
        p_order_id,
        'Tạo tự động khi nhập hàng ' || v_po.code,
        p_created_by
      )
      returning id into v_input_invoice_id;
    end if;
  end if;

  return jsonb_build_object(
    'new_status', v_new_status,
    'received_lines', v_received_lines,
    'received_qty_total', v_received_qty_total,
    'input_invoice_id', v_input_invoice_id,
    'input_invoice_code', v_input_invoice_code
  );
end;
$$;

comment on function public.receive_purchase_items_atomic is
  'Atomic partial/full purchase order receive: stock_movements + product stock + branch_stock + product_lots + received_quantity + status + input_invoice. All-or-nothing transaction — replaces multi-step JS loop that had double-stock-in risk on network failure.';
