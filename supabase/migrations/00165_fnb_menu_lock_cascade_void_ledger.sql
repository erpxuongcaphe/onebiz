-- ============================================================
-- 00165 — Cách B (Đợt C): Khóa món F&B không giữ tồn — cascade công thức chung
--         ở quán + hủy bill hồi tồn theo SỔ CÁI (không cộng tồn ảo)
-- ============================================================
-- CEO 07/07/2026 — nền mã hàng Cách B. Món menu F&B (inventory_role='fnb_menu_item')
-- KHÔNG BAO GIỜ giữ tồn: bán trừ thành phần qua công thức (BOM); mọi tiêu hao/hồi
-- kho đi qua BOM hoặc đảo theo stock_movements — không cộng/trừ thẳng tồn mã món.
--
-- Migration này làm 2 việc AN TOÀN (latent — hiện 0 hóa đơn F&B, 2 mã fnb_menu_item
-- đều là mã test):
--
-- 1) should_cascade_bom_at_branch: MÓN MENU F&B luôn cascade công thức nếu có BOM
--    (global HOẶC branch-specific) ở MỌI chi nhánh. Trước đây tại QUÁN (outlet) chỉ
--    cascade khi có BOM branch-specific → món chỉ có công thức CHUNG (global) rơi
--    xuống nhánh "trừ tồn SKU thẳng" = tồn ảo ÂM cho mã món. (CEO chốt #5: dùng
--    công thức chung, chặn khi KHÔNG có công thức nào.)
--
-- 2) fnb_void_invoice_atomic (thay 00162): HỦY BILL hồi tồn theo SỔ CÁI thực tế
--    (reference_type='invoice', type='out') thay vì tái dựng từ invoice_items.
--    Lý do: món bán qua công thức (menu, hoặc SKU 2-mã cascade) KHÔNG phát sinh
--    movement trực tiếp lên mã bán → hồi theo invoice_items sẽ CỘNG TỒN ẢO cho mã
--    đó. Đảo đúng movement đã ghi → chỉ hồi những mã THẬT SỰ đã trừ tồn trực tiếp.
--    Thành phần (NVL/SKU Retail) vẫn hồi ở khối 3b (bom_consume/modifier_topping).
--
-- CHƯA làm ở migration này (để dành F&B go-live, khi có data test thật):
--   • Chặn cứng "món thiếu công thức → không bán" (cần sửa RPC bán 300 dòng +
--     test với món F&B thật). Hiện should_cascade + trigger phòng ngừa sẽ xử sau.
--   • Trigger tầng chung chặn mọi movement trực tiếp lên fnb_menu_item (blast
--     radius rộng trên bảng nóng → chỉ áp khi test được với F&B thật).
-- ============================================================

-- ────────────────────────────────────────────────────────────────
-- 1. should_cascade_bom_at_branch v2 — món F&B cascade công thức chung ở quán
-- ────────────────────────────────────────────────────────────────
create or replace function public.should_cascade_bom_at_branch(
  p_sku_id uuid,
  p_branch_id uuid
) returns boolean
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_cascade_mode text;
  v_has_branch_specific boolean;
  v_has_global boolean;
  v_role text;
begin
  select coalesce(cascade_mode, 'outlet') into v_cascade_mode
  from public.branches where id = p_branch_id;

  if v_cascade_mode is null then
    return false;  -- branch không tồn tại → không cascade
  end if;

  select exists (
    select 1 from public.bom
    where product_id = p_sku_id and branch_id = p_branch_id and is_active = true
  ) into v_has_branch_specific;

  select exists (
    select 1 from public.bom
    where product_id = p_sku_id and branch_id is null and is_active = true
  ) into v_has_global;

  -- CEO 07/07/2026 (Cách B): MÓN MENU F&B (fnb_menu_item) KHÔNG giữ tồn → PHẢI
  -- trừ theo công thức ở MỌI chi nhánh. Cascade nếu có BOM nào (global HOẶC
  -- branch-specific). Không rơi xuống "trừ tồn SKU thẳng" (sẽ tạo tồn ảo âm cho món).
  select inventory_role into v_role from public.products where id = p_sku_id;
  if v_role = 'fnb_menu_item' then
    return v_has_branch_specific or v_has_global;
  end if;

  -- Còn lại giữ nguyên logic 00123:
  if v_cascade_mode = 'production' then
    -- Kho/Xưởng: cascade nếu có BOM nào (SKU 2-mã trừ NVL gốc).
    return v_has_branch_specific or v_has_global;
  else
    -- Quán (outlet) + hàng KHÔNG phải món menu (vd SKU Retail bán takeaway):
    -- chỉ cascade khi có BOM riêng cho quán; còn lại trừ tồn SKU trực tiếp
    -- (SKU Retail giữ tồn thật tại quán).
    return v_has_branch_specific;
  end if;
end;
$$;

grant execute on function public.should_cascade_bom_at_branch(uuid, uuid) to authenticated;

comment on function public.should_cascade_bom_at_branch is
  'CEO 07/07/2026 v2 (Cách B): món F&B (fnb_menu_item) luôn cascade nếu có BOM (global/branch) ở mọi chi nhánh — không giữ tồn. Retail/NVL giữ logic 00123 (production=any BOM, outlet=branch-specific).';

-- ────────────────────────────────────────────────────────────────
-- 2. fnb_void_invoice_atomic v3 — hồi tồn theo SỔ CÁI (thay 00162)
-- ────────────────────────────────────────────────────────────────
-- Giữ NGUYÊN mọi phần 00162 (OTP/quyền, refund, kitchen, audit, khối 3b hồi NVL).
-- CHỈ đổi khối 3: đảo movement 'invoice'/'out' thực tế thay vì loop invoice_items.
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
  v_bom record;
  v_cash_code text;
  v_lots_reverted int := 0;
  v_nvl_reverted int := 0;
  v_sku_reverted int := 0;
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

  -- 3. 00165: HỒI TỒN THEO SỔ CÁI — chỉ đảo movement XUẤT TRỰC TIẾP của HĐ
  --    (reference_type='invoice', type='out'). KHÔNG tái dựng từ invoice_items:
  --    món bán qua công thức (menu F&B, hoặc SKU 2-mã cascade) KHÔNG có movement
  --    trực tiếp lên mã bán → hồi theo item = cộng TỒN ẢO. Đảo đúng movement đã
  --    ghi → chỉ hồi mã thật sự đã trừ tồn (vd SKU Retail takeaway ở quán, NVL...).
  for v_item in
    select product_id, sum(quantity) as qty
    from public.stock_movements
    where tenant_id = p_tenant_id
      and reference_id = p_invoice_id
      and reference_type = 'invoice'
      and type = 'out'
    group by product_id
  loop
    insert into public.stock_movements (
      tenant_id, branch_id, product_id, type, quantity,
      reference_type, reference_id, note, created_by
    ) values (
      p_tenant_id, p_branch_id, v_item.product_id, 'in', v_item.qty,
      'invoice_void', p_invoice_id,
      'Hoàn trả (sổ cái) - hủy HĐ ' || v_invoice.code || ': ' || coalesce(p_void_reason, ''),
      p_voided_by
    );

    perform public.increment_product_stock(v_item.product_id, v_item.qty);
    perform public.upsert_branch_stock(p_tenant_id, p_branch_id, v_item.product_id, v_item.qty);
    v_sku_reverted := v_sku_reverted + 1;

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

  -- 3b. Hồi NVL/thành phần tiêu hao theo BOM + topping (giữ nguyên 00162):
  -- reverse cả 2 sổ theo đúng branch đã tiêu hao.
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
      'sku_reverted', v_sku_reverted,
      'nvl_reverted', v_nvl_reverted
    )
  );

  return jsonb_build_object(
    'success', true,
    'lots_reverted', v_lots_reverted,
    'sku_reverted', v_sku_reverted,
    'nvl_reverted', v_nvl_reverted,
    'approved_by', v_approver,
    'delegated', (p_otp_id is not null)
  );
end;
$$;

grant execute on function public.fnb_void_invoice_atomic(uuid, uuid, text, uuid, uuid, uuid, uuid, uuid) to authenticated;

comment on function public.fnb_void_invoice_atomic is
  'Hủy bill F&B v3 (00165, Cách B): hồi tồn theo SỔ CÁI (movement invoice/out thực tế) thay vì invoice_items — tránh cộng tồn ảo cho món menu / SKU 2-mã cascade. Vẫn hồi NVL/topping (bom_consume/modifier_topping) + refund + kitchen + audit như 00162.';

notify pgrst, 'reload schema';

-- ============================================================
-- VERIFY sau khi áp (CEO chạy):
-- 1) should_cascade cho món F&B có BOM global tại quán = true:
--    select public.should_cascade_bom_at_branch('<fnb_menu_sku>', '<outlet_branch>');
-- 2) Hàm tồn tại + comment đúng:
--    select proname, obj_description(oid) from pg_proc
--    where proname in ('should_cascade_bom_at_branch','fnb_void_invoice_atomic');
-- Chưa kích hoạt trên data hiện tại (0 HĐ F&B) — vá trước F&B go-live.
-- ============================================================
