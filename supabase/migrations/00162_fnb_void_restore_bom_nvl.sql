-- ============================================================
-- 00162 — Hủy bill F&B đã thanh toán: HOÀN nguyên liệu BOM về kho
-- ============================================================
-- CEO 06/07/2026 (chốt sau audit): fnb_void_invoice_atomic (00086) khi hủy bill
-- F&B đã thanh toán chỉ hoàn tồn cho SKU trong invoice_items — KHÔNG hoàn NVL đã
-- tiêu hao theo BOM (consume_bom_for_sale trừ sữa/cà phê/syrup/topping ở lúc bán,
-- CẢ products.stock LẪN branch_stock từ 00135). Với F&B, món bán là SKU pha chế
-- (BOM-only), tác động tồn thật nằm ở NVL → không hoàn = NVL trừ khống vĩnh viễn.
--
-- CEO chọn: HỦY BILL = HOÀN NGUYÊN LIỆU (giống luồng trả hàng restore_bom_for_return).
--
-- FIX: thêm khối 3b hoàn NVL — lặp stock_movements gốc của HĐ
-- (reference_type in ('bom_consume','modifier_topping'), type='out'), cộng lại
-- CẢ products.stock (increment_product_stock) LẪN branch_stock (upsert_branch_stock)
-- theo ĐÚNG branch_id đã tiêu hao, ghi movement 'invoice_void' đảo (giữ audit).
-- Giữ NGUYÊN mọi phần khác của 00086 (OTP/quyền, hoàn SKU, lô, tiền, kitchen, audit).
--
-- Idempotent: hàm chặn status='cancelled' (không hủy 2 lần) nên không hoàn kép.
-- Chưa kích hoạt trên data hiện tại (0 HĐ F&B) — vá trước khi quán F&B go-live.
-- ============================================================

create or replace function public.fnb_void_invoice_atomic(
  p_invoice_id uuid,
  p_kitchen_order_id uuid,
  p_void_reason text,
  p_voided_by uuid,
  p_tenant_id uuid,
  p_branch_id uuid,
  p_shift_id uuid default null,
  p_otp_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_invoice record;
  v_item record;
  v_alloc record;
  v_bom record;                 -- 00162
  v_cash_code text;
  v_lots_reverted int := 0;
  v_nvl_reverted int := 0;      -- 00162
  v_caller_tenant uuid := public._current_caller_tenant();
  v_approver uuid;
begin
  -- 0. Guard tenant
  if v_caller_tenant is null then
    raise exception 'UNAUTHORIZED: không xác định được tenant của người gọi.';
  end if;
  if p_tenant_id <> v_caller_tenant then
    raise exception 'TENANT_MISMATCH: bạn không thuộc tenant của hoá đơn này.';
  end if;

  -- 1. Verify OTP (nếu cashier không có quyền tự void)
  if p_otp_id is not null then
    v_approver := public.verify_otp_authorization(
      p_otp_id, 'fnb.void_paid_bill', auth.uid(), p_invoice_id
    );
    if not public.user_has_permission(v_approver, 'pos_fnb.void_paid_bill') then
      raise exception 'PERMISSION_DENIED: người duyệt OTP không có quyền void_paid_bill';
    end if;
  else
    if not (
      public.user_has_permission(auth.uid(), 'pos_fnb.void_paid_bill')
      or public.user_has_permission(auth.uid(), 'pos_fnb.void')
    ) then
      raise exception 'PERMISSION_DENIED: cần OTP duyệt hoặc quyền pos_fnb.void_paid_bill';
    end if;
    v_approver := auth.uid();
  end if;

  -- 2. Lock invoice
  select id, code, status, paid, shift_id into v_invoice
  from public.invoices
  where tenant_id = p_tenant_id and id = p_invoice_id
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
  where tenant_id = p_tenant_id and id = p_invoice_id;

  -- 3. Loop items: revert stock + lot (SKU thành phẩm)
  for v_item in
    select product_id, product_name, quantity
    from public.invoice_items
    where invoice_id = p_invoice_id and product_id is not null
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

    for v_alloc in
      select la.id, la.lot_id, la.quantity
      from public.lot_allocations la
      join public.product_lots pl on pl.id = la.lot_id
      where la.source_type = 'invoice'
        and la.source_id = p_invoice_id
        and la.reverted_at is null
        and pl.product_id = v_item.product_id
        and pl.tenant_id = p_tenant_id
      for update of la, pl
    loop
      update public.product_lots
      set current_qty = current_qty + v_alloc.quantity,
          status = case when status = 'consumed' and current_qty + v_alloc.quantity > 0
            then 'active' else status end,
          updated_at = now()
      where id = v_alloc.lot_id;

      update public.lot_allocations
      set reverted_at = now(),
          reverted_reason = 'void_invoice:' || v_invoice.code
      where id = v_alloc.id;

      v_lots_reverted := v_lots_reverted + 1;
    end loop;
  end loop;

  -- 3b. 00162: HOÀN NVL tiêu hao theo BOM + topping (CEO chọn: hủy = hoàn NVL).
  -- Forward (00135+) trừ CẢ 2 sổ cho bom_consume/modifier_topping → hoàn cả 2 sổ,
  -- theo đúng branch_id đã tiêu hao, ghi movement đảo giữ audit.
  for v_bom in
    select branch_id, product_id, sum(quantity) as qty
    from public.stock_movements
    where tenant_id = p_tenant_id
      and reference_id = p_invoice_id
      and type = 'out'
      and reference_type in ('bom_consume', 'modifier_topping')
    group by branch_id, product_id
  loop
    insert into public.stock_movements (
      tenant_id, branch_id, product_id, type, quantity,
      reference_type, reference_id, note, created_by
    ) values (
      p_tenant_id, v_bom.branch_id, v_bom.product_id, 'in', v_bom.qty,
      'invoice_void', p_invoice_id,
      'Hoàn NVL - hủy bill F&B ' || v_invoice.code, p_voided_by
    );

    perform public.increment_product_stock(v_bom.product_id, v_bom.qty);
    perform public.upsert_branch_stock(p_tenant_id, v_bom.branch_id, v_bom.product_id, v_bom.qty);
    v_nvl_reverted := v_nvl_reverted + 1;
  end loop;

  -- 4. Refund cash transaction
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

  -- 5. Cancel kitchen order
  update public.kitchen_orders
  set status = 'cancelled', updated_at = now()
  where tenant_id = p_tenant_id and id = p_kitchen_order_id;

  -- 6. Audit log với approver + otp_id
  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    p_tenant_id, auth.uid(), 'void_paid_invoice', 'invoice', p_invoice_id,
    jsonb_build_object(
      'invoice_code', v_invoice.code,
      'amount_refunded', v_invoice.paid,
      'reason', p_void_reason,
      'approved_by', v_approver,
      'otp_id', p_otp_id,
      'delegated', (p_otp_id is not null),
      'lots_reverted', v_lots_reverted,
      'nvl_reverted', v_nvl_reverted
    )
  );

  return jsonb_build_object(
    'success', true,
    'lots_reverted', v_lots_reverted,
    'nvl_reverted', v_nvl_reverted,
    'approved_by', v_approver,
    'delegated', (p_otp_id is not null)
  );
end;
$$;

grant execute on function public.fnb_void_invoice_atomic(uuid, uuid, text, uuid, uuid, uuid, uuid, uuid) to authenticated;

comment on function public.fnb_void_invoice_atomic is
  'Hủy bill F&B đã thanh toán. 00162: hoàn CẢ SKU (invoice_items) LẪN NVL BOM/topping (stock_movements bom_consume/modifier_topping) — cả products.stock + branch_stock, giữ audit. OTP/quyền/lô/tiền/kitchen giữ nguyên 00086.';

notify pgrst, 'reload schema';
