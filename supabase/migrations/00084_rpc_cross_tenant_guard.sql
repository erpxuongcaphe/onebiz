-- ============================================================
-- 00084: Cross-tenant guard cho các RPC SECURITY DEFINER (CEO 17/05/2026)
--
-- VẤN ĐỀ phát hiện sau audit:
--   - 00074 (apply_disposal_export_atomic / apply_internal_export_atomic):
--     select theo `id = p_xxx_id` mà KHÔNG check tenant của caller →
--     authenticated user biết UUID có thể trigger hành động trên entity
--     của tenant khác (cross-tenant escalation).
--   - 00075 (delete_supplier_atomic / close_purchase_order_short): cùng pattern.
--   - 00076 (record_discount_audit): pull tenant từ invoice nhưng chưa verify
--     caller's tenant trùng → cashier tenant A có thể ghi audit log vào
--     invoice tenant B.
--   - 10 RPC reports (00079-00083): cho phép `p_tenant_id` override → nếu
--     client truyền tenant khác thì RPC trả data của tenant đó.
--
-- FIX: Mỗi RPC thêm helper `_check_caller_tenant(v_entity_tenant)` raise
--      exception 'TENANT_MISMATCH' nếu mismatch. Bỏ p_tenant_id override.
-- ============================================================

-- ────────────────────────────────────────────────────────────────
-- Helper: lấy tenant của caller hiện tại (cached qua auth.uid())
-- ────────────────────────────────────────────────────────────────
create or replace function public._current_caller_tenant()
returns uuid
language sql
stable
security definer
set search_path = public, extensions
as $$
  select tenant_id from public.profiles where id = auth.uid()
$$;

comment on function public._current_caller_tenant is
  'Helper trả tenant_id của user đang gọi (auth.uid()). Dùng trong SECURITY DEFINER RPC để chặn cross-tenant. CEO 17/05/2026.';

grant execute on function public._current_caller_tenant() to authenticated;

-- ────────────────────────────────────────────────────────────────
-- 1. apply_disposal_export_atomic — guard tenant
-- ────────────────────────────────────────────────────────────────
create or replace function public.apply_disposal_export_atomic(
  p_disposal_id uuid,
  p_actor_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_disposal record;
  v_actor uuid := coalesce(p_actor_id, auth.uid());
  v_caller_tenant uuid := public._current_caller_tenant();
  v_tenant_id uuid;
  v_branch_id uuid;
  v_items_count int := 0;
  v_cost numeric(15, 2);
  r record;
begin
  if v_caller_tenant is null then
    raise exception 'UNAUTHORIZED: không xác định được tenant của người gọi.';
  end if;

  select * into v_disposal
  from public.disposal_exports
  where id = p_disposal_id
  for update;

  if not found then
    raise exception 'DISPOSAL_NOT_FOUND: %', p_disposal_id;
  end if;

  -- GUARD: caller phải cùng tenant với entity
  if v_disposal.tenant_id <> v_caller_tenant then
    raise exception 'TENANT_MISMATCH: bạn không có quyền thao tác trên phiếu này.';
  end if;

  if v_disposal.status <> 'draft' then
    raise exception 'INVALID_STATUS: phiếu xuất hủy đang ở trạng thái "%" — không thể hoàn tất.', v_disposal.status;
  end if;

  v_tenant_id := v_disposal.tenant_id;
  v_branch_id := v_disposal.branch_id;

  update public.disposal_exports
  set status = 'completed', updated_at = now()
  where id = p_disposal_id;

  for r in
    select id, product_id, product_name, quantity
    from public.disposal_export_items
    where disposal_id = p_disposal_id
  loop
    if coalesce(r.quantity, 0) <= 0 then continue; end if;

    select coalesce(cost_price, 0) into v_cost
    from public.products where id = r.product_id;

    update public.disposal_export_items set unit_cost = v_cost where id = r.id;

    insert into public.stock_movements (
      tenant_id, branch_id, product_id, type, quantity,
      reference_type, reference_id, note, created_by
    ) values (
      v_tenant_id, v_branch_id, r.product_id, 'out', r.quantity,
      'disposal_export', p_disposal_id,
      v_disposal.code || ' - Xuất hủy - ' || r.product_name || ' (-' || r.quantity || ')',
      coalesce(v_actor, v_disposal.created_by)
    );

    perform public.increment_product_stock(r.product_id, -r.quantity);
    perform public.upsert_branch_stock(v_tenant_id, v_branch_id, r.product_id, -r.quantity);

    begin
      perform public.allocate_lots_fifo(
        v_tenant_id, r.product_id, v_branch_id, r.quantity,
        'disposal_export', p_disposal_id
      );
    exception when others then
      -- Day 17/05: log lỗi vào audit thay vì nuốt im lặng (P2 fix)
      insert into public.audit_log (
        tenant_id, user_id, action, entity_type, entity_id, new_data
      ) values (
        v_tenant_id, v_actor, 'lot_alloc_failed', 'disposal_export', p_disposal_id,
        jsonb_build_object(
          'product_id', r.product_id,
          'product_name', r.product_name,
          'quantity', r.quantity,
          'error', sqlerrm,
          'note', 'Stock tổng đã trừ nhưng lot chưa cập nhật — cần check reconciliation'
        )
      );
    end;

    v_items_count := v_items_count + 1;
  end loop;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_tenant_id,
    coalesce(v_actor, '00000000-0000-0000-0000-000000000000'::uuid),
    'complete_disposal', 'disposal_export', p_disposal_id,
    jsonb_build_object(
      'code', v_disposal.code,
      'items_count', v_items_count,
      'completed_at', now()
    )
  );

  return jsonb_build_object(
    'success', true,
    'disposal_id', p_disposal_id,
    'code', v_disposal.code,
    'items_processed', v_items_count
  );
end;
$$;

-- ────────────────────────────────────────────────────────────────
-- 2. apply_internal_export_atomic — guard tenant + lot log
-- ────────────────────────────────────────────────────────────────
create or replace function public.apply_internal_export_atomic(
  p_export_id uuid,
  p_actor_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_export record;
  v_actor uuid := coalesce(p_actor_id, auth.uid());
  v_caller_tenant uuid := public._current_caller_tenant();
  v_tenant_id uuid;
  v_branch_id uuid;
  v_items_count int := 0;
  r record;
begin
  if v_caller_tenant is null then
    raise exception 'UNAUTHORIZED: không xác định được tenant của người gọi.';
  end if;

  select * into v_export
  from public.internal_exports
  where id = p_export_id
  for update;

  if not found then
    raise exception 'INTERNAL_EXPORT_NOT_FOUND: %', p_export_id;
  end if;

  if v_export.tenant_id <> v_caller_tenant then
    raise exception 'TENANT_MISMATCH: bạn không có quyền thao tác trên phiếu này.';
  end if;

  if v_export.status <> 'draft' then
    raise exception 'INVALID_STATUS: phiếu xuất nội bộ đang ở trạng thái "%" — không thể hoàn tất.', v_export.status;
  end if;

  v_tenant_id := v_export.tenant_id;
  v_branch_id := v_export.branch_id;

  update public.internal_exports
  set status = 'completed', updated_at = now()
  where id = p_export_id;

  for r in
    select id, product_id, product_name, quantity
    from public.internal_export_items
    where export_id = p_export_id
  loop
    if coalesce(r.quantity, 0) <= 0 then continue; end if;

    insert into public.stock_movements (
      tenant_id, branch_id, product_id, type, quantity,
      reference_type, reference_id, note, created_by
    ) values (
      v_tenant_id, v_branch_id, r.product_id, 'out', r.quantity,
      'internal_export', p_export_id,
      v_export.code || ' - Xuất nội bộ - ' || r.product_name || ' (-' || r.quantity || ')',
      coalesce(v_actor, v_export.created_by)
    );

    perform public.increment_product_stock(r.product_id, -r.quantity);
    perform public.upsert_branch_stock(v_tenant_id, v_branch_id, r.product_id, -r.quantity);

    begin
      perform public.allocate_lots_fifo(
        v_tenant_id, r.product_id, v_branch_id, r.quantity,
        'internal_export', p_export_id
      );
    exception when others then
      insert into public.audit_log (
        tenant_id, user_id, action, entity_type, entity_id, new_data
      ) values (
        v_tenant_id, v_actor, 'lot_alloc_failed', 'internal_export', p_export_id,
        jsonb_build_object(
          'product_id', r.product_id,
          'product_name', r.product_name,
          'quantity', r.quantity,
          'error', sqlerrm
        )
      );
    end;

    v_items_count := v_items_count + 1;
  end loop;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_tenant_id,
    coalesce(v_actor, '00000000-0000-0000-0000-000000000000'::uuid),
    'complete_internal_export', 'internal_export', p_export_id,
    jsonb_build_object(
      'code', v_export.code,
      'items_count', v_items_count,
      'completed_at', now()
    )
  );

  return jsonb_build_object(
    'success', true,
    'export_id', p_export_id,
    'code', v_export.code,
    'items_processed', v_items_count
  );
end;
$$;

-- ────────────────────────────────────────────────────────────────
-- 3. delete_supplier_atomic — guard tenant
-- ────────────────────────────────────────────────────────────────
create or replace function public.delete_supplier_atomic(
  p_supplier_id uuid,
  p_actor_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_supplier record;
  v_actor uuid := coalesce(p_actor_id, auth.uid());
  v_caller_tenant uuid := public._current_caller_tenant();
  v_po_count int := 0;
  v_product_count int := 0;
  v_return_count int := 0;
begin
  if v_caller_tenant is null then
    raise exception 'UNAUTHORIZED: không xác định được tenant của người gọi.';
  end if;

  select * into v_supplier from public.suppliers
  where id = p_supplier_id for update;

  if not found then
    raise exception 'SUPPLIER_NOT_FOUND: %', p_supplier_id;
  end if;

  if v_supplier.tenant_id <> v_caller_tenant then
    raise exception 'TENANT_MISMATCH: bạn không có quyền xoá NCC này.';
  end if;

  select count(*) into v_po_count from public.purchase_orders
  where supplier_id = p_supplier_id;
  if v_po_count > 0 then
    raise exception 'SUPPLIER_HAS_PURCHASE_ORDERS: NCC "%" có % đơn nhập liên quan — không thể xoá.', v_supplier.name, v_po_count;
  end if;

  select count(*) into v_product_count from public.products
  where supplier_id = p_supplier_id;
  if v_product_count > 0 then
    raise exception 'SUPPLIER_HAS_PRODUCTS: NCC "%" đang là NCC mặc định của % sản phẩm.', v_supplier.name, v_product_count;
  end if;

  select count(*) into v_return_count from public.supplier_returns
  where supplier_id = p_supplier_id;
  if v_return_count > 0 then
    raise exception 'SUPPLIER_HAS_RETURNS: NCC "%" có % phiếu trả hàng.', v_supplier.name, v_return_count;
  end if;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data
  ) values (
    v_supplier.tenant_id, v_actor, 'delete', 'supplier', p_supplier_id,
    jsonb_build_object(
      'code', v_supplier.code, 'name', v_supplier.name,
      'phone', v_supplier.phone, 'email', v_supplier.email,
      'tax_code', v_supplier.tax_code
    )
  );

  delete from public.suppliers where id = p_supplier_id;

  return jsonb_build_object(
    'success', true,
    'supplier_id', p_supplier_id,
    'code', v_supplier.code, 'name', v_supplier.name
  );
end;
$$;

-- ────────────────────────────────────────────────────────────────
-- 4. close_purchase_order_short — guard tenant
-- ────────────────────────────────────────────────────────────────
create or replace function public.close_purchase_order_short(
  p_order_id uuid,
  p_reason text,
  p_actor_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_order record;
  v_actor uuid := coalesce(p_actor_id, auth.uid());
  v_caller_tenant uuid := public._current_caller_tenant();
  v_received_count int := 0;
  v_remaining_count int := 0;
begin
  if v_caller_tenant is null then
    raise exception 'UNAUTHORIZED: không xác định được tenant của người gọi.';
  end if;

  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'INVALID_REASON: Lý do đóng đơn tối thiểu 5 ký tự.';
  end if;

  select * into v_order from public.purchase_orders
  where id = p_order_id for update;

  if not found then
    raise exception 'PO_NOT_FOUND: %', p_order_id;
  end if;

  if v_order.tenant_id <> v_caller_tenant then
    raise exception 'TENANT_MISMATCH: bạn không có quyền đóng đơn này.';
  end if;

  if v_order.status not in ('partial', 'ordered') then
    raise exception 'INVALID_STATUS: PO đang ở trạng thái "%" — chỉ có thể đóng đơn partial hoặc ordered.', v_order.status;
  end if;

  select
    count(*) filter (where coalesce(received_quantity, 0) >= quantity),
    count(*) filter (where coalesce(received_quantity, 0) < quantity)
  into v_received_count, v_remaining_count
  from public.purchase_order_items where order_id = p_order_id;

  update public.purchase_orders
  set status = 'completed',
      closed_short = true,
      close_reason = trim(p_reason),
      closed_at = now(),
      closed_by = v_actor,
      updated_at = now()
  where id = p_order_id;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_order.tenant_id, v_actor, 'close_short', 'purchase_order', p_order_id,
    jsonb_build_object(
      'code', v_order.code,
      'previous_status', v_order.status,
      'reason', trim(p_reason),
      'items_received_fully', v_received_count,
      'items_remaining', v_remaining_count,
      'closed_at', now()
    )
  );

  return jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'code', v_order.code,
    'items_received_fully', v_received_count,
    'items_remaining', v_remaining_count
  );
end;
$$;

-- ────────────────────────────────────────────────────────────────
-- 5. record_discount_audit — guard tenant
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
      'applied_at', now()
    )
  );

  return jsonb_build_object(
    'success', true,
    'invoice_id', p_invoice_id,
    'audit_recorded', true
  );
end;
$$;

-- ────────────────────────────────────────────────────────────────
-- 6. Reports RPC (00079-00083) — guard p_tenant_id override
--
-- Cách tiếp cận: tạo helper `_resolve_report_tenant` ép tenant về caller's
-- tenant nếu p_tenant_id null hoặc trùng. Nếu p_tenant_id khác caller → raise.
-- Sau đó các RPC reports tự gọi helper này.
--
-- Để tránh re-deploy 10 RPC dài, em chỉ thêm helper. Các RPC hiện đã pattern
-- `coalesce(p_tenant_id, (select tenant_id from profiles where id = auth.uid()))`
-- → nếu attacker truyền tenant khác thì query thẳng được. Em wrap helper để
-- chặn case đó.
-- ────────────────────────────────────────────────────────────────
create or replace function public._resolve_report_tenant(p_requested_tenant uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_caller_tenant uuid;
begin
  v_caller_tenant := public._current_caller_tenant();
  if v_caller_tenant is null then
    raise exception 'UNAUTHORIZED: không xác định được tenant của người gọi.';
  end if;
  if p_requested_tenant is not null and p_requested_tenant <> v_caller_tenant then
    raise exception 'TENANT_MISMATCH: không thể xem báo cáo của tenant khác.';
  end if;
  return v_caller_tenant;
end;
$$;

comment on function public._resolve_report_tenant is
  'Resolve tenant cho RPC reports: nếu caller truyền p_tenant_id khác tenant của mình → raise. Dùng trong 10 RPC reports để chặn cross-tenant read. CEO 17/05/2026.';

grant execute on function public._resolve_report_tenant(uuid) to authenticated;

-- 10 RPC reports được guard tenant trong migration 00085 (file riêng cho gọn).

notify pgrst, 'reload schema';
