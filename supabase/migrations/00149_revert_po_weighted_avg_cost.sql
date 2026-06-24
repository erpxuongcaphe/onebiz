-- ============================================================
-- 00149 — Revert phiếu nhập: hoàn lại GIÁ VỐN bình quân (WAC), không chỉ số lượng
-- ============================================================
-- CEO 24/06/2026: hủy/mở-lại phiếu nhập phải trừ tồn theo CẢ số lượng LẪN
-- giá trị của phiếu. RPC cũ (00120) chỉ trừ products.stock (số lượng) nhưng
-- KHÔNG đụng cost_price — trong khi lúc nhập (00069) đã cập nhật cost_price
-- bình quân gia quyền (WAC). Hệ quả: sau revert, tồn còn lại vẫn mang giá vốn
-- đã trộn của phiếu bị hủy → giá trị tồn kho sai.
--
-- FIX: trong vòng lặp revert, ngoài trừ số lượng, tính lại giá vốn bằng cách
-- ĐẢO NGƯỢC WAC — bỏ đúng "giá trị phiếu" (qty × đơn giá nhập) khỏi tổng giá
-- trị tồn:
--   new_cost = (current_stock × current_cost − qty × unit_price)
--              ───────────────────────────────────────────────────
--              (current_stock − qty)
--   (khi current_stock − qty > 0; nếu hết tồn → giữ nguyên cost, lần nhập sau
--    tự reset theo quy tắc 00069 stock<=0 → dùng giá mới)
-- Chỉ đảo khi unit_price > 0 (đúng điều kiện lúc nhập mới apply WAC).
--
-- Trigger trg_product_cost_cascade (00069) sẽ tự recalc cached_cost của các BOM
-- dùng SP này làm nguyên liệu khi cost_price đổi → BOM cost cũng nhất quán.
--
-- Giữ NGUYÊN chữ ký (uuid, uuid) → client reopenPurchaseOrderForEdit + luồng
-- "Hủy phiếu đã nhận" không phải đổi. Set status='draft' như cũ (luồng Hủy tự
-- set 'cancelled' sau đó).
-- ============================================================

create or replace function public.revert_received_purchase_order_atomic(
  p_order_id uuid,
  p_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
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
  -- 00149: revert giá vốn bình quân theo giá trị phiếu
  v_current_cost numeric(15, 4);
  v_new_cost numeric(15, 4);
  v_new_stock numeric;
begin
  -- 1. Load + lock PO
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

  -- 2. Check input_invoice: nếu đã 'recorded' (đã ghi sổ kế toán) → chặn
  select id, code, status into v_input_invoice
  from public.input_invoices
  where purchase_order_id = p_order_id
  limit 1;

  if found and v_input_invoice.status = 'recorded' then
    raise exception
      'Phiếu % đã có hoá đơn đầu vào % đã ghi sổ — không revert được. Huỷ ghi sổ trước.',
      v_po.code, v_input_invoice.code;
  end if;

  -- 3. Loop items, revert tồn (số lượng) + giá vốn (giá trị) + lots
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

    -- 3a. Lock product, lấy tồn + giá vốn hiện tại
    select stock, cost_price into v_current_stock, v_current_cost
      from public.products
     where id = r.product_id
     for update;

    -- 3b. Check tồn không âm sau revert
    if v_current_stock - v_qty_to_revert < 0 then
      raise exception
        'Sản phẩm "%" (% trong kho) đã bán bớt — không thể trừ %. Vui lòng kiểm kho hoặc xử lý nhập âm trước.',
        r.product_name, v_current_stock, v_qty_to_revert;
    end if;

    -- 3c. Đảo ngược WAC: bỏ giá trị phiếu (qty × đơn giá nhập) khỏi tổng giá
    --     trị tồn → tính lại giá vốn bình quân. Chỉ khi đơn giá nhập > 0.
    v_new_stock := v_current_stock - v_qty_to_revert;
    v_new_cost := v_current_cost; -- mặc định giữ nguyên
    if coalesce(r.unit_price, 0) > 0 then
      if v_new_stock > 0 then
        v_new_cost := round(
          greatest(
            0,
            v_current_stock * coalesce(v_current_cost, 0)
              - v_qty_to_revert * r.unit_price
          ) / v_new_stock,
          4
        );
      end if;
      -- new_stock <= 0 → hết tồn, giữ nguyên cost (lần nhập sau tự reset theo 00069)
    end if;

    -- 3d. Insert stock_movements 'out' để audit revert
    insert into public.stock_movements (
      tenant_id, branch_id, product_id, type, quantity,
      reference_type, reference_id, note, created_by
    ) values (
      v_tenant_id, v_branch_id, r.product_id, 'out', v_qty_to_revert,
      'purchase_order_revert', p_order_id,
      v_po.code || ' - Revert nhập - ' || r.product_name
        || ' (giá vốn ' || coalesce(v_current_cost, 0)::text || ' → ' || v_new_cost::text || ')',
      p_user_id
    );

    -- 3e. Trừ products.stock + cập nhật lại cost_price (giá trị)
    update public.products
       set stock = stock - v_qty_to_revert,
           cost_price = v_new_cost,
           updated_at = now()
     where id = r.product_id;

    -- 3f. Audit log đổi giá vốn (đồng bộ với apply_weighted_avg_cost 00069)
    if v_new_cost is distinct from v_current_cost then
      insert into public.audit_log (
        tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
      ) values (
        v_tenant_id,
        coalesce(p_user_id, '00000000-0000-0000-0000-000000000000'::uuid),
        'cost_price_revert',
        'product',
        r.product_id,
        jsonb_build_object('cost_price', v_current_cost, 'stock', v_current_stock),
        jsonb_build_object(
          'cost_price', v_new_cost,
          'qty_reverted', v_qty_to_revert,
          'unit_price_in', r.unit_price,
          'reason', 'purchase_order_revert',
          'reference_type', 'purchase_order',
          'reference_id', p_order_id,
          'product_name', r.product_name
        )
      );
    end if;

    -- 3g. Trừ branch_stock (nếu có row)
    update public.branch_stock
       set quantity = quantity - v_qty_to_revert
     where tenant_id = v_tenant_id
       and branch_id = v_branch_id
       and product_id = r.product_id;

    -- 3h. Reset received_quantity về 0
    update public.purchase_order_items
       set received_quantity = 0
     where id = r.id;

    v_reverted_lines := v_reverted_lines + 1;
    v_reverted_qty_total := v_reverted_qty_total + v_qty_to_revert;
  end loop;

  -- 4. Lots — đếm lots consumed (cảnh báo) + xoá lots full
  select count(*) into v_consumed_lots
  from public.product_lots
  where purchase_order_id = p_order_id
    and current_qty < initial_qty
    and status = 'active';

  delete from public.product_lots
  where purchase_order_id = p_order_id
    and current_qty = initial_qty;

  update public.product_lots
     set status = 'cancelled',
         note = coalesce(note, '') || ' [Revert ' || to_char(now(), 'YYYY-MM-DD') || ': đã consume một phần]'
   where purchase_order_id = p_order_id
     and current_qty < initial_qty
     and status = 'active';

  -- 5. Xoá input_invoice (đã verify chưa recorded ở bước 2)
  if v_input_invoice.id is not null then
    delete from public.input_invoices
     where id = v_input_invoice.id;
  end if;

  -- 6. Set status='draft' để user sửa (luồng Hủy sẽ tự set 'cancelled' sau)
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
  'CEO 24/06/2026 (00149): Atomic revert receive — trừ tồn theo CẢ số lượng LẪN giá trị (đảo ngược giá vốn bình quân WAC). Trả về draft. Guards: chống tồn âm, chống xoá input_invoice đã ghi sổ.';

grant execute on function public.revert_received_purchase_order_atomic(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
