-- ============================================================
-- 00102: Thêm "Ngày hết hạn sử dụng" + "Số lô" cho purchase_order_items
-- (CEO 18/05/2026)
--
-- YÊU CẦU: Khi nhập hàng từ NCC, kế toán nhập trực tiếp HSD của từng dòng
-- ngay tại phiếu nhập (thay vì phải vào tab "Lô sản xuất" sau đó).
--
-- Hiện trạng:
--   - `product_lots` table có expiry_date (00006_foundation.sql:268)
--   - Nhưng `purchase_order_items` KHÔNG có expiry_date → kế toán phải
--     nhập riêng ở 2 chỗ
--
-- Fix:
--   - Thêm 2 cột: `expiry_date date NULL` + `lot_number text NULL`
--   - Khi confirm phiếu nhập → service tự tạo `product_lots` với
--     expiry_date + lot_number từ PO item (nếu có)
--
-- Backward compat: NULL — phiếu nhập cũ không bị ảnh hưởng.
-- ============================================================

alter table public.purchase_order_items
  add column if not exists expiry_date date,
  add column if not exists lot_number text;

comment on column public.purchase_order_items.expiry_date is
  'Ngày hết hạn sử dụng (HSD) — kế toán nhập tại phiếu nhập. NULL = không track. CEO 18/05/2026.';

comment on column public.purchase_order_items.lot_number is
  'Số lô NCC ghi trên bao bì (vd "LOT-2026-04-15"). Hỗ trợ truy xuất nguồn gốc. CEO 18/05/2026.';

-- Index để filter NVL sắp hết hạn nhanh
create index if not exists idx_po_items_expiry
  on public.purchase_order_items(expiry_date)
  where expiry_date is not null;

-- ────────────────────────────────────────────────────────────────
-- Patch RPC receive_purchase_items_atomic: dùng expiry_date + lot_number
-- từ purchase_order_items khi tạo product_lots
-- ────────────────────────────────────────────────────────────────
-- Khi user nhập HSD ở phiếu nhập → confirm partial/full receive → server
-- tạo lot với expiry_date đó. Hỗ trợ truy xuất + cảnh báo sắp hết hạn.
--
-- Logic priority:
--   - Nếu po_item có lot_number → dùng làm tên lot (NCC ghi sẵn)
--   - Nếu không → auto-gen format <PO_CODE>-<DATE>-NN (như cũ)
--   - expiry_date copy từ po_item (NULL nếu không nhập)

-- DROP overload cũ trước khi CREATE để tránh "function name is not unique"
drop function if exists public.receive_purchase_items_atomic(uuid, jsonb, uuid);

-- Recreate với body GỐC từ 00069 (giữ WAC + input_invoice logic) +
-- THÊM copy expiry_date + lot_number từ po_items vào product_lots.
create or replace function public.receive_purchase_items_atomic(
  p_order_id uuid,
  p_lines jsonb,
  p_created_by uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_po record;
  v_tenant_id uuid;
  v_branch_id uuid;
  v_received_lines int := 0;
  v_received_qty_total numeric := 0;
  v_cost_updates int := 0;
  v_all_received boolean;
  v_new_status text;
  v_input_invoice_id uuid := null;
  v_input_invoice_code text := null;
  v_input_invoice_total numeric := 0;
  v_today date := current_date;
  v_lot_stamp text := to_char(now(), 'YYYYMMDD');
  v_lot_idx int := 0;
  v_lot_name text;
  v_has_full_receive boolean;
  r record;
  v_requested_qty numeric;
  v_actual_qty numeric;
  v_remaining numeric;
  v_new_received numeric;
  v_wac_result jsonb;
begin
  -- 1. Load PO + validate
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

  v_has_full_receive :=
    p_lines is null
    or jsonb_typeof(p_lines) <> 'array'
    or jsonb_array_length(p_lines) = 0;

  -- 3. Loop items — Day 18/05/2026: SELECT thêm expiry_date + lot_number
  for r in
    select id, product_id, product_name, quantity, received_quantity,
           unit_price, expiry_date, lot_number
    from public.purchase_order_items
    where purchase_order_id = p_order_id
    for update
  loop
    v_remaining := greatest(0, coalesce(r.quantity, 0) - coalesce(r.received_quantity, 0));
    if v_remaining <= 0 then continue; end if;

    if v_has_full_receive then
      v_requested_qty := v_remaining;
    else
      select coalesce((elem->>'receive_qty')::numeric, 0)
        into v_requested_qty
      from jsonb_array_elements(p_lines) elem
      where (elem->>'item_id')::uuid = r.id
      limit 1;
      if v_requested_qty is null then v_requested_qty := 0; end if;
    end if;

    v_actual_qty := least(greatest(v_requested_qty, 0), v_remaining);
    if v_actual_qty <= 0 then continue; end if;

    -- WAC update BEFORE increment_product_stock (giữ logic 00069)
    if r.unit_price is not null and r.unit_price > 0 then
      v_wac_result := public.apply_weighted_avg_cost(
        r.product_id, v_actual_qty, r.unit_price,
        'purchase_receive', 'purchase_order', p_order_id
      );
      if (v_wac_result->>'updated')::boolean is true then
        v_cost_updates := v_cost_updates + 1;
      end if;
    end if;

    -- 3a. Stock movement
    insert into public.stock_movements (
      tenant_id, branch_id, product_id, type, quantity,
      reference_type, reference_id, note, created_by
    ) values (
      v_tenant_id, v_branch_id, r.product_id, 'in', v_actual_qty,
      'purchase_order', p_order_id,
      v_po.code || ' - Nhập hàng NCC - ' || r.product_name,
      p_created_by
    );

    -- 3b. Stock updates
    perform public.increment_product_stock(r.product_id, v_actual_qty);
    perform public.upsert_branch_stock(
      v_tenant_id, v_branch_id, r.product_id, v_actual_qty
    );

    -- 3c. Create lot — Day 18/05/2026: HSD + lot_number từ po_item
    v_lot_idx := v_lot_idx + 1;
    v_lot_name := coalesce(
      nullif(r.lot_number, ''),
      v_po.code || '-' || v_lot_stamp || '-' || lpad(v_lot_idx::text, 2, '0')
    );

    insert into public.product_lots (
      tenant_id, product_id, variant_id, lot_number,
      source_type, purchase_order_id, supplier_id,
      received_date, expiry_date, initial_qty, current_qty,
      branch_id, status, note
    ) values (
      v_tenant_id, r.product_id, null,
      v_lot_name,
      'purchase', p_order_id, v_po.supplier_id,
      v_today, r.expiry_date, v_actual_qty, v_actual_qty,
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

  -- 4. Compute new status
  select bool_and(coalesce(received_quantity, 0) >= coalesce(quantity, 0))
    into v_all_received
  from public.purchase_order_items
  where purchase_order_id = p_order_id;

  v_new_status := case when v_all_received then 'completed' else 'partial' end;

  update public.purchase_orders
  set status = v_new_status, updated_at = now()
  where id = p_order_id and status in ('ordered', 'partial');

  if not found then
    raise exception
      'Purchase order % đã bị thay đổi trạng thái bởi request khác — vui lòng thử lại',
      p_order_id;
  end if;

  -- 5. Input invoice (giữ logic 00069)
  if v_new_status = 'completed' and v_input_invoice_total > 0 then
    if not exists (
      select 1 from public.input_invoices where purchase_order_id = p_order_id
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
      )
      select
        v_tenant_id, v_branch_id, v_input_invoice_code,
        v_po.supplier_id,
        (select name from public.suppliers where id = v_po.supplier_id),
        v_input_invoice_total, 0, 'unrecorded',
        p_order_id, 'Tự tạo từ PO ' || v_po.code, p_created_by;

      select id into v_input_invoice_id
      from public.input_invoices
      where code = v_input_invoice_code and tenant_id = v_tenant_id;
    end if;
  end if;

  return jsonb_build_object(
    'new_status', v_new_status,
    'received_lines', v_received_lines,
    'received_qty_total', v_received_qty_total,
    'cost_updates', v_cost_updates,
    'input_invoice_id', v_input_invoice_id,
    'input_invoice_code', v_input_invoice_code
  );
end;
$$;

grant execute on function public.receive_purchase_items_atomic(uuid, jsonb, uuid) to authenticated;

comment on function public.receive_purchase_items_atomic is
  'Atomic purchase receive v3 (WAC + HSD + lot từ po_items). CEO 18/05/2026.';

notify pgrst, 'reload schema';
