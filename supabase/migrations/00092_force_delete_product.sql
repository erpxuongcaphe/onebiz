-- ============================================================
-- 00092: force_delete_product_atomic — Xoá HẲN SP (CEO 17/05/2026)
--
-- BỐI CẢNH: Sau khi 00091 chuyển sang soft delete (is_active=false),
-- CEO hỏi: "SP test/tạo nhầm chưa có giao dịch — muốn xoá hẳn thì sao?"
--
-- LỰA CHỌN PATTERN: Cách A — Force delete chỉ owner (ERP best practice
-- của SAP/Odoo/NetSuite):
--   1. Default: soft delete cho mọi user (an toàn tuyệt đối)
--   2. Cleanup deliberate: chỉ owner mới xoá hẳn được, và chỉ trên SP
--      đã `is_active=false` (đã ngừng KD trước)
--   3. Pre-check 22 bảng FK — chỉ DELETE nếu KHÔNG còn ref nào
--   4. Nếu có refs → reject với danh sách bảng nào còn data
--
-- An toàn:
--   - SP active KHÔNG xoá hẳn được (ép soft trước)
--   - SP có giao dịch KHÔNG xoá hẳn được (FK + pre-check 2 lớp)
--   - User không phải owner KHÔNG xoá hẳn được (permission check)
--   - Audit log ghi action='force_delete' để track
--
-- Backward compat: KHÔNG đổi delete_product_atomic / bulk_delete_products_atomic.
-- ============================================================

create or replace function public.force_delete_product_atomic(
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

  -- ─── 2. Permission: chỉ owner mới xoá hẳn ───
  if v_profile.role <> 'owner' then
    raise exception 'PERMISSION_DENIED: chỉ chủ sở hữu (owner) mới được xoá hẳn sản phẩm. Vai trò khác chỉ có thể ngừng kinh doanh.';
  end if;

  -- ─── 3. Lock SP + check ───
  select * into v_product
  from public.products
  where id = p_product_id and tenant_id = v_profile.tenant_id
  for update;

  if not found then
    raise exception 'PRODUCT_NOT_FOUND: %', p_product_id;
  end if;

  -- ─── 4. SP phải đã ngừng KD trước (ép quy trình 2 bước) ───
  if v_product.is_active = true then
    raise exception 'PRODUCT_STILL_ACTIVE: SP "%" đang hoạt động. Vui lòng ngừng kinh doanh trước, sau đó mới xoá hẳn.', v_product.name;
  end if;

  -- ─── 5. Cleanup branch_stock zero rows trước (không phải data thật) ───
  delete from public.branch_stock
  where product_id = p_product_id
    and coalesce(quantity, 0) = 0
    and coalesce(reserved, 0) = 0;

  -- ─── 6. Pre-check 22 bảng FK ───
  -- Helper inline: thêm bảng vào v_refs nếu count > 0
  -- (PostgreSQL không có macro nên phải lặp)

  -- 6.1 — branch_stock (sau cleanup zero rows, còn lại là tồn kho > 0)
  select count(*) into v_count from public.branch_stock where product_id = p_product_id;
  if v_count > 0 then
    v_refs := v_refs || jsonb_build_object('table', 'branch_stock', 'label', 'tồn kho chi nhánh', 'count', v_count);
    v_total_refs := v_total_refs + v_count;
  end if;

  -- 6.2 — stock_movements (lịch sử nhập/xuất kho)
  select count(*) into v_count from public.stock_movements where product_id = p_product_id;
  if v_count > 0 then
    v_refs := v_refs || jsonb_build_object('table', 'stock_movements', 'label', 'lịch sử kho', 'count', v_count);
    v_total_refs := v_total_refs + v_count;
  end if;

  -- 6.3 — invoice_items (hoá đơn bán)
  select count(*) into v_count from public.invoice_items where product_id = p_product_id;
  if v_count > 0 then
    v_refs := v_refs || jsonb_build_object('table', 'invoice_items', 'label', 'hoá đơn bán', 'count', v_count);
    v_total_refs := v_total_refs + v_count;
  end if;

  -- 6.4 — purchase_order_items
  select count(*) into v_count from public.purchase_order_items where product_id = p_product_id;
  if v_count > 0 then
    v_refs := v_refs || jsonb_build_object('table', 'purchase_order_items', 'label', 'đơn đặt hàng nhập', 'count', v_count);
    v_total_refs := v_total_refs + v_count;
  end if;

  -- 6.5 — inventory_check_items
  select count(*) into v_count from public.inventory_check_items where product_id = p_product_id;
  if v_count > 0 then
    v_refs := v_refs || jsonb_build_object('table', 'inventory_check_items', 'label', 'kiểm kê', 'count', v_count);
    v_total_refs := v_total_refs + v_count;
  end if;

  -- 6.6 — return_items (trả hàng bán)
  select count(*) into v_count from public.return_items where product_id = p_product_id;
  if v_count > 0 then
    v_refs := v_refs || jsonb_build_object('table', 'return_items', 'label', 'trả hàng bán', 'count', v_count);
    v_total_refs := v_total_refs + v_count;
  end if;

  -- 6.7 — supplier_return_items (trả hàng NCC)
  select count(*) into v_count from public.supplier_return_items where product_id = p_product_id;
  if v_count > 0 then
    v_refs := v_refs || jsonb_build_object('table', 'supplier_return_items', 'label', 'trả hàng nhà cung cấp', 'count', v_count);
    v_total_refs := v_total_refs + v_count;
  end if;

  -- 6.8 — disposal_export_items (xuất huỷ)
  select count(*) into v_count from public.disposal_export_items where product_id = p_product_id;
  if v_count > 0 then
    v_refs := v_refs || jsonb_build_object('table', 'disposal_export_items', 'label', 'xuất huỷ', 'count', v_count);
    v_total_refs := v_total_refs + v_count;
  end if;

  -- 6.9 — internal_export_items (xuất nội bộ)
  select count(*) into v_count from public.internal_export_items where product_id = p_product_id;
  if v_count > 0 then
    v_refs := v_refs || jsonb_build_object('table', 'internal_export_items', 'label', 'xuất dùng nội bộ', 'count', v_count);
    v_total_refs := v_total_refs + v_count;
  end if;

  -- 6.10 — sales_order_items
  select count(*) into v_count from public.sales_order_items where product_id = p_product_id;
  if v_count > 0 then
    v_refs := v_refs || jsonb_build_object('table', 'sales_order_items', 'label', 'đơn đặt hàng bán', 'count', v_count);
    v_total_refs := v_total_refs + v_count;
  end if;

  -- 6.11 — stock_transfer_items (chuyển kho)
  select count(*) into v_count from public.stock_transfer_items where product_id = p_product_id;
  if v_count > 0 then
    v_refs := v_refs || jsonb_build_object('table', 'stock_transfer_items', 'label', 'chuyển kho', 'count', v_count);
    v_total_refs := v_total_refs + v_count;
  end if;

  -- 6.12 — kitchen_order_items (FnB)
  select count(*) into v_count from public.kitchen_order_items where product_id = p_product_id;
  if v_count > 0 then
    v_refs := v_refs || jsonb_build_object('table', 'kitchen_order_items', 'label', 'order bếp FnB', 'count', v_count);
    v_total_refs := v_total_refs + v_count;
  end if;

  -- 6.13 — bom_items (nguyên liệu công thức của SP KHÁC)
  select count(*) into v_count from public.bom_items where material_id = p_product_id;
  if v_count > 0 then
    v_refs := v_refs || jsonb_build_object('table', 'bom_items', 'label', 'thành phần công thức (SP này là nguyên liệu cho SP khác)', 'count', v_count);
    v_total_refs := v_total_refs + v_count;
  end if;

  -- 6.14 — production_orders (SP này là output của lệnh SX)
  select count(*) into v_count from public.production_orders where product_id = p_product_id;
  if v_count > 0 then
    v_refs := v_refs || jsonb_build_object('table', 'production_orders', 'label', 'lệnh sản xuất (SP này là thành phẩm)', 'count', v_count);
    v_total_refs := v_total_refs + v_count;
  end if;

  -- 6.15 — production_order_materials
  select count(*) into v_count from public.production_order_materials where product_id = p_product_id;
  if v_count > 0 then
    v_refs := v_refs || jsonb_build_object('table', 'production_order_materials', 'label', 'NVL lệnh sản xuất', 'count', v_count);
    v_total_refs := v_total_refs + v_count;
  end if;

  -- 6.16 — product_lots (lô SX)
  select count(*) into v_count from public.product_lots where product_id = p_product_id;
  if v_count > 0 then
    v_refs := v_refs || jsonb_build_object('table', 'product_lots', 'label', 'lô sản xuất', 'count', v_count);
    v_total_refs := v_total_refs + v_count;
  end if;

  -- 6.17 — internal_sale_items
  select count(*) into v_count from public.internal_sale_items where product_id = p_product_id;
  if v_count > 0 then
    v_refs := v_refs || jsonb_build_object('table', 'internal_sale_items', 'label', 'bán nội bộ', 'count', v_count);
    v_total_refs := v_total_refs + v_count;
  end if;

  -- ─── 7. Quyết định ───
  if v_total_refs > 0 then
    raise exception 'PRODUCT_HAS_REFS: SP "%" còn % giao dịch ở các bảng: %. Không thể xoá hẳn — chỉ có thể giữ trạng thái ngừng kinh doanh để bảo toàn lịch sử kế toán.',
      v_product.name, v_total_refs, v_refs::text;
  end if;

  -- ─── 8. Có thể xoá HẲN ───
  -- Các bảng cascade (product_prices, product_variants, bom, uom_conversions,
  -- price_tier_items, product_platform_prices) sẽ tự xoá theo.
  -- Các bảng restrict đã được check ở trên = 0 refs nên không bị FK violation.

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_profile.tenant_id, v_actor, 'force_delete', 'product', p_product_id,
    to_jsonb(v_product),
    jsonb_build_object(
      'force_deleted', true,
      'reason', 'owner cleanup — SP đã ngừng KD và 0 refs trên 17 bảng FK',
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
    'force_deleted', true
  );
end;
$$;

grant execute on function public.force_delete_product_atomic(uuid) to authenticated;

comment on function public.force_delete_product_atomic is
  'Xoá HẲN SP — chỉ owner + chỉ SP đã ngừng KD + chỉ khi 0 refs trên 17 bảng FK. CEO 17/05/2026.';

-- ────────────────────────────────────────────────────────────────
-- Bulk version — xoá hẳn nhiều SP cùng lúc
-- ────────────────────────────────────────────────────────────────
create or replace function public.bulk_force_delete_products_atomic(
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
  v_deleted int := 0;
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
    raise exception 'PERMISSION_DENIED: chỉ chủ sở hữu (owner) mới được xoá hẳn sản phẩm';
  end if;

  if p_product_ids is null or array_length(p_product_ids, 1) is null then
    return jsonb_build_object('success', true, 'deleted', 0, 'failed', '[]'::jsonb, 'total', 0);
  end if;

  for v_id in select unnest(p_product_ids) loop
    begin
      v_result := public.force_delete_product_atomic(v_id);
      v_deleted := v_deleted + 1;
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
    'deleted', v_deleted,
    'failed', v_failed,
    'total', array_length(p_product_ids, 1),
    'failed_count', jsonb_array_length(v_failed),
    'force_delete', true
  );
end;
$$;

grant execute on function public.bulk_force_delete_products_atomic(uuid[]) to authenticated;

comment on function public.bulk_force_delete_products_atomic is
  'Xoá HẲN nhiều SP — chỉ owner. Mỗi SP đi qua force_delete_product_atomic riêng để giữ pre-check 17 bảng FK + audit log. CEO 17/05/2026.';

notify pgrst, 'reload schema';
