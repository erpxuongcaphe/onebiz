-- ============================================================
-- 00093: cleanup_test_product_atomic — Xoá HẲN SP TEST/SEED có tồn kho
--
-- BỐI CẢNH: CEO 17/05/2026, sau khi 00091 (soft delete) + 00092 (force delete)
-- vẫn không clean được 167 SP test/seed data có tồn kho khởi tạo. RPC cũ
-- chặn vì lo sợ làm hỏng kế toán — đúng cho SP thật, sai cho SP test.
--
-- KHÁC BIỆT VỚI 00092 (force_delete_product_atomic):
--   - 00092: KHÔNG bypass stock check → SP có tồn kho > 0 bị reject
--   - 00093: BYPASS stock check → tự delete branch_stock rows + audit log
--            số lượng đã reset
--
-- AN TOÀN VẪN GIỮ:
--   - Chỉ owner (role='owner')
--   - Pre-check 17 bảng FK (stock_movements, invoice_items, ...) — SP có
--     lịch sử giao dịch thực → reject với lý do "có giao dịch thực"
--   - Audit log action='cleanup_test_data' (riêng biệt với 'force_delete')
--   - Audit log ghi snapshot tồn kho đã reset để truy vết
-- ============================================================

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
begin
  -- ─── 1. Auth ───
  if v_actor is null then
    raise exception 'AUTH_REQUIRED: vui lòng đăng nhập lại';
  end if;

  select id, tenant_id, role into v_profile
  from public.profiles where id = v_actor and is_active = true;

  if not found then
    raise exception 'USER_PROFILE_NOT_FOUND: %', v_actor;
  end if;

  -- ─── 2. Permission: chỉ owner ───
  if v_profile.role <> 'owner' then
    raise exception 'PERMISSION_DENIED: chỉ chủ sở hữu (owner) mới được cleanup test data';
  end if;

  -- ─── 3. Lock SP ───
  select * into v_product
  from public.products
  where id = p_product_id and tenant_id = v_profile.tenant_id
  for update;

  if not found then
    raise exception 'PRODUCT_NOT_FOUND: %', p_product_id;
  end if;

  -- ─── 4. Snapshot tồn kho hiện tại (audit log) ───
  select
    coalesce(sum(quantity), 0)::numeric,
    count(*),
    coalesce(jsonb_agg(
      jsonb_build_object('branch_id', branch_id, 'quantity', quantity)
    ) filter (where quantity > 0), '[]'::jsonb)
  into v_total_stock, v_stock_count, v_stock_snapshot
  from public.branch_stock
  where product_id = p_product_id;

  -- ─── 5. Pre-check 17 bảng FK — vẫn check như 00092 nhưng KHÔNG check branch_stock ───
  -- (branch_stock sẽ tự xoá ở bước 7)

  -- 5.1 stock_movements
  select count(*) into v_count from public.stock_movements where product_id = p_product_id;
  if v_count > 0 then
    v_refs := v_refs || jsonb_build_object('table', 'stock_movements', 'label', 'lịch sử kho', 'count', v_count);
    v_total_refs := v_total_refs + v_count;
  end if;

  -- 5.2 invoice_items
  select count(*) into v_count from public.invoice_items where product_id = p_product_id;
  if v_count > 0 then
    v_refs := v_refs || jsonb_build_object('table', 'invoice_items', 'label', 'hoá đơn bán', 'count', v_count);
    v_total_refs := v_total_refs + v_count;
  end if;

  -- 5.3 purchase_order_items
  select count(*) into v_count from public.purchase_order_items where product_id = p_product_id;
  if v_count > 0 then
    v_refs := v_refs || jsonb_build_object('table', 'purchase_order_items', 'label', 'đơn đặt hàng nhập', 'count', v_count);
    v_total_refs := v_total_refs + v_count;
  end if;

  -- 5.4 inventory_check_items
  select count(*) into v_count from public.inventory_check_items where product_id = p_product_id;
  if v_count > 0 then
    v_refs := v_refs || jsonb_build_object('table', 'inventory_check_items', 'label', 'kiểm kê', 'count', v_count);
    v_total_refs := v_total_refs + v_count;
  end if;

  -- 5.5 return_items
  select count(*) into v_count from public.return_items where product_id = p_product_id;
  if v_count > 0 then
    v_refs := v_refs || jsonb_build_object('table', 'return_items', 'label', 'trả hàng bán', 'count', v_count);
    v_total_refs := v_total_refs + v_count;
  end if;

  -- 5.6 supplier_return_items
  select count(*) into v_count from public.supplier_return_items where product_id = p_product_id;
  if v_count > 0 then
    v_refs := v_refs || jsonb_build_object('table', 'supplier_return_items', 'label', 'trả hàng NCC', 'count', v_count);
    v_total_refs := v_total_refs + v_count;
  end if;

  -- 5.7 disposal_export_items
  select count(*) into v_count from public.disposal_export_items where product_id = p_product_id;
  if v_count > 0 then
    v_refs := v_refs || jsonb_build_object('table', 'disposal_export_items', 'label', 'xuất huỷ', 'count', v_count);
    v_total_refs := v_total_refs + v_count;
  end if;

  -- 5.8 internal_export_items
  select count(*) into v_count from public.internal_export_items where product_id = p_product_id;
  if v_count > 0 then
    v_refs := v_refs || jsonb_build_object('table', 'internal_export_items', 'label', 'xuất nội bộ', 'count', v_count);
    v_total_refs := v_total_refs + v_count;
  end if;

  -- 5.9 sales_order_items
  select count(*) into v_count from public.sales_order_items where product_id = p_product_id;
  if v_count > 0 then
    v_refs := v_refs || jsonb_build_object('table', 'sales_order_items', 'label', 'đơn đặt hàng bán', 'count', v_count);
    v_total_refs := v_total_refs + v_count;
  end if;

  -- 5.10 stock_transfer_items
  select count(*) into v_count from public.stock_transfer_items where product_id = p_product_id;
  if v_count > 0 then
    v_refs := v_refs || jsonb_build_object('table', 'stock_transfer_items', 'label', 'chuyển kho', 'count', v_count);
    v_total_refs := v_total_refs + v_count;
  end if;

  -- 5.11 kitchen_order_items
  select count(*) into v_count from public.kitchen_order_items where product_id = p_product_id;
  if v_count > 0 then
    v_refs := v_refs || jsonb_build_object('table', 'kitchen_order_items', 'label', 'order bếp FnB', 'count', v_count);
    v_total_refs := v_total_refs + v_count;
  end if;

  -- 5.12 bom_items (SP là NVL của SP khác)
  select count(*) into v_count from public.bom_items where material_id = p_product_id;
  if v_count > 0 then
    v_refs := v_refs || jsonb_build_object('table', 'bom_items', 'label', 'là NVL của SP khác', 'count', v_count);
    v_total_refs := v_total_refs + v_count;
  end if;

  -- 5.13 production_orders
  select count(*) into v_count from public.production_orders where product_id = p_product_id;
  if v_count > 0 then
    v_refs := v_refs || jsonb_build_object('table', 'production_orders', 'label', 'lệnh sản xuất', 'count', v_count);
    v_total_refs := v_total_refs + v_count;
  end if;

  -- 5.14 production_order_materials
  select count(*) into v_count from public.production_order_materials where product_id = p_product_id;
  if v_count > 0 then
    v_refs := v_refs || jsonb_build_object('table', 'production_order_materials', 'label', 'NVL SX', 'count', v_count);
    v_total_refs := v_total_refs + v_count;
  end if;

  -- 5.15 product_lots
  select count(*) into v_count from public.product_lots where product_id = p_product_id;
  if v_count > 0 then
    v_refs := v_refs || jsonb_build_object('table', 'product_lots', 'label', 'lô sản xuất', 'count', v_count);
    v_total_refs := v_total_refs + v_count;
  end if;

  -- 5.16 internal_sale_items
  select count(*) into v_count from public.internal_sale_items where product_id = p_product_id;
  if v_count > 0 then
    v_refs := v_refs || jsonb_build_object('table', 'internal_sale_items', 'label', 'bán nội bộ', 'count', v_count);
    v_total_refs := v_total_refs + v_count;
  end if;

  -- ─── 6. Quyết định ───
  if v_total_refs > 0 then
    raise exception 'PRODUCT_HAS_REAL_DATA: SP "%" có % giao dịch THỰC ở các bảng: %. Đây không phải test data — chỉ có thể ngừng kinh doanh, không thể cleanup.',
      v_product.name, v_total_refs, v_refs::text;
  end if;

  -- ─── 7. CLEANUP: xoá branch_stock + DELETE product ───
  delete from public.branch_stock where product_id = p_product_id;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_profile.tenant_id, v_actor, 'cleanup_test_data', 'product', p_product_id,
    to_jsonb(v_product),
    jsonb_build_object(
      'reason', 'owner cleanup test/seed data — bypass stock check',
      'cleaned_stock_total_quantity', v_total_stock,
      'cleaned_stock_branches_count', v_stock_count,
      'stock_snapshot', v_stock_snapshot,
      'checked_at', now()
    )
  );

  -- Các bảng cascade (product_prices, product_variants, bom, uom_conversions,
  -- price_tier_items, product_platform_prices) sẽ tự xoá theo.
  delete from public.products
  where id = p_product_id and tenant_id = v_profile.tenant_id;

  return jsonb_build_object(
    'success', true,
    'product_id', p_product_id,
    'product_code', v_product.code,
    'product_name', v_product.name,
    'cleaned_stock_quantity', v_total_stock,
    'cleaned_stock_branches_count', v_stock_count,
    'cleanup_test_data', true
  );
end;
$$;

grant execute on function public.cleanup_test_product_atomic(uuid) to authenticated;

comment on function public.cleanup_test_product_atomic is
  'Cleanup test/seed data: BYPASS stock check + active check, vẫn check 17 bảng FK. Chỉ owner. CEO 17/05/2026.';

-- ────────────────────────────────────────────────────────────────
-- Bulk version
-- ────────────────────────────────────────────────────────────────
create or replace function public.bulk_cleanup_test_products_atomic(
  p_product_ids uuid[]
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_profile record;
  v_id uuid;
  v_cleaned int := 0;
  v_failed jsonb := '[]'::jsonb;
  v_result jsonb;
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

  if p_product_ids is null or array_length(p_product_ids, 1) is null then
    return jsonb_build_object('success', true, 'cleaned', 0, 'failed', '[]'::jsonb, 'total', 0);
  end if;

  for v_id in select unnest(p_product_ids) loop
    begin
      v_result := public.cleanup_test_product_atomic(v_id);
      v_cleaned := v_cleaned + 1;
    exception
      when others then
        v_failed := v_failed || jsonb_build_object(
          'product_id', v_id,
          'reason', SQLERRM
        );
    end;
  end loop;

  return jsonb_build_object(
    'success', true,
    'cleaned', v_cleaned,
    'failed', v_failed,
    'total', array_length(p_product_ids, 1),
    'failed_count', jsonb_array_length(v_failed),
    'cleanup_test_data', true
  );
end;
$$;

grant execute on function public.bulk_cleanup_test_products_atomic(uuid[]) to authenticated;

comment on function public.bulk_cleanup_test_products_atomic is
  'Bulk cleanup test/seed data: mỗi SP đi qua cleanup_test_product_atomic riêng. Chỉ owner. CEO 17/05/2026.';

notify pgrst, 'reload schema';
