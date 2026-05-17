-- ============================================================
-- 00087: issue_manager_otp — resolve invoice/kitchen_order code → uuid (CEO 17/05/2026)
--
-- VẤN ĐỀ: hiện manager cấp OTP với target_meta rỗng → verify fallback
-- backward-compat (skip target check) → OTP "vạn năng" reusable cho bill khác.
--
-- FIX: cho phép manager nhập mã hoá đơn / mã đơn bếp khi cấp OTP. Server
-- resolve mã → uuid → lưu vào target_meta.entity_id. RPC verify sẽ strict
-- bind đúng target.
--
-- Backward compat: nếu manager không nhập code → target_meta rỗng, vẫn cấp
-- được nhưng UI nên warn "OTP này không gắn bill cụ thể".
-- ============================================================

create or replace function public.issue_manager_otp(
  p_action_code text,
  p_target_meta jsonb default '{}'::jsonb,
  p_branch_id uuid default null,
  -- Day 17/05/2026: cho phép manager đọc mã từ cashier qua điện thoại
  p_target_invoice_code text default null,
  p_target_kitchen_order_number text default null
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
  v_resolved_entity_id uuid;
  v_resolved_meta jsonb;
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

  v_required_perm := case p_action_code
    when 'fnb.cancel_unpaid_bill'   then 'pos_fnb.cancel_unpaid_order'
    when 'fnb.cancel_unpaid_item'   then 'pos_fnb.cancel_unpaid_order'
    when 'fnb.discount_override'    then 'pos_fnb.discount'
    when 'fnb.void_paid_bill'       then 'pos_fnb.void_paid_bill'
    when 'fnb.edit_sent_order'      then 'pos_fnb.edit_sent_order'
    when 'crm.delete_customer'      then 'customers.delete'
    when 'crm.delete_supplier'      then 'suppliers.delete'
    when 'products.delete'          then 'products.delete'
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

  -- Day 17/05/2026: Resolve code → uuid, lưu vào target_meta.entity_id
  v_resolved_meta := coalesce(p_target_meta, '{}'::jsonb);

  if p_target_invoice_code is not null and length(trim(p_target_invoice_code)) > 0 then
    select id into v_resolved_entity_id
    from public.invoices
    where tenant_id = v_profile.tenant_id and code = trim(p_target_invoice_code);

    if v_resolved_entity_id is null then
      raise exception 'INVOICE_CODE_NOT_FOUND: % — vui lòng kiểm tra lại mã hoá đơn', p_target_invoice_code;
    end if;

    v_resolved_meta := v_resolved_meta
      || jsonb_build_object(
        'entity_id', v_resolved_entity_id,
        'invoice_id', v_resolved_entity_id,
        'invoice_code', trim(p_target_invoice_code)
      );
  end if;

  if p_target_kitchen_order_number is not null and length(trim(p_target_kitchen_order_number)) > 0 then
    select id into v_resolved_entity_id
    from public.kitchen_orders
    where tenant_id = v_profile.tenant_id
      and order_number = trim(p_target_kitchen_order_number);

    if v_resolved_entity_id is null then
      raise exception 'KITCHEN_ORDER_NUMBER_NOT_FOUND: % — vui lòng kiểm tra lại mã đơn bếp', p_target_kitchen_order_number;
    end if;

    v_resolved_meta := v_resolved_meta
      || jsonb_build_object(
        'entity_id', v_resolved_entity_id,
        'kitchen_order_id', v_resolved_entity_id,
        'kitchen_order_number', trim(p_target_kitchen_order_number)
      );
  end if;

  v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
  v_hash := public.hash_manager_otp(v_code, v_profile.tenant_id, v_actor);

  insert into public.manager_otp_codes (
    tenant_id, branch_id, code_hash, issued_by,
    action_code, target_meta, expires_at
  ) values (
    v_profile.tenant_id, coalesce(p_branch_id, v_profile.branch_id),
    v_hash, v_actor,
    p_action_code, v_resolved_meta, v_expires_at
  ) returning id into v_otp_id;

  return jsonb_build_object(
    'success', true,
    'otp_id', v_otp_id,
    'code', v_code,
    'expires_at', v_expires_at,
    'expires_in_seconds', 120,
    'action_code', p_action_code,
    'issued_by_name', v_profile.full_name,
    'target_bound', v_resolved_meta ? 'entity_id'
  );
end;
$$;

grant execute on function public.issue_manager_otp(text, jsonb, uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
