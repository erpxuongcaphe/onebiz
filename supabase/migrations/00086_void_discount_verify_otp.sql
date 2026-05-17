-- ============================================================
-- 00086: fnb_void_invoice_atomic + record_discount_audit verify OTP server-side (CEO 17/05/2026)
--
-- VẤN ĐỀ:
--   - fnb_void_invoice_atomic (00073) KHÔNG nhận p_otp_id. UI có OTP dialog
--     nhưng client tự verify rồi gọi RPC → attacker bypass UI có thể skip.
--   - record_discount_audit (00076/00084) chỉ lưu p_otp_id vào audit_log,
--     KHÔNG verify OTP còn hợp lệ + đúng target.
--
-- FIX:
--   - fnb_void_invoice_atomic + p_otp_id: nếu non-null → gọi verify_otp_authorization
--     với action 'fnb.void_paid_bill' + target = p_invoice_id
--   - record_discount_audit + verify p_otp_id với action 'fnb.discount_override'
--     + target = p_invoice_id
--
-- Khác fnb_cancel_unpaid_order_atomic (00066) đã có pattern này — em apply
-- y hệt cho 2 RPC chưa có.
-- ============================================================

-- ────────────────────────────────────────────────────────────────
-- 1. fnb_void_invoice_atomic — thêm p_otp_id + verify
-- ────────────────────────────────────────────────────────────────
drop function if exists public.fnb_void_invoice_atomic(uuid, uuid, text, uuid, uuid, uuid, uuid);

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
  v_cash_code text;
  v_lots_reverted int := 0;
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
    -- Đảm bảo manager cấp OTP có quyền void_paid_bill
    if not public.user_has_permission(v_approver, 'pos_fnb.void_paid_bill') then
      raise exception 'PERMISSION_DENIED: người duyệt OTP không có quyền void_paid_bill';
    end if;
  else
    -- Không có OTP → cashier phải tự có quyền
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

  -- 3. Loop items: revert stock + lot
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
      'lots_reverted', v_lots_reverted
    )
  );

  return jsonb_build_object(
    'success', true,
    'lots_reverted', v_lots_reverted,
    'approved_by', v_approver,
    'delegated', (p_otp_id is not null)
  );
end;
$$;

grant execute on function public.fnb_void_invoice_atomic(uuid, uuid, text, uuid, uuid, uuid, uuid, uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────
-- 2. record_discount_audit — verify OTP nếu có
-- ────────────────────────────────────────────────────────────────
create or replace function public.record_discount_audit(
  p_invoice_id uuid,
  p_invoice_code text,
  p_invoice_total numeric,
  p_discount_amount numeric,
  p_discount_percent numeric,
  p_reason text,
  p_otp_id uuid default null,
  p_actor_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := coalesce(p_actor_id, auth.uid());
  v_caller_tenant uuid := public._current_caller_tenant();
  v_tenant_id uuid;
  v_approver uuid;
begin
  if v_caller_tenant is null then
    raise exception 'UNAUTHORIZED: không xác định được tenant của người gọi.';
  end if;

  select tenant_id into v_tenant_id from public.invoices where id = p_invoice_id;
  if v_tenant_id is null then
    raise exception 'INVOICE_NOT_FOUND: %', p_invoice_id;
  end if;
  if v_tenant_id <> v_caller_tenant then
    raise exception 'TENANT_MISMATCH: bạn không có quyền ghi audit cho hoá đơn này.';
  end if;

  -- Verify OTP nếu có — phải đúng target invoice + action + còn hạn
  if p_otp_id is not null then
    v_approver := public.verify_otp_authorization(
      p_otp_id, 'fnb.discount_override', auth.uid(), p_invoice_id
    );
    if not public.user_has_permission(v_approver, 'pos_fnb.discount') then
      raise exception 'PERMISSION_DENIED: người duyệt OTP không có quyền pos_fnb.discount';
    end if;
  else
    v_approver := v_actor;
  end if;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_tenant_id, v_actor, 'discount_applied', 'invoice', p_invoice_id,
    jsonb_build_object(
      'invoice_code', p_invoice_code,
      'invoice_total', p_invoice_total,
      'discount_amount', p_discount_amount,
      'discount_percent', p_discount_percent,
      'reason', p_reason,
      'otp_id', p_otp_id,
      'approved_by', v_approver,
      'delegated', (p_otp_id is not null),
      'applied_at', now()
    )
  );

  return jsonb_build_object(
    'success', true,
    'invoice_id', p_invoice_id,
    'audit_recorded', true,
    'approved_by', v_approver
  );
end;
$$;

grant execute on function public.record_discount_audit(uuid, text, numeric, numeric, numeric, text, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
