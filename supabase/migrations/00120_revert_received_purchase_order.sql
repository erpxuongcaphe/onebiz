-- ============================================================
-- 00120 — Atomic revert receive cho phiếu nhập (để mở lại sửa)
-- ============================================================
-- CEO 01/06/2026: anh cần sửa được phiếu nhập ĐÃ nhập kho. Cách clean
-- nhất: revert receive (trả về draft) → user sửa items/qty/giá → bấm
-- "Nhập kho ngay" lại = receive mới. Tránh 1 RPC khổng lồ làm cả 3 việc
-- (revert + replace + re-receive).
--
-- RPC này INVERSE của receive_purchase_items_atomic (migration 00028):
--   1. Trừ tồn theo từng item (product.stock - received_quantity).
--   2. Trừ branch_stock tương ứng.
--   3. Cancel/delete product_lots tạo bởi PO này (lots còn nguyên qty).
--   4. Insert stock_movements 'out' để audit revert.
--   5. Reset received_quantity về 0.
--   6. Delete input_invoice nếu có (chưa ghi sổ — status='unrecorded').
--   7. Set status='draft' (sẵn sàng cho user sửa).
--
-- Guards:
--   - Status phải là 'ordered' / 'partial' / 'completed'.
--   - Mỗi product phải còn đủ tồn để trừ. Nếu đã bán bớt → tồn âm → RAISE
--     để user xử lý (vd "Sữa đặc đã bán 80 ly, chỉ revert được 20").
--   - Input_invoice nếu đã ghi sổ ('recorded') → KHÔNG xoá, raise lỗi.
--   - Lot nào đã consume (current_qty < initial_qty) → cảnh báo, không xoá.
-- ============================================================

create or replace function public.revert_received_purchase_order_atomic(
  p_order_id uuid,
  p_user_id uuid
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_po record;
  v_tenant_id uuid;
  v_branch_id uuid;
  v_reverted_lines int := 0;
  v_reverted_qty_total numeric := 0;
  v_input_invoice record;
  v_consumed_lots int := 0;
  r record;
  v_qty_to_revert numeric;
  v_current_stock numeric;
begin
  -- ────────────────────────────────────────────────
  -- 1. Load + lock PO
  -- ────────────────────────────────────────────────
  select id, code, status, branch_id, tenant_id, supplier_id
    into v_po
  from public.purchase_orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Phiếu nhập % không tồn tại', p_order_id;
  end if;

  if v_po.status not in ('ordered', 'partial', 'completed') then
    raise exception
      'Không revert được phiếu ở trạng thái "%": chỉ revert ordered/partial/completed',
      v_po.status;
  end if;

  v_tenant_id := v_po.tenant_id;
  v_branch_id := v_po.branch_id;

  -- ────────────────────────────────────────────────
  -- 2. Check input_invoice: nếu đã 'recorded' (đã ghi sổ kế toán) → chặn
  -- ────────────────────────────────────────────────
  select id, code, status into v_input_invoice
  from public.input_invoices
  where purchase_order_id = p_order_id
  limit 1;

  if found and v_input_invoice.status = 'recorded' then
    raise exception
      'Phiếu % đã có hoá đơn đầu vào %s đã ghi sổ — không revert được. Huỷ ghi sổ trước.',
      v_po.code, v_input_invoice.code;
  end if;

  -- ────────────────────────────────────────────────
  -- 3. Loop items, revert tồn + lots
  -- ────────────────────────────────────────────────
  for r in
    select id, product_id, product_name, quantity, received_quantity, unit_price
    from public.purchase_order_items
    where purchase_order_id = p_order_id
    for update
  loop
    v_qty_to_revert := coalesce(r.received_quantity, 0);
    if v_qty_to_revert <= 0 then
      continue;
    end if;

    -- 3a. Check tồn không âm sau revert
    select stock into v_current_stock
      from public.products
     where id = r.product_id
     for update;

    if v_current_stock - v_qty_to_revert < 0 then
      raise exception
        'Sản phẩm "%" (% trong kho) đã bán bớt — không thể trừ %. Vui lòng kiểm kho hoặc xử lý nhập âm trước.',
        r.product_name, v_current_stock, v_qty_to_revert;
    end if;

    -- 3b. Insert stock_movements 'out' để audit revert
    insert into public.stock_movements (
      tenant_id, branch_id, product_id, type, quantity,
      reference_type, reference_id, note, created_by
    ) values (
      v_tenant_id, v_branch_id, r.product_id, 'out', v_qty_to_revert,
      'purchase_order_revert', p_order_id,
      v_po.code || ' - Revert nhập (mở lại để sửa) - ' || r.product_name,
      p_user_id
    );

    -- 3c. Trừ products.stock
    update public.products
       set stock = stock - v_qty_to_revert
     where id = r.product_id;

    -- 3d. Trừ branch_stock (nếu có row)
    update public.branch_stock
       set quantity = quantity - v_qty_to_revert
     where tenant_id = v_tenant_id
       and branch_id = v_branch_id
       and product_id = r.product_id;

    -- 3e. Reset received_quantity về 0
    update public.purchase_order_items
       set received_quantity = 0
     where id = r.id;

    v_reverted_lines := v_reverted_lines + 1;
    v_reverted_qty_total := v_reverted_qty_total + v_qty_to_revert;
  end loop;

  -- ────────────────────────────────────────────────
  -- 4. Lots — đếm lots consumed (cảnh báo) + xoá lots full
  -- ────────────────────────────────────────────────
  select count(*) into v_consumed_lots
  from public.product_lots
  where purchase_order_id = p_order_id
    and current_qty < initial_qty
    and status = 'active';

  -- Xoá lots còn full (chưa bị consume) — đây là phần stock revert
  delete from public.product_lots
  where purchase_order_id = p_order_id
    and current_qty = initial_qty;

  -- Lots đã bị consume một phần → đánh dấu 'cancelled' (không revert vì
  -- không biết phân bổ đúng — tồn âm đã được check ở bước 3a).
  update public.product_lots
     set status = 'cancelled',
         note = coalesce(note, '') || ' [Revert ' || to_char(now(), 'YYYY-MM-DD') || ': đã consume một phần]'
   where purchase_order_id = p_order_id
     and current_qty < initial_qty
     and status = 'active';

  -- ────────────────────────────────────────────────
  -- 5. Xoá input_invoice (đã verify chưa recorded ở bước 2)
  -- ────────────────────────────────────────────────
  if v_input_invoice.id is not null then
    delete from public.input_invoices
     where id = v_input_invoice.id;
  end if;

  -- ────────────────────────────────────────────────
  -- 6. Set status='draft' để user sửa
  -- ────────────────────────────────────────────────
  update public.purchase_orders
     set status = 'draft',
         updated_at = now()
   where id = p_order_id;

  return jsonb_build_object(
    'success', true,
    'reverted_lines', v_reverted_lines,
    'reverted_qty_total', v_reverted_qty_total,
    'consumed_lots_cancelled', v_consumed_lots,
    'input_invoice_deleted', v_input_invoice.id is not null,
    'new_status', 'draft'
  );
end;
$$;

comment on function public.revert_received_purchase_order_atomic is
  'CEO 01/06/2026: Atomic revert receive cho phiếu nhập đã ordered/partial/completed. Trả về draft để user sửa items rồi nhập kho lại. Guards: chống tồn âm, chống xoá input_invoice đã ghi sổ.';

grant execute on function public.revert_received_purchase_order_atomic(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
