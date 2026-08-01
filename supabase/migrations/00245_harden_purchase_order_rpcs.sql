-- ============================================================
-- 00245: Harden purchase-order SECURITY DEFINER RPCs
--
-- Migration-time changes are function definitions and privileges only.
-- Existing purchase orders, stock, lots, cash and debt are not rewritten.
-- ============================================================

begin;

-- Preserve the proven business implementations under private names, then expose
-- guarded wrappers with the original signatures used by the application.
do $$
begin
  if to_regprocedure('public._receive_purchase_items_atomic_impl_00102(uuid,jsonb,uuid)') is null then
    alter function public.receive_purchase_items_atomic(uuid, jsonb, uuid)
      rename to _receive_purchase_items_atomic_impl_00102;
  end if;
  if to_regprocedure('public._revert_received_purchase_order_impl_00214(uuid,uuid,boolean)') is null then
    alter function public.revert_received_purchase_order_atomic(uuid, uuid, boolean)
      rename to _revert_received_purchase_order_impl_00214;
  end if;
  if to_regprocedure('public._update_purchase_order_prices_impl_00234(uuid,jsonb,uuid,text,text,numeric,numeric,numeric)') is null then
    alter function public.update_purchase_order_prices(
      uuid, jsonb, uuid, text, text, numeric, numeric, numeric
    ) rename to _update_purchase_order_prices_impl_00234;
  end if;
end;
$$;

revoke all on function public._receive_purchase_items_atomic_impl_00102(
  uuid, jsonb, uuid
) from public, anon, authenticated;
revoke all on function public._revert_received_purchase_order_impl_00214(
  uuid, uuid, boolean
) from public, anon, authenticated;
revoke all on function public._update_purchase_order_prices_impl_00234(
  uuid, jsonb, uuid, text, text, numeric, numeric, numeric
) from public, anon, authenticated;

create or replace function public.receive_purchase_items_atomic(
  p_order_id uuid,
  p_lines jsonb,
  p_created_by uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_po record;
  v_result jsonb;
  v_recorded numeric := 0;
  v_missing numeric := 0;
  v_cash_code text;
  v_cash_id uuid;
  v_shift_id uuid;
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  if p_created_by is not null and p_created_by <> v_actor then
    raise exception 'ACTOR_SPOOF_BLOCKED' using errcode = 'P0001';
  end if;

  select p.tenant_id into v_tenant_id
    from public.profiles p
   where p.id = v_actor and coalesce(p.is_active, true);
  if not found then
    raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode = 'P0001';
  end if;
  if not public.user_has_permission(v_actor, 'inventory.create_po') then
    raise exception 'INSUFFICIENT_PERMISSION' using errcode = 'P0001';
  end if;
  if p_lines is not null and jsonb_typeof(p_lines) <> 'array' then
    raise exception 'INVALID_RECEIVE_LINES' using errcode = 'P0001';
  end if;

  select po.id, po.code, po.tenant_id, po.branch_id, po.supplier_name,
         po.status, po.paid
    into v_po
    from public.purchase_orders po
   where po.id = p_order_id
     and po.tenant_id = v_tenant_id
   for update;
  if not found then
    raise exception 'PURCHASE_ORDER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not public.user_has_branch_access(v_actor, v_po.branch_id) then
    raise exception 'BRANCH_ACCESS_DENIED' using errcode = 'P0001';
  end if;

  v_result := public._receive_purchase_items_atomic_impl_00102(
    p_order_id, p_lines, v_actor
  );

  -- The amount entered as already paid must have a matching cash voucher in the
  -- same transaction as stock receipt. The PO row lock serializes retries.
  select coalesce(sum(ct.amount), 0)
    into v_recorded
    from public.cash_transactions ct
   where ct.tenant_id = v_tenant_id
     and ct.type = 'payment'
     and ct.reference_type = 'purchase_order'
     and ct.reference_id = p_order_id
     and coalesce(ct.status, 'completed') <> 'cancelled';

  v_missing := greatest(0, coalesce(v_po.paid, 0) - v_recorded);
  if v_missing > 1 then
    select s.id into v_shift_id
      from public.shifts s
     where s.tenant_id = v_tenant_id
       and s.branch_id = v_po.branch_id
       and s.cashier_id = v_actor
       and s.status = 'open'
     order by s.opened_at desc
     limit 1;

    v_cash_code := public.next_cash_code(v_tenant_id, 'payment');
    insert into public.cash_transactions (
      tenant_id, branch_id, code, type, category, amount, counterparty,
      payment_method, reference_type, reference_id, note, created_by, shift_id
    ) values (
      v_tenant_id, v_po.branch_id, v_cash_code, 'payment',
      'Trả nhà cung cấp', v_missing, v_po.supplier_name,
      'cash', 'purchase_order', p_order_id,
      'Thanh toán khi nhập hàng - phiếu ' || v_po.code,
      v_actor, v_shift_id
    )
    returning id into v_cash_id;
  end if;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_tenant_id,
    v_actor,
    'purchase_receive',
    'purchase_order',
    p_order_id,
    jsonb_build_object(
      'result', v_result,
      'cash_transaction_id', v_cash_id,
      'cash_amount_recorded', v_missing,
      'atomic', true
    )
  );

  return v_result || jsonb_build_object(
    'cash_transaction_id', v_cash_id,
    'cash_amount_recorded', v_missing
  );
end;
$$;

create or replace function public.revert_received_purchase_order_atomic(
  p_order_id uuid,
  p_user_id uuid,
  p_allow_negative boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_po record;
  v_result jsonb;
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  if p_user_id is not null and p_user_id <> v_actor then
    raise exception 'ACTOR_SPOOF_BLOCKED' using errcode = 'P0001';
  end if;

  select p.tenant_id into v_tenant_id
    from public.profiles p
   where p.id = v_actor and coalesce(p.is_active, true);
  if not found then
    raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode = 'P0001';
  end if;
  if not public.user_has_permission(v_actor, 'inventory.create_po') then
    raise exception 'INSUFFICIENT_PERMISSION' using errcode = 'P0001';
  end if;
  if coalesce(p_allow_negative, false)
     and not public.user_has_permission(v_actor, 'inventory.adjust') then
    raise exception 'NEGATIVE_STOCK_OVERRIDE_DENIED' using errcode = 'P0001';
  end if;

  select po.id, po.code, po.tenant_id, po.branch_id, po.status
    into v_po
    from public.purchase_orders po
   where po.id = p_order_id
     and po.tenant_id = v_tenant_id
   for update;
  if not found then
    raise exception 'PURCHASE_ORDER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not public.user_has_branch_access(v_actor, v_po.branch_id) then
    raise exception 'BRANCH_ACCESS_DENIED' using errcode = 'P0001';
  end if;

  v_result := public._revert_received_purchase_order_impl_00214(
    p_order_id, v_actor, coalesce(p_allow_negative, false)
  );

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_tenant_id,
    v_actor,
    'purchase_receive_revert',
    'purchase_order',
    p_order_id,
    jsonb_build_object('code', v_po.code, 'status', v_po.status),
    v_result || jsonb_build_object(
      'allow_negative', coalesce(p_allow_negative, false),
      'atomic', true
    )
  );

  return v_result;
end;
$$;

create or replace function public.update_purchase_order_prices(
  p_order_id uuid,
  p_items jsonb,
  p_supplier_id uuid default null,
  p_supplier_name text default null,
  p_note text default null,
  p_shipping_cost numeric default null,
  p_other_cost numeric default null,
  p_order_discount numeric default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_po record;
  v_supplier_name text;
  v_result jsonb;
  v_new_total numeric;
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;

  select p.tenant_id into v_tenant_id
    from public.profiles p
   where p.id = v_actor and coalesce(p.is_active, true);
  if not found then
    raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode = 'P0001';
  end if;
  if not public.user_has_permission(v_actor, 'inventory.create_po') then
    raise exception 'INSUFFICIENT_PERMISSION' using errcode = 'P0001';
  end if;
  if p_items is not null and jsonb_typeof(p_items) <> 'array' then
    raise exception 'INVALID_PRICE_ITEMS' using errcode = 'P0001';
  end if;
  if coalesce(p_shipping_cost, 0) < 0
     or coalesce(p_other_cost, 0) < 0
     or coalesce(p_order_discount, 0) < 0 then
    raise exception 'NEGATIVE_PURCHASE_AMOUNT' using errcode = 'P0001';
  end if;

  select po.id, po.code, po.tenant_id, po.branch_id, po.status, po.total
    into v_po
    from public.purchase_orders po
   where po.id = p_order_id
     and po.tenant_id = v_tenant_id
   for update;
  if not found then
    raise exception 'PURCHASE_ORDER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not public.user_has_branch_access(v_actor, v_po.branch_id) then
    raise exception 'BRANCH_ACCESS_DENIED' using errcode = 'P0001';
  end if;

  if p_supplier_id is not null then
    select s.name into v_supplier_name
      from public.suppliers s
     where s.id = p_supplier_id
       and s.tenant_id = v_tenant_id
       and coalesce(s.is_active, true);
    if not found then
      raise exception 'SUPPLIER_NOT_FOUND' using errcode = 'P0001';
    end if;
  end if;

  v_result := public._update_purchase_order_prices_impl_00234(
    p_order_id,
    coalesce(p_items, '[]'::jsonb),
    p_supplier_id,
    v_supplier_name,
    p_note,
    p_shipping_cost,
    p_other_cost,
    p_order_discount
  );

  v_new_total := coalesce((v_result->>'tong_moi')::numeric, 0);
  if v_new_total < 0 then
    raise exception 'PURCHASE_TOTAL_NEGATIVE' using errcode = 'P0001';
  end if;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_tenant_id,
    v_actor,
    'purchase_price_update',
    'purchase_order',
    p_order_id,
    jsonb_build_object(
      'code', v_po.code,
      'status', v_po.status,
      'total', v_po.total
    ),
    v_result || jsonb_build_object(
      'supplier_id', p_supplier_id,
      'shipping_cost', p_shipping_cost,
      'other_cost', p_other_cost,
      'order_discount', p_order_discount,
      'atomic', true
    )
  );

  return v_result;
end;
$$;

revoke all on function public.receive_purchase_items_atomic(uuid, jsonb, uuid)
  from public, anon;
grant execute on function public.receive_purchase_items_atomic(uuid, jsonb, uuid)
  to authenticated;

revoke all on function public.revert_received_purchase_order_atomic(
  uuid, uuid, boolean
) from public, anon;
grant execute on function public.revert_received_purchase_order_atomic(
  uuid, uuid, boolean
) to authenticated;

revoke all on function public.update_purchase_order_prices(
  uuid, jsonb, uuid, text, text, numeric, numeric, numeric
) from public, anon;
grant execute on function public.update_purchase_order_prices(
  uuid, jsonb, uuid, text, text, numeric, numeric, numeric
) to authenticated;

commit;

-- Verification only. Expected: all booleans are true.
select
  p.proname,
  p.prosecdef as security_definer_ok,
  p.prosrc like '%auth.uid()%' as auth_actor_ok,
  p.prosrc like '%user_has_permission%' as permission_check_ok,
  p.prosrc like '%user_has_branch_access%' as branch_check_ok,
  p.prosrc like '%ACTOR_SPOOF_BLOCKED%' as actor_spoof_blocked
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'receive_purchase_items_atomic',
    'revert_received_purchase_order_atomic',
    'update_purchase_order_prices'
  )
order by p.proname;

select
  not has_function_privilege(
    'authenticated',
    'public._receive_purchase_items_atomic_impl_00102(uuid,jsonb,uuid)',
    'execute'
  ) as receive_impl_private,
  not has_function_privilege(
    'authenticated',
    'public._revert_received_purchase_order_impl_00214(uuid,uuid,boolean)',
    'execute'
  ) as revert_impl_private,
  not has_function_privilege(
    'authenticated',
    'public._update_purchase_order_prices_impl_00234(uuid,jsonb,uuid,text,text,numeric,numeric,numeric)',
    'execute'
  ) as price_impl_private;
