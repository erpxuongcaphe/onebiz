-- ============================================================
-- 00062: OTP-delegated actions (Phase 3a — CEO 12/05/2026)
--
-- Mở rộng 3 RPC nhạy cảm để chấp nhận `p_otp_id` (optional). Khi cashier
-- không có permission đủ:
--   1. Cashier bấm action → mở OtpApprovalDialog
--   2. Manager cấp OTP qua /manager/otp → đọc qua điện thoại
--   3. Cashier nhập OTP → verify_and_use_manager_otp() mark used
--   4. Service call RPC kèm p_otp_id (id của row vừa verify)
--   5. RPC dùng helper verify_otp_authorization() để xác nhận OTP hợp lệ
--      → check permission của OTP issuer thay vì cashier
--   6. Audit log ghi cả cashier (user_id) và OTP issuer (new_data.approved_by)
--
-- Có 3 RPC update trong migration này:
--   - fnb_cancel_unpaid_order_atomic  (00059)
--   - delete_product_atomic           (00060)
--   - delete_customer_atomic          (00060)
--
-- Phase 3b sẽ thêm RPC mới cho void_paid_bill, edit_sent_order,
-- discount_override (chưa có flow đầy đủ ở 00055).
-- ============================================================

-- 1. Helper: verify OTP đã used + match action + dùng cùng cashier
-- trong vòng 60s qua (chống replay). Trả về user_id của manager đã issue
-- OTP (để dùng làm "approver" cho permission check).
create or replace function public.verify_otp_authorization(
  p_otp_id uuid,
  p_expected_action text,
  p_actor uuid
) returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_otp record;
begin
  if p_otp_id is null then
    raise exception 'OTP_ID_REQUIRED';
  end if;

  select id, tenant_id, action_code, issued_by, used_at, used_by
  into v_otp
  from public.manager_otp_codes
  where id = p_otp_id;

  if not found then
    raise exception 'OTP_NOT_FOUND: %', p_otp_id;
  end if;

  if v_otp.used_at is null then
    raise exception 'OTP_NOT_VERIFIED: must call verify_and_use_manager_otp first';
  end if;

  if v_otp.action_code <> p_expected_action then
    raise exception 'OTP_ACTION_MISMATCH: expected %, got %',
      p_expected_action, v_otp.action_code;
  end if;

  if v_otp.used_by <> p_actor then
    raise exception 'OTP_USER_MISMATCH: OTP đã dùng bởi user khác';
  end if;

  -- Chống replay sau khi OTP used: chỉ valid trong 60s sau khi used
  if v_otp.used_at < now() - interval '60 seconds' then
    raise exception 'OTP_EXPIRED_AFTER_USE: OTP đã hết hạn (>60s sau khi verify)';
  end if;

  return v_otp.issued_by;
end;
$$;

comment on function public.verify_otp_authorization is
  'Helper cho action RPC: verify OTP đã used + match action + dùng đúng cashier. Return user_id của manager để check perm.';

grant execute on function public.verify_otp_authorization(uuid, text, uuid) to authenticated;

-- ============================================================
-- 2. Re-create fnb_cancel_unpaid_order_atomic với p_otp_id support
-- ============================================================
-- Drop old signature trước để tránh duplicate function (PostgreSQL phân biệt
-- function theo arg list).
drop function if exists public.fnb_cancel_unpaid_order_atomic(uuid, text, text, uuid);

create or replace function public.fnb_cancel_unpaid_order_atomic(
  p_order_id uuid,
  p_reason_code text,
  p_reason_note text default null,
  p_shift_id uuid default null,
  p_otp_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_profile record;
  v_order record;
  v_items_snapshot jsonb := '[]'::jsonb;
  v_amount numeric := 0;
  v_note text;
  v_approver uuid;  -- ai duyệt: actor nếu có quyền, OTP issuer nếu OTP delegated
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED: please sign in before cancelling an FnB order';
  end if;

  select id, tenant_id, branch_id, role
  into v_profile
  from public.profiles
  where id = v_actor
    and is_active = true;

  if not found then
    raise exception 'USER_PROFILE_NOT_FOUND: %', v_actor;
  end if;

  -- Permission resolution: nếu có OTP → check permission của OTP issuer
  -- thay vì actor (cashier). Nếu không → check actor như cũ.
  if p_otp_id is not null then
    v_approver := public.verify_otp_authorization(
      p_otp_id, 'fnb.cancel_unpaid_bill', v_actor
    );
  else
    v_approver := v_actor;
  end if;

  if not (
    public.user_has_permission(v_approver, 'pos_fnb.cancel_unpaid_order')
    or public.user_has_permission(v_approver, 'pos_fnb.void')
  ) then
    raise exception 'PERMISSION_DENIED: cancelling a sent FnB order requires manager permission';
  end if;

  if nullif(trim(coalesce(p_reason_code, '')), '') is null then
    raise exception 'CANCEL_REASON_REQUIRED';
  end if;

  select id, tenant_id, branch_id, invoice_id, table_id, order_number, status, note
  into v_order
  from public.kitchen_orders
  where id = p_order_id
    and tenant_id = v_profile.tenant_id
  for update;

  if not found then
    raise exception 'KITCHEN_ORDER_NOT_FOUND: %', p_order_id;
  end if;

  if v_order.invoice_id is not null or v_order.status = 'completed' then
    raise exception 'ORDER_ALREADY_PAID: use paid invoice void/refund flow instead';
  end if;

  if v_order.status = 'cancelled' then
    raise exception 'ORDER_ALREADY_CANCELLED: %', v_order.order_number;
  end if;

  if p_shift_id is not null and not exists (
    select 1
    from public.shifts
    where id = p_shift_id
      and tenant_id = v_order.tenant_id
      and branch_id = v_order.branch_id
      and status = 'open'
  ) then
    raise exception 'SHIFT_NOT_OPEN_FOR_ORDER_BRANCH: %', p_shift_id;
  end if;

  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'item_id', id,
          'product_id', product_id,
          'product_name', product_name,
          'variant_id', variant_id,
          'variant_label', variant_label,
          'quantity', quantity,
          'unit_price', unit_price,
          'note', note,
          'toppings', coalesce(toppings, '[]'::jsonb),
          'status', status
        )
        order by id
      ),
      '[]'::jsonb
    ),
    coalesce(sum(quantity * unit_price), 0)
  into v_items_snapshot, v_amount
  from public.kitchen_order_items
  where kitchen_order_id = p_order_id;

  v_note := trim(
    both from concat_ws(
      ' ',
      nullif(v_order.note, ''),
      '[Hủy: ' || trim(p_reason_code) ||
        case
          when nullif(trim(coalesce(p_reason_note, '')), '') is not null
            then ' - ' || trim(p_reason_note)
          else ''
        end ||
      ']'
    )
  );

  update public.kitchen_orders
  set status = 'cancelled',
      cancel_reason_code = trim(p_reason_code),
      cancel_reason = nullif(trim(coalesce(p_reason_note, '')), ''),
      cancelled_at = now(),
      cancelled_by = v_actor,
      cancel_approved_by = v_approver,  -- nếu OTP delegated, ghi manager đã duyệt
      note = nullif(v_note, ''),
      updated_at = now()
  where id = v_order.id
    and tenant_id = v_order.tenant_id;

  if v_order.table_id is not null then
    update public.restaurant_tables
    set status = 'available',
        current_order_id = null,
        updated_at = now()
    where tenant_id = v_order.tenant_id
      and id = v_order.table_id
      and current_order_id = v_order.id;
  end if;

  insert into public.pos_exception_events (
    tenant_id, branch_id, shift_id, source, event_type,
    target_type, target_id, kitchen_order_id, amount,
    reason_code, reason_note, items_snapshot, metadata,
    requested_by, approved_by
  ) values (
    v_order.tenant_id, v_order.branch_id, p_shift_id, 'fnb', 'unpaid_order_cancel',
    'kitchen_order', v_order.id, v_order.id, v_amount,
    trim(p_reason_code), nullif(trim(coalesce(p_reason_note, '')), ''),
    v_items_snapshot,
    jsonb_build_object(
      'order_number', v_order.order_number,
      'previous_status', v_order.status,
      'table_id', v_order.table_id,
      'otp_id', p_otp_id,
      'delegated', (p_otp_id is not null)
    ),
    v_actor, v_approver
  );

  return jsonb_build_object(
    'success', true,
    'kitchen_order_id', v_order.id,
    'order_number', v_order.order_number,
    'event_type', 'unpaid_order_cancel',
    'approved_by', v_approver,
    'delegated', (p_otp_id is not null)
  );
end;
$$;

comment on function public.fnb_cancel_unpaid_order_atomic is
  'Atomic FnB unpaid-order cancel. Permission check trên actor hoặc OTP issuer nếu p_otp_id provided. Audit log lưu cả 2.';

grant execute on function public.fnb_cancel_unpaid_order_atomic(uuid, text, text, uuid, uuid) to authenticated;

-- ============================================================
-- 3. Re-create delete_product_atomic với p_otp_id support
-- ============================================================
drop function if exists public.delete_product_atomic(uuid);

create or replace function public.delete_product_atomic(
  p_product_id uuid,
  p_otp_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_profile record;
  v_product record;
  v_approver uuid;
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

  if p_otp_id is not null then
    v_approver := public.verify_otp_authorization(
      p_otp_id, 'crm.delete_party', v_actor
    );
  else
    v_approver := v_actor;
  end if;

  if not public.user_has_permission(v_approver, 'products.delete') then
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
  where id = p_product_id
    and tenant_id = v_profile.tenant_id;

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

comment on function public.delete_product_atomic is
  'Atomic product delete. Permission check trên actor hoặc OTP issuer. Audit log new_data ghi approved_by + otp_id.';

grant execute on function public.delete_product_atomic(uuid, uuid) to authenticated;

-- ============================================================
-- 4. Re-create delete_customer_atomic với p_otp_id support
-- ============================================================
drop function if exists public.delete_customer_atomic(uuid);

create or replace function public.delete_customer_atomic(
  p_customer_id uuid,
  p_otp_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_profile record;
  v_customer record;
  v_approver uuid;
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

  if p_otp_id is not null then
    v_approver := public.verify_otp_authorization(
      p_otp_id, 'crm.delete_party', v_actor
    );
  else
    v_approver := v_actor;
  end if;

  if not public.user_has_permission(v_approver, 'customers.delete') then
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
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_profile.tenant_id, v_actor, 'delete', 'customer', p_customer_id,
    to_jsonb(v_customer),
    jsonb_build_object(
      'approved_by', v_approver,
      'otp_id', p_otp_id,
      'delegated', (p_otp_id is not null)
    )
  );

  delete from public.customers
  where id = p_customer_id
    and tenant_id = v_profile.tenant_id;

  return jsonb_build_object(
    'success', true,
    'customer_id', p_customer_id,
    'customer_code', v_customer.code,
    'customer_name', v_customer.name,
    'approved_by', v_approver,
    'delegated', (p_otp_id is not null)
  );
end;
$$;

comment on function public.delete_customer_atomic is
  'Atomic customer delete. Permission check trên actor hoặc OTP issuer. Audit log new_data ghi approved_by + otp_id.';

grant execute on function public.delete_customer_atomic(uuid, uuid) to authenticated;
