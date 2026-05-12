-- ============================================================
-- 00060: Secure delete RPCs cho sản phẩm + khách hàng
--
-- CEO 12/05/2026: 2 CRITICAL bug — cashier hiện vẫn xoá được SP/KH
-- vì service direct DB delete, không check permission.
--
-- Fix: wrap qua SECURITY DEFINER RPC giống pattern
-- fnb_cancel_unpaid_order_atomic (00059):
--   - Check auth.uid()
--   - Check profile active + tenant scope
--   - Check user_has_permission(actor, 'products.delete' / 'customers.delete')
--   - Audit log snapshot trước khi delete
--   - Delete atomic
--
-- 4 lớp defense (UI gate + handler check + service RPC + DB RPC enforce)
-- — defense-in-depth giống commit 5b86878.
-- ============================================================

-- 1. Xoá sản phẩm — atomic + permission check
create or replace function public.delete_product_atomic(
  p_product_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_profile record;
  v_product record;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED: please sign in before deleting a product';
  end if;

  select id, tenant_id, role
  into v_profile
  from public.profiles
  where id = v_actor
    and is_active = true;

  if not found then
    raise exception 'USER_PROFILE_NOT_FOUND: %', v_actor;
  end if;

  if not public.user_has_permission(v_actor, 'products.delete') then
    raise exception 'PERMISSION_DENIED: cần quyền products.delete để xoá sản phẩm';
  end if;

  select *
  into v_product
  from public.products
  where id = p_product_id
    and tenant_id = v_profile.tenant_id
  for update;

  if not found then
    raise exception 'PRODUCT_NOT_FOUND: %', p_product_id;
  end if;

  -- Audit log snapshot trước khi xoá để CEO có thể trace "ai xoá SP nào,
  -- có gì trong đó" sau này.
  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data
  ) values (
    v_profile.tenant_id, v_actor, 'delete', 'product', p_product_id,
    to_jsonb(v_product)
  );

  delete from public.products
  where id = p_product_id
    and tenant_id = v_profile.tenant_id;

  return jsonb_build_object(
    'success', true,
    'product_id', p_product_id,
    'product_code', v_product.code,
    'product_name', v_product.name
  );
end;
$$;

comment on function public.delete_product_atomic is
  'Atomic secure product delete: permission gate (products.delete) + audit log snapshot + delete.';

-- 2. Xoá khách hàng — atomic + permission check
create or replace function public.delete_customer_atomic(
  p_customer_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_profile record;
  v_customer record;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED: please sign in before deleting a customer';
  end if;

  select id, tenant_id, role
  into v_profile
  from public.profiles
  where id = v_actor
    and is_active = true;

  if not found then
    raise exception 'USER_PROFILE_NOT_FOUND: %', v_actor;
  end if;

  if not public.user_has_permission(v_actor, 'customers.delete') then
    raise exception 'PERMISSION_DENIED: cần quyền customers.delete để xoá khách hàng';
  end if;

  select id, tenant_id, code, name, phone, email, group_id, customer_type, debt, total_spent
  into v_customer
  from public.customers
  where id = p_customer_id
    and tenant_id = v_profile.tenant_id
  for update;

  if not found then
    raise exception 'CUSTOMER_NOT_FOUND: %', p_customer_id;
  end if;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data
  ) values (
    v_profile.tenant_id, v_actor, 'delete', 'customer', p_customer_id,
    to_jsonb(v_customer)
  );

  delete from public.customers
  where id = p_customer_id
    and tenant_id = v_profile.tenant_id;

  return jsonb_build_object(
    'success', true,
    'customer_id', p_customer_id,
    'customer_code', v_customer.code,
    'customer_name', v_customer.name
  );
end;
$$;

comment on function public.delete_customer_atomic is
  'Atomic secure customer delete: permission gate (customers.delete) + audit log snapshot + delete.';

-- 3. Grants
grant execute on function public.delete_product_atomic(uuid) to authenticated;
grant execute on function public.delete_customer_atomic(uuid) to authenticated;
