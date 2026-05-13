-- ============================================================
-- 00066: OTP target_id binding strict
--
-- CEO 12/05/2026 audit phát hiện:
--   verify_otp_authorization (00062) KHÔNG check OTP đã issue cho target
--   nào. Manager cấp OTP cho bill A → cashier nhập OTP với p_order_id=B
--   → RPC pass nếu B cùng tenant + same action_code.
--
--   → Collusion attack: cashier rủ manager cấp OTP "hủy bill nhỏ" rồi
--   dùng OTP đó hủy bill khác giá trị cao hơn.
--
-- Fix: thêm param p_expected_target_id (optional). Nếu caller pass +
-- target_meta lưu entity_id → strict compare. Backward compat: OTP cũ
-- không có entity_id trong meta vẫn pass (vì target null → skip check).
-- ============================================================

-- ────────────────────────────────────────────────────────────────
-- 1. Re-create verify_otp_authorization với param thứ 4 optional
-- ────────────────────────────────────────────────────────────────
drop function if exists public.verify_otp_authorization(uuid, text, uuid);

create or replace function public.verify_otp_authorization(
  p_otp_id uuid,
  p_expected_action text,
  p_actor uuid,
  p_expected_target_id uuid default null
) returns uuid
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_otp record;
  v_stored_target uuid;
begin
  if p_otp_id is null then
    raise exception 'OTP_ID_REQUIRED';
  end if;

  select id, tenant_id, action_code, target_meta, issued_by, used_at, used_by
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

  if v_otp.used_at < now() - interval '60 seconds' then
    raise exception 'OTP_EXPIRED_AFTER_USE: OTP đã hết hạn (>60s sau khi verify)';
  end if;

  -- Sprint A.6: strict target binding nếu caller pass p_expected_target_id
  -- VÀ OTP có entity_id/target_id/bill_id trong target_meta.
  if p_expected_target_id is not null then
    v_stored_target := coalesce(
      nullif(v_otp.target_meta->>'entity_id', '')::uuid,
      nullif(v_otp.target_meta->>'target_id', '')::uuid,
      nullif(v_otp.target_meta->>'bill_id', '')::uuid,
      nullif(v_otp.target_meta->>'kitchen_order_id', '')::uuid
    );
    -- Backward compat: nếu OTP cũ không có entity_id trong meta → skip
    -- (giai đoạn migration, sau 2 tuần sẽ enforce bắt buộc).
    if v_stored_target is not null and v_stored_target <> p_expected_target_id then
      raise exception 'OTP_TARGET_MISMATCH: OTP cấp cho target khác (% vs %)',
        v_stored_target, p_expected_target_id;
    end if;
  end if;

  return v_otp.issued_by;
end;
$$;

comment on function public.verify_otp_authorization is
  'Helper cho action RPC: verify OTP used + match action + user + (optional) target. Sprint A.6 bind target.';

grant execute on function public.verify_otp_authorization(uuid, text, uuid, uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────
-- 2. Re-create 3 action RPC để pass target_id
-- ────────────────────────────────────────────────────────────────

-- 2a. fnb_cancel_unpaid_order_atomic — pass p_order_id làm target
drop function if exists public.fnb_cancel_unpaid_order_atomic(uuid, text, text, uuid, uuid);

create or replace function public.fnb_cancel_unpaid_order_atomic(
  p_order_id uuid,
  p_reason_code text,
  p_reason_note text default null,
  p_shift_id uuid default null,
  p_otp_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_profile record;
  v_order record;
  v_items_snapshot jsonb := '[]'::jsonb;
  v_amount numeric := 0;
  v_note text;
  v_approver uuid;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED: please sign in before cancelling an FnB order';
  end if;

  select id, tenant_id, branch_id, role
  into v_profile
  from public.profiles
  where id = v_actor and is_active = true;

  if not found then
    raise exception 'USER_PROFILE_NOT_FOUND: %', v_actor;
  end if;

  -- Sprint A.6: bind target_id vào OTP verify
  if p_otp_id is not null then
    v_approver := public.verify_otp_authorization(
      p_otp_id, 'fnb.cancel_unpaid_bill', v_actor, p_order_id
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
  where id = p_order_id and tenant_id = v_profile.tenant_id
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
    select 1 from public.shifts
    where id = p_shift_id and tenant_id = v_order.tenant_id
      and branch_id = v_order.branch_id and status = 'open'
  ) then
    raise exception 'SHIFT_NOT_OPEN_FOR_ORDER_BRANCH: %', p_shift_id;
  end if;

  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'item_id', id, 'product_id', product_id,
          'product_name', product_name, 'variant_id', variant_id,
          'variant_label', variant_label, 'quantity', quantity,
          'unit_price', unit_price, 'note', note,
          'toppings', coalesce(toppings, '[]'::jsonb), 'status', status
        ) order by id
      ),
      '[]'::jsonb
    ),
    coalesce(sum(quantity * unit_price), 0)
  into v_items_snapshot, v_amount
  from public.kitchen_order_items
  where kitchen_order_id = p_order_id;

  v_note := trim(both from concat_ws(' ',
    nullif(v_order.note, ''),
    '[Hủy: ' || trim(p_reason_code) ||
      case when nullif(trim(coalesce(p_reason_note, '')), '') is not null
        then ' - ' || trim(p_reason_note) else '' end || ']'
  ));

  update public.kitchen_orders
  set status = 'cancelled',
      cancel_reason_code = trim(p_reason_code),
      cancel_reason = nullif(trim(coalesce(p_reason_note, '')), ''),
      cancelled_at = now(), cancelled_by = v_actor,
      cancel_approved_by = v_approver,
      note = nullif(v_note, ''), updated_at = now()
  where id = v_order.id and tenant_id = v_order.tenant_id;

  if v_order.table_id is not null then
    update public.restaurant_tables
    set status = 'available', current_order_id = null, updated_at = now()
    where tenant_id = v_order.tenant_id and id = v_order.table_id
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

grant execute on function public.fnb_cancel_unpaid_order_atomic(uuid, text, text, uuid, uuid) to authenticated;

-- 2b. delete_product_atomic — pass p_product_id làm target
drop function if exists public.delete_product_atomic(uuid, uuid);

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
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED: please sign in before deleting a product';
  end if;

  select id, tenant_id, role into v_profile
  from public.profiles
  where id = v_actor and is_active = true;

  if not found then
    raise exception 'USER_PROFILE_NOT_FOUND: %', v_actor;
  end if;

  -- Sprint A.6 + A.7: action_code 'products.delete' (split khỏi crm.delete_party)
  -- + bind target_id = p_product_id
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

-- 2c. delete_customer_atomic — pass p_customer_id làm target
drop function if exists public.delete_customer_atomic(uuid, uuid);

create or replace function public.delete_customer_atomic(
  p_customer_id uuid,
  p_otp_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
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

  select id, tenant_id, role into v_profile
  from public.profiles
  where id = v_actor and is_active = true;

  if not found then
    raise exception 'USER_PROFILE_NOT_FOUND: %', v_actor;
  end if;

  -- Sprint A.6 + A.7: action_code 'crm.delete_customer' (split khỏi crm.delete_party)
  -- + bind target_id = p_customer_id
  if p_otp_id is not null then
    v_approver := public.verify_otp_authorization(
      p_otp_id, 'crm.delete_customer', v_actor, p_customer_id
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
  where id = p_customer_id and tenant_id = v_profile.tenant_id
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
  where id = p_customer_id and tenant_id = v_profile.tenant_id;

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

grant execute on function public.delete_customer_atomic(uuid, uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────
-- 3. Update mapping action_code → permission trong issue_manager_otp
-- (Sprint A.7: tách crm.delete_party → crm.delete_customer + products.delete)
-- ────────────────────────────────────────────────────────────────
create or replace function public.issue_manager_otp(
  p_action_code text,
  p_target_meta jsonb default '{}'::jsonb,
  p_branch_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_profile record;
  v_required_perm text;
  v_code text;
  v_hash text;
  v_otp_id uuid;
  v_expires_at timestamptz := now() + interval '2 minutes';
  v_recent_count int;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED: please sign in';
  end if;

  select id, tenant_id, branch_id, full_name, role
  into v_profile from public.profiles
  where id = v_actor and is_active = true;

  if not found then
    raise exception 'USER_PROFILE_NOT_FOUND: %', v_actor;
  end if;

  -- Sprint A.7: tách action_code thành granular permissions
  v_required_perm := case p_action_code
    when 'fnb.cancel_unpaid_bill'   then 'pos_fnb.cancel_unpaid_order'
    when 'fnb.cancel_unpaid_item'   then 'pos_fnb.cancel_unpaid_order'
    when 'fnb.discount_override'    then 'pos_fnb.discount'
    when 'fnb.void_paid_bill'       then 'pos_fnb.void_paid_bill'
    when 'fnb.edit_sent_order'      then 'pos_fnb.edit_sent_order'
    when 'crm.delete_customer'      then 'customers.delete'
    when 'crm.delete_supplier'      then 'suppliers.delete'
    when 'products.delete'          then 'products.delete'
    -- Backward compat: alias 'crm.delete_party' (deprecated, sẽ xoá sau 2 tuần)
    when 'crm.delete_party'         then 'customers.delete'
    else null
  end;

  if v_required_perm is null then
    raise exception 'UNKNOWN_ACTION_CODE: %', p_action_code;
  end if;

  if not public.user_has_permission(v_actor, v_required_perm) then
    raise exception 'PERMISSION_DENIED: cần quyền % để cấp OTP cho action %',
      v_required_perm, p_action_code;
  end if;

  select count(*) into v_recent_count
  from public.manager_otp_codes
  where tenant_id = v_profile.tenant_id
    and issued_by = v_actor
    and created_at > now() - interval '15 minutes';

  if v_recent_count >= 5 then
    raise exception 'RATE_LIMIT_EXCEEDED: bạn đã cấp 5 OTP trong 15 phút qua, vui lòng đợi';
  end if;

  v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
  v_hash := public.hash_manager_otp(v_code, v_profile.tenant_id, v_actor);

  insert into public.manager_otp_codes (
    tenant_id, branch_id, code_hash, issued_by,
    action_code, target_meta, expires_at
  ) values (
    v_profile.tenant_id, coalesce(p_branch_id, v_profile.branch_id),
    v_hash, v_actor,
    p_action_code, coalesce(p_target_meta, '{}'::jsonb), v_expires_at
  ) returning id into v_otp_id;

  return jsonb_build_object(
    'success', true,
    'otp_id', v_otp_id,
    'code', v_code,
    'expires_at', v_expires_at,
    'expires_in_seconds', 120,
    'action_code', p_action_code,
    'issued_by_name', v_profile.full_name
  );
end;
$$;

grant execute on function public.issue_manager_otp(text, jsonb, uuid) to authenticated;

notify pgrst, 'reload schema';
