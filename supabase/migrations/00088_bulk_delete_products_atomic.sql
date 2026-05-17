-- ============================================================
-- 00088: bulk_delete_products_atomic — pre-check FK trước khi xoá (CEO 17/05/2026)
--
-- VẤN ĐỀ phát hiện chiều 17/05:
--   bulkDeleteProducts gọi thẳng `DELETE FROM products WHERE id IN (...)` →
--   khi SP có rows trong stock_movements / invoice_items / purchase_order_items
--   → vi phạm FK (code 23503) → toàn batch fail, kể cả SP không có ràng buộc.
--
-- FIX (theo chuẩn delete_supplier_atomic 00084):
--   - Loop từng SP
--   - Pre-check 7 bảng có FK tới products (default NO ACTION hoặc RESTRICT)
--   - SP có ràng buộc → push vào `failed` với lý do user-friendly
--   - SP không ràng buộc → delete (cascade tự xoá branch_stock, uom_conv,
--     product_prices, product_variants — đây là on delete cascade)
--   - Audit log mỗi delete
--   - Cross-tenant guard (dùng _current_caller_tenant từ 00084)
--
-- KHÔNG ảnh hưởng data: chỉ DELETE SP đã pass pre-check, các SP có rằng buộc
-- giữ nguyên. Không cascade qua stock_movements / invoice_items.
-- ============================================================

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
  v_caller_tenant uuid := public._current_caller_tenant();
  v_product record;
  v_id uuid;
  v_count int;
  v_deleted int := 0;
  v_failed jsonb := '[]'::jsonb;
  v_reasons text[];
begin
  if v_caller_tenant is null then
    raise exception 'UNAUTHORIZED: không xác định được tenant của người gọi.';
  end if;

  if p_product_ids is null or array_length(p_product_ids, 1) is null then
    return jsonb_build_object(
      'success', true,
      'deleted', 0,
      'failed', '[]'::jsonb,
      'total', 0
    );
  end if;

  for v_id in select unnest(p_product_ids) loop
    -- Lock + verify tenant
    select id, code, name, tenant_id into v_product
    from public.products
    where id = v_id and tenant_id = v_caller_tenant
    for update;

    if not found then
      v_failed := v_failed || jsonb_build_object(
        'product_id', v_id,
        'reason', 'Không tìm thấy SP (có thể đã bị xoá) hoặc không thuộc chi nhánh/cửa hàng của bạn'
      );
      continue;
    end if;

    v_reasons := ARRAY[]::text[];

    -- 1. stock_movements (NO ACTION) — bảng gây lỗi anh CEO thấy
    select count(*) into v_count from public.stock_movements where product_id = v_id;
    if v_count > 0 then
      v_reasons := v_reasons || ('có ' || v_count || ' lịch sử nhập/xuất kho');
    end if;

    -- 2. invoice_items (NO ACTION)
    select count(*) into v_count from public.invoice_items where product_id = v_id;
    if v_count > 0 then
      v_reasons := v_reasons || ('có ' || v_count || ' dòng trong hoá đơn bán');
    end if;

    -- 3. purchase_order_items (NO ACTION)
    select count(*) into v_count from public.purchase_order_items where product_id = v_id;
    if v_count > 0 then
      v_reasons := v_reasons || ('có ' || v_count || ' dòng trong đơn nhập');
    end if;

    -- 4. kitchen_order_items (NO ACTION) — FnB
    select count(*) into v_count from public.kitchen_order_items where product_id = v_id;
    if v_count > 0 then
      v_reasons := v_reasons || ('có ' || v_count || ' dòng trong phiếu bếp F&B');
    end if;

    -- 5. inventory_check_items (NO ACTION)
    select count(*) into v_count from public.inventory_check_items where product_id = v_id;
    if v_count > 0 then
      v_reasons := v_reasons || ('có ' || v_count || ' dòng trong phiếu kiểm kê');
    end if;

    -- 6. return_items (NO ACTION) — trả hàng
    select count(*) into v_count from public.return_items where product_id = v_id;
    if v_count > 0 then
      v_reasons := v_reasons || ('có ' || v_count || ' dòng trong phiếu trả hàng');
    end if;

    -- 7. product_lots (RESTRICT)
    select count(*) into v_count from public.product_lots where product_id = v_id;
    if v_count > 0 then
      v_reasons := v_reasons || ('có ' || v_count || ' lô sản xuất/nhập');
    end if;

    -- 8. bom_items material_id (RESTRICT) — là NVL của công thức
    select count(*) into v_count from public.bom_items where material_id = v_id;
    if v_count > 0 then
      v_reasons := v_reasons || ('đang là NVL của ' || v_count || ' công thức');
    end if;

    -- 9. production_orders (RESTRICT)
    select count(*) into v_count from public.production_orders where product_id = v_id;
    if v_count > 0 then
      v_reasons := v_reasons || ('có ' || v_count || ' lệnh sản xuất');
    end if;

    -- 10. production_order_materials (RESTRICT)
    select count(*) into v_count from public.production_order_materials where product_id = v_id;
    if v_count > 0 then
      v_reasons := v_reasons || ('là NVL trong ' || v_count || ' lệnh SX');
    end if;

    if array_length(v_reasons, 1) > 0 then
      v_failed := v_failed || jsonb_build_object(
        'product_id', v_id,
        'product_code', v_product.code,
        'product_name', v_product.name,
        'reason', array_to_string(v_reasons, ', ')
      );
      continue;
    end if;

    -- Pass tất cả check → audit + delete
    insert into public.audit_log (
      tenant_id, user_id, action, entity_type, entity_id, old_data
    ) values (
      v_caller_tenant, v_actor, 'delete', 'product', v_id,
      jsonb_build_object(
        'code', v_product.code,
        'name', v_product.name,
        'deleted_at', now()
      )
    );

    -- Cascade tự xoá: branch_stock, product_prices, product_variants,
    -- uom_conversions, platform_prices (đều on delete cascade)
    delete from public.products where id = v_id and tenant_id = v_caller_tenant;
    v_deleted := v_deleted + 1;
  end loop;

  return jsonb_build_object(
    'success', true,
    'deleted', v_deleted,
    'failed', v_failed,
    'total', array_length(p_product_ids, 1),
    'failed_count', jsonb_array_length(v_failed)
  );
end;
$$;

comment on function public.bulk_delete_products_atomic is
  'Xoá nhiều SP ATOMIC: pre-check 10 bảng FK + audit log + cascade chỉ qua tables on delete cascade (branch_stock, product_prices, variants, uom, platform_prices). SP có lịch sử nhập/xuất/bán → reject với lý do user-friendly. CEO 17/05/2026.';

grant execute on function public.bulk_delete_products_atomic(uuid[], uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────
-- 2. delete_product_atomic — add FK pre-check (1-product delete)
--
-- Đồng bộ pattern với bulk: pre-check 10 bảng FK. Nếu SP có ràng buộc →
-- raise exception 'PRODUCT_HAS_REFERENCES' kèm danh sách lý do.
-- Giữ nguyên flow OTP + permission verify (00066).
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
  v_count int;
  v_reasons text[];
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED: please sign in before deleting a product';
  end if;

  select id, tenant_id, role into v_profile
  from public.profiles where id = v_actor and is_active = true;

  if not found then
    raise exception 'USER_PROFILE_NOT_FOUND: %', v_actor;
  end if;

  -- OTP verify (00066 pattern)
  if p_otp_id is not null then
    v_approver := public.verify_otp_authorization(
      p_otp_id, 'products.delete', v_actor, p_product_id
    );
  else
    v_approver := v_actor;
  end if;

  if not public.user_has_permission(v_approver, 'products.delete') then
    raise exception 'PERMISSION_DENIED: cần quyền products.delete để xoá sản phẩm';
  end if;

  select * into v_product
  from public.products
  where id = p_product_id and tenant_id = v_profile.tenant_id
  for update;

  if not found then
    raise exception 'PRODUCT_NOT_FOUND: %', p_product_id;
  end if;

  -- Day 17/05/2026: pre-check FK (đồng bộ với bulk_delete_products_atomic)
  v_reasons := ARRAY[]::text[];

  select count(*) into v_count from public.stock_movements where product_id = p_product_id;
  if v_count > 0 then v_reasons := v_reasons || ('có ' || v_count || ' lịch sử nhập/xuất kho'); end if;

  select count(*) into v_count from public.invoice_items where product_id = p_product_id;
  if v_count > 0 then v_reasons := v_reasons || ('có ' || v_count || ' dòng trong hoá đơn bán'); end if;

  select count(*) into v_count from public.purchase_order_items where product_id = p_product_id;
  if v_count > 0 then v_reasons := v_reasons || ('có ' || v_count || ' dòng trong đơn nhập'); end if;

  select count(*) into v_count from public.kitchen_order_items where product_id = p_product_id;
  if v_count > 0 then v_reasons := v_reasons || ('có ' || v_count || ' dòng trong phiếu bếp F&B'); end if;

  select count(*) into v_count from public.inventory_check_items where product_id = p_product_id;
  if v_count > 0 then v_reasons := v_reasons || ('có ' || v_count || ' dòng trong phiếu kiểm kê'); end if;

  select count(*) into v_count from public.return_items where product_id = p_product_id;
  if v_count > 0 then v_reasons := v_reasons || ('có ' || v_count || ' dòng trong phiếu trả hàng'); end if;

  select count(*) into v_count from public.product_lots where product_id = p_product_id;
  if v_count > 0 then v_reasons := v_reasons || ('có ' || v_count || ' lô sản xuất/nhập'); end if;

  select count(*) into v_count from public.bom_items where material_id = p_product_id;
  if v_count > 0 then v_reasons := v_reasons || ('đang là NVL của ' || v_count || ' công thức'); end if;

  select count(*) into v_count from public.production_orders where product_id = p_product_id;
  if v_count > 0 then v_reasons := v_reasons || ('có ' || v_count || ' lệnh sản xuất'); end if;

  select count(*) into v_count from public.production_order_materials where product_id = p_product_id;
  if v_count > 0 then v_reasons := v_reasons || ('là NVL trong ' || v_count || ' lệnh SX'); end if;

  if array_length(v_reasons, 1) > 0 then
    raise exception 'PRODUCT_HAS_REFERENCES: SP "%" không thể xoá — %', v_product.name, array_to_string(v_reasons, ', ');
  end if;

  -- Pass tất cả check → audit + delete cascade
  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_profile.tenant_id, v_actor, 'delete', 'product', p_product_id,
    to_jsonb(v_product),
    jsonb_build_object(
      'approved_by', v_approver,
      'otp_id', p_otp_id,
      'delegated', (p_otp_id is not null)
    )
  );

  delete from public.products
  where id = p_product_id and tenant_id = v_profile.tenant_id;

  return jsonb_build_object(
    'success', true,
    'product_id', p_product_id,
    'product_code', v_product.code,
    'product_name', v_product.name,
    'approved_by', v_approver,
    'delegated', (p_otp_id is not null)
  );
end;
$$;

grant execute on function public.delete_product_atomic(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
