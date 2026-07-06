-- ============================================================
-- 00161 — Vá bất đối xứng forward↔reversal khi HỦY hóa đơn đã hoàn thành
-- ============================================================
-- CEO 06/07/2026 (audit đối kháng): void_completed_invoice_atomic (00117, viết
-- 29/05) đảo kho theo giả định CŨ "NVL BOM chỉ đụng branch_stock, KHÔNG đụng
-- products.stock". Giả định này ĐÚNG lúc 29/05 — NHƯNG migration 00135 (10/06)
-- đã đổi forward path (consume_bom_for_sale) để trừ CẢ products.stock LẪN
-- branch_stock cho reference_type='bom_consume' VÀ 'modifier_topping'. Hàm hủy
-- KHÔNG được cập nhật theo → sinh 2 lỗi mỗi lần hủy HĐ đã hoàn thành có BOM:
--   (1) bom_consume: forward trừ 2 sổ, reversal chỉ hoàn branch_stock →
--       products.stock kẹt THẤP hơn Σbranch_stock = DRIFT âm thầm (đã thấy ở 3
--       HĐ hủy HD001209/HD001284/HD001253; migration 00160 vừa heal một lần,
--       nhưng lần hủy tiếp theo tái sinh y hệt vì HÀM chưa sửa).
--   (2) modifier_topping: WHERE của vòng hoàn kho BỎ SÓT hẳn 'modifier_topping'
--       → hủy HĐ có topping thì NVL topping KHÔNG được hoàn (mất luôn cả 2 sổ).
--
-- FIX: reversal đối xứng ĐÚNG với forward hiện tại (00147/00148):
--   - Thêm 'modifier_topping' vào danh sách reference_type hoàn kho.
--   - Với MỌI loại (invoice / bom_consume / modifier_topping): hoàn CẢ
--     products.stock (increment_product_stock) LẪN branch_stock (upsert_branch_stock).
-- Chỉ đổi PHẦN 2 (hoàn kho). Lô/tiền/điểm/status giữ NGUYÊN như 00117.
--
-- LƯU Ý cạnh (hiếm): HĐ tạo TRƯỚC 00135 (10/06) có bom_consume chỉ trừ 1 sổ; nếu
-- hủy bằng hàm mới sẽ hoàn hơi dư products.stock cho các HĐ cũ đó. Rủi ro nhỏ
-- (ít ai hủy HĐ >1 tháng tuổi) + reconcile định kỳ bắt được; đổi lại mọi HĐ từ
-- 10/06 về sau (đại đa số) hủy ĐÚNG. Chấp nhận đánh đổi này.
-- ============================================================

create or replace function public.void_completed_invoice_atomic(
  p_tenant_id uuid,
  p_invoice_id uuid,
  p_actor uuid,
  p_reason text default null,
  p_shift_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_inv record;
  r record;
  v_cash_code text;
  v_loyalty_net integer := 0;
  v_loyalty_balance integer;
  v_reversed_stock int := 0;
  v_reversed_cash numeric := 0;
  v_restored_lots int := 0;
begin
  -- ─── 0. Cross-tenant guard ───
  if p_tenant_id is null or p_tenant_id <> public.get_user_tenant_id() then
    raise exception 'VOID: tenant mismatch';
  end if;

  -- ─── 1. Load + lock invoice; guard status (idempotency) ───
  select * into v_inv
  from public.invoices
  where id = p_invoice_id and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'VOID: không tìm thấy hóa đơn trong tenant này';
  end if;
  if v_inv.status = 'cancelled' then
    raise exception 'VOID: hóa đơn % đã được hủy trước đó', v_inv.code;
  end if;
  if v_inv.status <> 'completed' then
    raise exception 'VOID: chỉ hoàn tác hóa đơn đã hoàn thành (hiện tại: %)', v_inv.status;
  end if;

  -- ─── 2. Hoàn kho theo stock_movements gốc — 00161: ĐỐI XỨNG với forward ───
  -- Forward (00147/00148) trừ CẢ products.stock LẪN branch_stock cho cả 3 loại
  -- (invoice / bom_consume / modifier_topping) → reversal hoàn CẢ 2 sổ cho cả 3.
  for r in
    select id, branch_id, product_id, quantity, reference_type
    from public.stock_movements
    where tenant_id = p_tenant_id
      and reference_id = p_invoice_id
      and type = 'out'
      and reference_type in ('invoice', 'bom_consume', 'modifier_topping')
  loop
    insert into public.stock_movements (
      tenant_id, branch_id, product_id, type, quantity,
      reference_type, reference_id, note, created_by
    ) values (
      p_tenant_id, r.branch_id, r.product_id, 'in', r.quantity,
      'invoice_void', p_invoice_id,
      'Hoàn kho hủy HĐ ' || v_inv.code, p_actor
    );

    -- 00161: hoàn CẢ HAI sổ cho MỌI loại (trước đây products.stock chỉ hoàn khi
    -- reference_type='invoice' — sai vì forward đã trừ products.stock cho NVL từ 00135).
    perform public.increment_product_stock(r.product_id, r.quantity);
    perform public.upsert_branch_stock(p_tenant_id, r.branch_id, r.product_id, r.quantity);
    v_reversed_stock := v_reversed_stock + 1;
  end loop;

  -- ─── 3. Hồi lô FIFO đã xuất cho HĐ ───
  for r in
    select id, lot_id, quantity
    from public.lot_allocations
    where tenant_id = p_tenant_id
      and source_type = 'invoice'
      and source_id = p_invoice_id
      and quantity > 0
  loop
    update public.product_lots
    set current_qty = current_qty + r.quantity,
        status = case when status = 'consumed' then 'active' else status end,
        updated_at = now()
    where id = r.lot_id;

    insert into public.lot_allocations (
      tenant_id, lot_id, source_type, source_id, quantity, allocated_by
    ) values (
      p_tenant_id, r.lot_id, 'invoice', p_invoice_id, -r.quantity, p_actor
    );
    v_restored_lots := v_restored_lots + 1;
  end loop;

  -- ─── 4. Hoàn tiền: ghi cash 'payment' bù cho từng receipt của HĐ ───
  for r in
    select branch_id, amount, payment_method, counterparty
    from public.cash_transactions
    where tenant_id = p_tenant_id
      and reference_id = p_invoice_id
      and reference_type = 'invoice'
      and type = 'receipt'
  loop
    v_cash_code := public.next_code(p_tenant_id, 'cash_payment');
    if v_cash_code is null or v_cash_code = '' then
      v_cash_code := 'PC' || extract(epoch from now())::bigint::text;
    end if;
    insert into public.cash_transactions (
      tenant_id, branch_id, code, type, category, amount,
      counterparty, payment_method, reference_type, reference_id,
      note, created_by, shift_id
    ) values (
      p_tenant_id, r.branch_id, v_cash_code, 'payment', 'Hoàn tiền hủy đơn', r.amount,
      r.counterparty,
      case when r.payment_method in ('cash','transfer','card') then r.payment_method else 'cash' end,
      'invoice_void', p_invoice_id,
      'Hoàn tiền hủy HĐ ' || v_inv.code, p_actor, p_shift_id
    );
    v_reversed_cash := v_reversed_cash + r.amount;
  end loop;

  -- ─── 5. Đảo điểm loyalty của HĐ (best-effort) ───
  begin
    if v_inv.customer_id is not null then
      select coalesce(sum(points), 0) into v_loyalty_net
      from public.loyalty_transactions
      where tenant_id = p_tenant_id
        and reference_type = 'invoice'
        and reference_id = p_invoice_id;

      if v_loyalty_net <> 0 then
        update public.customers
        set loyalty_points = greatest(0, loyalty_points - v_loyalty_net)
        where id = v_inv.customer_id and tenant_id = p_tenant_id
        returning loyalty_points into v_loyalty_balance;

        insert into public.loyalty_transactions (
          tenant_id, customer_id, type, points, balance_after,
          reference_type, reference_id, note, created_by
        ) values (
          p_tenant_id, v_inv.customer_id, 'adjust', -v_loyalty_net,
          coalesce(v_loyalty_balance, 0),
          'invoice_void', p_invoice_id,
          'Hoàn điểm do hủy HĐ ' || v_inv.code, p_actor
        );
      end if;
    end if;
  exception when others then
    null;
  end;

  -- ─── 6. Flip invoice → cancelled, zero debt, đóng dấu audit ───
  update public.invoices
  set status = 'cancelled',
      debt = 0,
      cancelled_at = now(),
      cancelled_by = p_actor,
      cancel_reason = nullif(p_reason, ''),
      updated_at = now()
  where id = p_invoice_id;

  return jsonb_build_object(
    'invoice_id', p_invoice_id,
    'invoice_code', v_inv.code,
    'reversed_stock_movements', v_reversed_stock,
    'restored_lots', v_restored_lots,
    'reversed_cash', v_reversed_cash,
    'loyalty_net_reversed', v_loyalty_net
  );
end;
$$;

grant execute on function public.void_completed_invoice_atomic(uuid, uuid, uuid, text, uuid) to authenticated;

comment on function public.void_completed_invoice_atomic is
  'Hủy + hoàn tác hóa đơn completed. 00161: reversal hoàn CẢ products.stock + branch_stock cho invoice/bom_consume/modifier_topping (đối xứng forward 00135+), thêm modifier_topping. Atomic, idempotent, giữ audit.';

notify pgrst, 'reload schema';
