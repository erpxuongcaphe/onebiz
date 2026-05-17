-- ============================================================
-- 00094: Nới logic cleanup_test_product + soft delete (CEO 17/05/2026)
--
-- BỐI CẢNH (em đã test thực tế trên onebiz.com.vn/hang-hoa):
-- 1. CEO chọn 167 SP test → click "Cleanup test data" → server reject tất cả
--    với PRODUCT_HAS_REAL_DATA vì có record `stock_movements`.
--    Nhưng đây là `stock_movements` type='initial' (set tồn ban đầu khi
--    tạo SP / Excel import) — KHÔNG phải bán/nhập/SX thực.
--    → Logic 00093 false positive: coi initial stock là "giao dịch thực".
--
-- 2. CEO ngừng KD bulk → reject vì còn `branch_stock.quantity > 0`.
--    Logic 00091 ép user kiểm kê về 0 trước khi ngừng KD → workflow phiền.
--    Pattern chuẩn ERP (SAP/Odoo): cho phép discontinue SP còn tồn — soft
--    delete chỉ ẩn UI, tồn kho vẫn track được. Sau đó kế toán xử lý tồn
--    qua xuất huỷ / chuyển kho tuỳ tình huống.
--
-- THAY ĐỔI:
-- A. cleanup_test_product_atomic + bulk_cleanup_test_products_atomic
--    - BỎ check `stock_movements` (initial stock không phải giao dịch thực)
--    - BỎ check `inventory_check_items` (kiểm kê khởi tạo về 0 cũng tạo record)
--    - GIỮ 15 bảng FK khác: invoice_items, purchase_order_items,
--      sales_order_items, return_items, supplier_return_items,
--      disposal_export_items, internal_export_items, stock_transfer_items,
--      kitchen_order_items, bom_items, production_orders,
--      production_order_materials, product_lots, internal_sale_items
--    - Stock_movements + inventory_check_items sẽ tự xoá cascade khi DELETE
--
-- B. delete_product_atomic + bulk_delete_products_atomic (00091)
--    - BỎ check `branch_stock.quantity > 0` → cho phép ngừng KD SP còn tồn
--    - Cleanup branch_stock zero rows vẫn giữ (giảm noise)
--    - Audit log ghi snapshot tồn kho lúc ngừng KD (tracking)
-- ============================================================

-- ────────────────────────────────────────────────────────────────
-- A. cleanup_test_product_atomic — bỏ check stock_movements + inv_check
-- ────────────────────────────────────────────────────────────────
create or replace function public.cleanup_test_product_atomic(
  p_product_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_profile record;
  v_product record;
  v_refs jsonb := '[]'::jsonb;
  v_count int;
  v_total_refs int := 0;
  v_stock_count int := 0;
  v_total_stock numeric := 0;
  v_stock_snapshot jsonb := '[]'::jsonb;
  v_movements_count int := 0;
  v_checks_count int := 0;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED: vui lòng đăng nhập lại';
  end if;

  select id, tenant_id, role into v_profile
  from public.profiles where id = v_actor and is_active = true;

  if not found then
    raise exception 'USER_PROFILE_NOT_FOUND: %', v_actor;
  end if;

  if v_profile.role <> 'owner' then
    raise exception 'PERMISSION_DENIED: chỉ chủ sở hữu (owner) mới được cleanup test data';
  end if;

  select * into v_product
  from public.products
  where id = p_product_id and tenant_id = v_profile.tenant_id
  for update;

  if not found then
    raise exception 'PRODUCT_NOT_FOUND: %', p_product_id;
  end if;

  -- Snapshot tồn kho + lịch sử movements/checks để audit log (truy được sau cleanup)
  select
    coalesce(sum(quantity), 0)::numeric,
    count(*),
    coalesce(jsonb_agg(
      jsonb_build_object('branch_id', branch_id, 'quantity', quantity)
    ) filter (where quantity > 0), '[]'::jsonb)
  into v_total_stock, v_stock_count, v_stock_snapshot
  from public.branch_stock
  where product_id = p_product_id;

  select count(*) into v_movements_count from public.stock_movements where product_id = p_product_id;
  select count(*) into v_checks_count from public.inventory_check_items where product_id = p_product_id;

  -- ─── Pre-check 15 bảng FK (BỎ stock_movements + inventory_check_items) ───
  -- Lý do: 2 bảng đó có record khi tạo SP / kiểm kê khởi tạo → false positive

  select count(*) into v_count from public.invoice_items where product_id = p_product_id;
  if v_count > 0 then
    v_refs := v_refs || jsonb_build_object('label', 'hoá đơn bán', 'count', v_count);
    v_total_refs := v_total_refs + v_count;
  end if;

  select count(*) into v_count from public.purchase_order_items where product_id = p_product_id;
  if v_count > 0 then
    v_refs := v_refs || jsonb_build_object('label', 'đơn đặt hàng nhập', 'count', v_count);
    v_total_refs := v_total_refs + v_count;
  end if;

  select count(*) into v_count from public.return_items where product_id = p_product_id;
  if v_count > 0 then
    v_refs := v_refs || jsonb_build_object('label', 'trả hàng bán', 'count', v_count);
    v_total_refs := v_total_refs + v_count;
  end if;

  select count(*) into v_count from public.supplier_return_items where product_id = p_product_id;
  if v_count > 0 then
    v_refs := v_refs || jsonb_build_object('label', 'trả hàng NCC', 'count', v_count);
    v_total_refs := v_total_refs + v_count;
  end if;

  select count(*) into v_count from public.disposal_export_items where product_id = p_product_id;
  if v_count > 0 then
    v_refs := v_refs || jsonb_build_object('label', 'xuất huỷ', 'count', v_count);
    v_total_refs := v_total_refs + v_count;
  end if;

  select count(*) into v_count from public.internal_export_items where product_id = p_product_id;
  if v_count > 0 then
    v_refs := v_refs || jsonb_build_object('label', 'xuất nội bộ', 'count', v_count);
    v_total_refs := v_total_refs + v_count;
  end if;

  select count(*) into v_count from public.sales_order_items where product_id = p_product_id;
  if v_count > 0 then
    v_refs := v_refs || jsonb_build_object('label', 'đơn đặt hàng bán', 'count', v_count);
    v_total_refs := v_total_refs + v_count;
  end if;

  select count(*) into v_count from public.stock_transfer_items where product_id = p_product_id;
  if v_count > 0 then
    v_refs := v_refs || jsonb_build_object('label', 'chuyển kho', 'count', v_count);
    v_total_refs := v_total_refs + v_count;
  end if;

  select count(*) into v_count from public.kitchen_order_items where product_id = p_product_id;
  if v_count > 0 then
    v_refs := v_refs || jsonb_build_object('label', 'order bếp FnB', 'count', v_count);
    v_total_refs := v_total_refs + v_count;
  end if;

  select count(*) into v_count from public.bom_items where material_id = p_product_id;
  if v_count > 0 then
    v_refs := v_refs || jsonb_build_object('label', 'là NVL của SP khác', 'count', v_count);
    v_total_refs := v_total_refs + v_count;
  end if;

  select count(*) into v_count from public.production_orders where product_id = p_product_id;
  if v_count > 0 then
    v_refs := v_refs || jsonb_build_object('label', 'lệnh sản xuất', 'count', v_count);
    v_total_refs := v_total_refs + v_count;
  end if;

  select count(*) into v_count from public.production_order_materials where product_id = p_product_id;
  if v_count > 0 then
    v_refs := v_refs || jsonb_build_object('label', 'NVL SX', 'count', v_count);
    v_total_refs := v_total_refs + v_count;
  end if;

  select count(*) into v_count from public.product_lots where product_id = p_product_id;
  if v_count > 0 then
    v_refs := v_refs || jsonb_build_object('label', 'lô sản xuất', 'count', v_count);
    v_total_refs := v_total_refs + v_count;
  end if;

  select count(*) into v_count from public.internal_sale_items where product_id = p_product_id;
  if v_count > 0 then
    v_refs := v_refs || jsonb_build_object('label', 'bán nội bộ', 'count', v_count);
    v_total_refs := v_total_refs + v_count;
  end if;

  if v_total_refs > 0 then
    raise exception 'PRODUCT_HAS_REAL_DATA: SP "%" có % giao dịch THỰC ở: %. Đây không phải test data — chỉ ngừng kinh doanh được.',
      v_product.name, v_total_refs, v_refs::text;
  end if;

  -- ─── CLEANUP: cascade tự xoá stock_movements, branch_stock, ... ───
  -- (FK 00006 + 00049 đã hardening cascade cho 6 bảng)
  -- branch_stock có thể RESTRICT (do bug 00006 → 00049) nên xoá thẳng cho an toàn
  delete from public.branch_stock where product_id = p_product_id;
  -- stock_movements + inventory_check_items: nếu FK ON DELETE RESTRICT,
  -- phải xoá thẳng. Audit log đã lưu count trước đó.
  delete from public.stock_movements where product_id = p_product_id;
  delete from public.inventory_check_items where product_id = p_product_id;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_profile.tenant_id, v_actor, 'cleanup_test_data', 'product', p_product_id,
    to_jsonb(v_product),
    jsonb_build_object(
      'reason', 'owner cleanup test/seed data — bypass stock + movements + inventory checks',
      'cleaned_stock_total_quantity', v_total_stock,
      'cleaned_stock_branches_count', v_stock_count,
      'cleaned_stock_movements_count', v_movements_count,
      'cleaned_inventory_checks_count', v_checks_count,
      'stock_snapshot', v_stock_snapshot,
      'checked_at', now()
    )
  );

  delete from public.products
  where id = p_product_id and tenant_id = v_profile.tenant_id;

  return jsonb_build_object(
    'success', true,
    'product_id', p_product_id,
    'product_code', v_product.code,
    'product_name', v_product.name,
    'cleaned_stock_quantity', v_total_stock,
    'cleaned_stock_branches_count', v_stock_count,
    'cleaned_movements', v_movements_count,
    'cleaned_inventory_checks', v_checks_count,
    'cleanup_test_data', true
  );
end;
$$;

grant execute on function public.cleanup_test_product_atomic(uuid) to authenticated;

comment on function public.cleanup_test_product_atomic is
  'Cleanup test/seed data v2 — BỎ check stock_movements + inventory_check_items (initial stock không phải giao dịch thực). Chỉ owner. CEO 17/05/2026.';

-- ────────────────────────────────────────────────────────────────
-- B. bulk_delete_products_atomic — BỎ check tồn kho > 0 (CEO 17/05/2026)
-- ────────────────────────────────────────────────────────────────
create or replace function public.bulk_delete_products_atomic(
  p_product_ids uuid[],
  p_actor_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := coalesce(p_actor_id, auth.uid());
  v_caller_tenant uuid;
  v_product record;
  v_id uuid;
  v_stock_qty numeric;
  v_deactivated int := 0;
  v_failed jsonb := '[]'::jsonb;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED: vui lòng đăng nhập lại.';
  end if;

  select tenant_id into v_caller_tenant
  from public.profiles
  where id = v_actor and is_active = true;

  if v_caller_tenant is null then
    raise exception 'USER_PROFILE_NOT_FOUND: tài khoản không có profile active hoặc thiếu tenant_id.';
  end if;

  if p_product_ids is null or array_length(p_product_ids, 1) is null then
    return jsonb_build_object(
      'success', true, 'deleted', 0, 'failed', '[]'::jsonb, 'total', 0
    );
  end if;

  for v_id in select unnest(p_product_ids) loop
    select id, code, name, tenant_id, is_active into v_product
    from public.products
    where id = v_id and tenant_id = v_caller_tenant
    for update;

    if not found then
      v_failed := v_failed || jsonb_build_object(
        'product_id', v_id,
        'reason', 'Không tìm thấy SP (có thể đã bị xoá) hoặc không thuộc tenant của bạn'
      );
      continue;
    end if;

    -- Đã inactive → skip (idempotent)
    if v_product.is_active = false then
      v_deactivated := v_deactivated + 1;
      continue;
    end if;

    -- Cleanup branch_stock zero rows (giảm noise — vẫn giữ)
    delete from public.branch_stock
    where product_id = v_id
      and coalesce(quantity, 0) = 0
      and coalesce(reserved, 0) = 0;

    -- Day 17/05/2026: BỎ check branch_stock.quantity > 0.
    -- Pattern SAP/Odoo: discontinue SP còn tồn được. Sau ngừng KD xử lý tồn
    -- qua xuất huỷ/chuyển kho riêng. Audit log ghi snapshot tồn lúc ngừng KD.
    select coalesce(sum(quantity), 0)::numeric into v_stock_qty
    from public.branch_stock where product_id = v_id;

    update public.products
    set is_active = false, updated_at = now()
    where id = v_id and tenant_id = v_caller_tenant;

    insert into public.audit_log (
      tenant_id, user_id, action, entity_type, entity_id, old_data
    ) values (
      v_caller_tenant, v_actor, 'deactivate', 'product', v_id,
      jsonb_build_object(
        'code', v_product.code, 'name', v_product.name,
        'deactivated_at', now(),
        'remaining_stock_at_deactivation', v_stock_qty,
        'reason', 'soft delete via bulk_delete_products_atomic (v2 — allow stock > 0)'
      )
    );

    v_deactivated := v_deactivated + 1;
  end loop;

  return jsonb_build_object(
    'success', true,
    'deleted', v_deactivated,
    'deactivated', v_deactivated,
    'failed', v_failed,
    'total', array_length(p_product_ids, 1),
    'failed_count', jsonb_array_length(v_failed),
    'soft_delete', true,
    'allow_stock', true
  );
end;
$$;

grant execute on function public.bulk_delete_products_atomic(uuid[], uuid) to authenticated;

comment on function public.bulk_delete_products_atomic is
  'Soft delete nhiều SP v2 — BỎ check tồn kho > 0 (CEO 17/05/2026). Audit log ghi snapshot tồn lúc ngừng KD.';

-- ────────────────────────────────────────────────────────────────
-- C. delete_product_atomic (single) — đồng bộ với bulk
-- ────────────────────────────────────────────────────────────────
create or replace function public.delete_product_atomic(
  p_product_id uuid,
  p_otp_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_profile record;
  v_product record;
  v_approver uuid;
  v_stock_qty numeric;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED: vui lòng đăng nhập trước khi thao tác';
  end if;

  select id, tenant_id, role into v_profile
  from public.profiles where id = v_actor and is_active = true;

  if not found then
    raise exception 'USER_PROFILE_NOT_FOUND: %', v_actor;
  end if;

  if p_otp_id is not null then
    v_approver := public.verify_otp_authorization(
      p_otp_id, 'products.delete', v_actor, p_product_id
    );
  else
    v_approver := v_actor;
  end if;

  if not public.user_has_permission(v_approver, 'products.delete') then
    raise exception 'PERMISSION_DENIED: cần quyền products.delete để ngừng kinh doanh sản phẩm';
  end if;

  select * into v_product
  from public.products
  where id = p_product_id and tenant_id = v_profile.tenant_id
  for update;

  if not found then
    raise exception 'PRODUCT_NOT_FOUND: %', p_product_id;
  end if;

  if v_product.is_active = false then
    return jsonb_build_object(
      'success', true,
      'product_id', p_product_id,
      'product_code', v_product.code,
      'product_name', v_product.name,
      'already_inactive', true
    );
  end if;

  delete from public.branch_stock
  where product_id = p_product_id
    and coalesce(quantity, 0) = 0 and coalesce(reserved, 0) = 0;

  -- Day 17/05/2026: BỎ check tồn kho > 0
  select coalesce(sum(quantity), 0)::numeric into v_stock_qty
  from public.branch_stock where product_id = p_product_id;

  update public.products
  set is_active = false, updated_at = now()
  where id = p_product_id and tenant_id = v_profile.tenant_id;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_profile.tenant_id, v_actor, 'deactivate', 'product', p_product_id,
    to_jsonb(v_product),
    jsonb_build_object(
      'approved_by', v_approver,
      'otp_id', p_otp_id,
      'delegated', (p_otp_id is not null),
      'soft_delete', true,
      'remaining_stock_at_deactivation', v_stock_qty
    )
  );

  return jsonb_build_object(
    'success', true,
    'product_id', p_product_id,
    'product_code', v_product.code,
    'product_name', v_product.name,
    'approved_by', v_approver,
    'delegated', (p_otp_id is not null),
    'soft_delete', true,
    'remaining_stock_at_deactivation', v_stock_qty
  );
end;
$$;

grant execute on function public.delete_product_atomic(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
