-- ============================================================
-- 00090: bulk_delete_products_atomic v2 — try DELETE + catch FK (CEO 17/05/2026)
--
-- VẤN ĐỀ phát hiện sau khi anh CEO chạy 00088:
--   - Migration 00088 chỉ pre-check 10 bảng FK em "đoán" có vấn đề
--   - Thực tế DB còn các bảng khác (vd `branch_stock`) không cascade
--   - SP có 1 row branch_stock (dù quantity=0) → vẫn vi phạm FK → fail
--
-- FIX (pattern tốt hơn):
--   1. Pre-cleanup branch_stock với quantity=0 + reserved=0 (init records vô nghĩa)
--   2. Pre-check 4 bảng business-logic quan trọng (stock_movements, invoice_items,
--      purchase_order_items, kitchen_order_items) — phục vụ UX message
--   3. Try DELETE → nếu vi phạm FK khác → catch exception, parse SQLERRM,
--      trả failed với reason rõ ràng cho user
--
-- Lợi ích: KHÔNG phụ thuộc liệt kê tất cả 16+ bảng FK. Hệ thống tự catch
-- mọi vi phạm và báo cụ thể. CEO không phải đoán nguyên nhân.
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
  v_caller_tenant uuid;
  v_product record;
  v_id uuid;
  v_count int;
  v_deleted int := 0;
  v_failed jsonb := '[]'::jsonb;
  v_reasons text[];
  v_fk_error text;
  v_friendly_reason text;
begin
  -- Resolve tenant: ưu tiên p_actor_id → fallback auth.uid()
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
    select id, code, name, tenant_id into v_product
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

    -- ─── Bước 1: Pre-check business-logic critical (4 bảng) ───
    v_reasons := ARRAY[]::text[];

    select count(*) into v_count from public.stock_movements where product_id = v_id;
    if v_count > 0 then
      v_reasons := v_reasons || ('có ' || v_count || ' lịch sử nhập/xuất kho');
    end if;

    select count(*) into v_count from public.invoice_items where product_id = v_id;
    if v_count > 0 then
      v_reasons := v_reasons || ('có ' || v_count || ' dòng trong hoá đơn bán');
    end if;

    select count(*) into v_count from public.purchase_order_items where product_id = v_id;
    if v_count > 0 then
      v_reasons := v_reasons || ('có ' || v_count || ' dòng trong đơn nhập');
    end if;

    select count(*) into v_count from public.kitchen_order_items where product_id = v_id;
    if v_count > 0 then
      v_reasons := v_reasons || ('có ' || v_count || ' dòng trong phiếu bếp F&B');
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

    -- ─── Bước 2: Pre-cleanup branch_stock với quantity=0 (init zero records) ───
    -- Đây là rows được tạo khi SP được khởi tạo ở chi nhánh mà chưa có giao
    -- dịch nào → giữ lại không có ý nghĩa, xoá an toàn.
    delete from public.branch_stock
    where product_id = v_id
      and coalesce(quantity, 0) = 0
      and coalesce(reserved, 0) = 0;

    -- Nếu vẫn còn branch_stock với quantity > 0 → SP đang có tồn thật, reject
    select count(*) into v_count from public.branch_stock where product_id = v_id;
    if v_count > 0 then
      v_failed := v_failed || jsonb_build_object(
        'product_id', v_id,
        'product_code', v_product.code,
        'product_name', v_product.name,
        'reason', 'còn ' || v_count || ' chi nhánh có tồn kho > 0 — vui lòng xuất hủy hoặc kiểm kê về 0 trước'
      );
      continue;
    end if;

    -- ─── Bước 3: Try DELETE + catch FK violation cho bảng em chưa biết ───
    begin
      insert into public.audit_log (
        tenant_id, user_id, action, entity_type, entity_id, old_data
      ) values (
        v_caller_tenant, v_actor, 'delete', 'product', v_id,
        jsonb_build_object(
          'code', v_product.code, 'name', v_product.name,
          'deleted_at', now()
        )
      );

      delete from public.products where id = v_id and tenant_id = v_caller_tenant;
      v_deleted := v_deleted + 1;
    exception
      when foreign_key_violation then
        -- Bảng nào đó còn ref SP này — parse SQLERRM để user biết
        v_fk_error := sqlerrm;
        -- Trích tên bảng từ message: 'violates ... on table "branch_stock"'
        v_friendly_reason := case
          when v_fk_error like '%inventory_check_items%' then 'còn dòng trong phiếu kiểm kê'
          when v_fk_error like '%return_items%' then 'còn dòng trong phiếu trả hàng'
          when v_fk_error like '%product_lots%' then 'còn lô sản xuất/nhập'
          when v_fk_error like '%bom_items%' then 'đang là NVL của công thức'
          when v_fk_error like '%production_orders%' then 'có lệnh sản xuất'
          when v_fk_error like '%production_order_materials%' then 'là NVL trong lệnh SX'
          when v_fk_error like '%branch_stock%' then 'còn record tồn kho chi nhánh'
          when v_fk_error like '%product_variants%' then 'có biến thể (variant)'
          when v_fk_error like '%product_prices%' then 'có bảng giá đã set'
          else 'đang được tham chiếu trong hệ thống (' || split_part(v_fk_error, '"', 2) || ')'
        end;

        v_failed := v_failed || jsonb_build_object(
          'product_id', v_id,
          'product_code', v_product.code,
          'product_name', v_product.name,
          'reason', v_friendly_reason
        );
    end;
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

grant execute on function public.bulk_delete_products_atomic(uuid[], uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────
-- Đồng bộ pattern cho delete_product_atomic (1 SP) — cùng auto cleanup
-- branch_stock zero + try-catch FK
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
  v_fk_error text;
  v_friendly_reason text;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED: vui lòng đăng nhập trước khi xoá sản phẩm';
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
    raise exception 'PERMISSION_DENIED: cần quyền products.delete để xoá sản phẩm';
  end if;

  select * into v_product
  from public.products
  where id = p_product_id and tenant_id = v_profile.tenant_id
  for update;

  if not found then
    raise exception 'PRODUCT_NOT_FOUND: %', p_product_id;
  end if;

  -- Pre-check business critical
  v_reasons := ARRAY[]::text[];
  select count(*) into v_count from public.stock_movements where product_id = p_product_id;
  if v_count > 0 then v_reasons := v_reasons || ('có ' || v_count || ' lịch sử nhập/xuất kho'); end if;
  select count(*) into v_count from public.invoice_items where product_id = p_product_id;
  if v_count > 0 then v_reasons := v_reasons || ('có ' || v_count || ' dòng trong hoá đơn bán'); end if;
  select count(*) into v_count from public.purchase_order_items where product_id = p_product_id;
  if v_count > 0 then v_reasons := v_reasons || ('có ' || v_count || ' dòng trong đơn nhập'); end if;
  select count(*) into v_count from public.kitchen_order_items where product_id = p_product_id;
  if v_count > 0 then v_reasons := v_reasons || ('có ' || v_count || ' dòng trong phiếu bếp F&B'); end if;

  if array_length(v_reasons, 1) > 0 then
    raise exception 'PRODUCT_HAS_REFERENCES: SP "%" không thể xoá — %', v_product.name, array_to_string(v_reasons, ', ');
  end if;

  -- Cleanup branch_stock zero
  delete from public.branch_stock
  where product_id = p_product_id
    and coalesce(quantity, 0) = 0 and coalesce(reserved, 0) = 0;

  select count(*) into v_count from public.branch_stock where product_id = p_product_id;
  if v_count > 0 then
    raise exception 'PRODUCT_HAS_STOCK: SP "%" còn % chi nhánh có tồn kho > 0', v_product.name, v_count;
  end if;

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

  begin
    delete from public.products
    where id = p_product_id and tenant_id = v_profile.tenant_id;
  exception when foreign_key_violation then
    v_fk_error := sqlerrm;
    v_friendly_reason := case
      when v_fk_error like '%inventory_check_items%' then 'còn dòng trong phiếu kiểm kê'
      when v_fk_error like '%return_items%' then 'còn dòng trong phiếu trả hàng'
      when v_fk_error like '%product_lots%' then 'còn lô sản xuất/nhập'
      when v_fk_error like '%bom_items%' then 'đang là NVL của công thức'
      when v_fk_error like '%production_orders%' then 'có lệnh sản xuất'
      when v_fk_error like '%production_order_materials%' then 'là NVL trong lệnh SX'
      else 'đang được tham chiếu (' || split_part(v_fk_error, '"', 2) || ')'
    end;
    raise exception 'PRODUCT_HAS_REFERENCES: SP "%" không thể xoá — %', v_product.name, v_friendly_reason;
  end;

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
