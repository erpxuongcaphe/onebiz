-- ============================================================
-- 00091: Soft Delete cho products (CEO 17/05/2026)
--
-- LỰA CHỌN: Theo tư vấn (tuân thủ kế toán VN TT200/133 + pattern chuẩn ERP),
-- chuyển `delete_product_atomic` + `bulk_delete_products_atomic` từ HARD
-- DELETE sang SOFT DELETE: set `is_active = false` thay vì xoá hẳn.
--
-- Lợi ích:
--   - Giữ toàn bộ lịch sử kế toán (stock_movements, invoice_items, ...)
--   - Báo cáo cũ vẫn ra đúng (vẫn show tên SP đã ngừng KD)
--   - Khôi phục dễ dàng (chỉ cần set is_active=true)
--   - Tuân thủ luật kế toán VN (giữ chứng từ ≥ 10 năm)
--
-- Behavior mới:
--   - SP có tồn kho > 0 → vẫn reject (yêu cầu kiểm kê về 0 / xuất hủy trước
--     để tránh "ngừng KD" SP đang còn hàng).
--   - SP không có refs nào → set is_active=false (giống xoá hard về UX).
--   - SP có refs (movements, invoices,...) → set is_active=false. KHÔNG cần
--     pre-check FK vì không xoá thực.
--   - Audit log action 'deactivate' thay vì 'delete'.
--
-- Bonus: thêm RPC `restore_product_atomic` để bật lại SP đã ngừng KD.
-- ============================================================

-- ────────────────────────────────────────────────────────────────
-- 1. bulk_delete_products_atomic — refactor sang soft delete
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
  v_count int;
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

    -- Đã inactive trước → skip (vẫn coi là thành công về mặt user-facing)
    if v_product.is_active = false then
      v_deactivated := v_deactivated + 1;
      continue;
    end if;

    -- ─── Chỉ chặn nếu còn tồn kho thật > 0 ───
    -- Pre-cleanup branch_stock zero (init records vô nghĩa)
    delete from public.branch_stock
    where product_id = v_id
      and coalesce(quantity, 0) = 0
      and coalesce(reserved, 0) = 0;

    select count(*) into v_count from public.branch_stock where product_id = v_id;
    if v_count > 0 then
      v_failed := v_failed || jsonb_build_object(
        'product_id', v_id,
        'product_code', v_product.code,
        'product_name', v_product.name,
        'reason', 'còn ' || v_count || ' chi nhánh có tồn kho > 0 — vui lòng xuất hủy hoặc kiểm kê về 0 trước khi ngừng kinh doanh'
      );
      continue;
    end if;

    -- ─── Soft delete: set is_active=false ───
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
        'reason', 'soft delete via bulk_delete_products_atomic'
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
    'soft_delete', true
  );
end;
$$;

grant execute on function public.bulk_delete_products_atomic(uuid[], uuid) to authenticated;

comment on function public.bulk_delete_products_atomic is
  'Soft delete nhiều SP: set is_active=false thay vì xoá hẳn (CEO 17/05/2026 — tuân thủ kế toán + pattern chuẩn ERP). Reject SP có tồn kho > 0.';

-- ────────────────────────────────────────────────────────────────
-- 2. delete_product_atomic — refactor sang soft delete (1 SP)
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

  -- Đã inactive → idempotent
  if v_product.is_active = false then
    return jsonb_build_object(
      'success', true,
      'product_id', p_product_id,
      'product_code', v_product.code,
      'product_name', v_product.name,
      'already_inactive', true
    );
  end if;

  -- Cleanup branch_stock zero
  delete from public.branch_stock
  where product_id = p_product_id
    and coalesce(quantity, 0) = 0 and coalesce(reserved, 0) = 0;

  select count(*) into v_count from public.branch_stock where product_id = p_product_id;
  if v_count > 0 then
    raise exception 'PRODUCT_HAS_STOCK: SP "%" còn % chi nhánh có tồn kho > 0 — vui lòng kiểm kê về 0 hoặc xuất hủy trước', v_product.name, v_count;
  end if;

  -- Soft delete
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
      'soft_delete', true
    )
  );

  return jsonb_build_object(
    'success', true,
    'product_id', p_product_id,
    'product_code', v_product.code,
    'product_name', v_product.name,
    'approved_by', v_approver,
    'delegated', (p_otp_id is not null),
    'soft_delete', true
  );
end;
$$;

grant execute on function public.delete_product_atomic(uuid, uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────
-- 3. restore_product_atomic — Khôi phục SP đã ngừng KD
-- ────────────────────────────────────────────────────────────────
create or replace function public.restore_product_atomic(
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
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED: vui lòng đăng nhập lại';
  end if;

  select id, tenant_id into v_profile
  from public.profiles where id = v_actor and is_active = true;

  if not found then
    raise exception 'USER_PROFILE_NOT_FOUND: %', v_actor;
  end if;

  -- Cần quyền products.create hoặc products.delete để khôi phục
  if not (
    public.user_has_permission(v_actor, 'products.delete')
    or public.user_has_permission(v_actor, 'products.create')
  ) then
    raise exception 'PERMISSION_DENIED: cần quyền products.delete hoặc products.create để khôi phục SP';
  end if;

  select id, code, name, is_active into v_product
  from public.products
  where id = p_product_id and tenant_id = v_profile.tenant_id
  for update;

  if not found then
    raise exception 'PRODUCT_NOT_FOUND: %', p_product_id;
  end if;

  if v_product.is_active = true then
    return jsonb_build_object(
      'success', true,
      'product_id', p_product_id,
      'already_active', true
    );
  end if;

  update public.products
  set is_active = true, updated_at = now()
  where id = p_product_id and tenant_id = v_profile.tenant_id;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_profile.tenant_id, v_actor, 'restore', 'product', p_product_id,
    jsonb_build_object(
      'code', v_product.code,
      'name', v_product.name,
      'restored_at', now()
    )
  );

  return jsonb_build_object(
    'success', true,
    'product_id', p_product_id,
    'product_code', v_product.code,
    'product_name', v_product.name,
    'restored', true
  );
end;
$$;

grant execute on function public.restore_product_atomic(uuid) to authenticated;

comment on function public.restore_product_atomic is
  'Khôi phục SP đã ngừng KD: set is_active=true. CEO 17/05/2026.';

notify pgrst, 'reload schema';
