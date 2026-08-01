-- ============================================================
-- 00262: Atomic purchase-order state changes
-- ============================================================
-- Function definition only. It does not modify existing rows when applied.

create or replace function public.set_purchase_order_state_atomic(
  p_purchase_order_id uuid,
  p_new_status text,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_order record;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select p.tenant_id
    into v_tenant_id
    from public.profiles p
   where p.id = v_actor
     and coalesce(p.is_active, true);
  if v_tenant_id is null then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;

  if not public.user_has_permission(v_actor, 'inventory.create_po') then
    raise exception using errcode = '42501', message = 'INSUFFICIENT_PERMISSION';
  end if;
  if p_new_status not in ('ordered', 'cancelled') then
    raise exception using errcode = '22023', message = 'PURCHASE_ORDER_STATUS_INVALID';
  end if;

  select po.id, po.code, po.branch_id, po.status, po.note
    into v_order
    from public.purchase_orders po
   where po.id = p_purchase_order_id
     and po.tenant_id = v_tenant_id
   for update;
  if not found then
    raise exception using errcode = '22023', message = 'PURCHASE_ORDER_NOT_FOUND';
  end if;

  if not public.user_has_branch_access(v_actor, v_order.branch_id) then
    raise exception using errcode = '42501', message = 'BRANCH_ACCESS_DENIED';
  end if;

  if v_order.status = p_new_status then
    return jsonb_build_object(
      'purchase_order_id', v_order.id,
      'code', v_order.code,
      'status', v_order.status,
      'idempotent', true
    );
  end if;

  if p_new_status = 'ordered' and v_order.status <> 'draft' then
    raise exception using errcode = '22023', message = 'PURCHASE_ORDER_TRANSITION_INVALID';
  end if;
  if p_new_status = 'cancelled' and v_order.status not in ('draft', 'ordered') then
    raise exception using errcode = '22023', message = 'PURCHASE_ORDER_TRANSITION_INVALID';
  end if;

  update public.purchase_orders
     set status = p_new_status,
         note = case
           when p_new_status = 'cancelled'
             then coalesce(v_reason, 'Hủy phiếu nhập')
           else note
         end,
         updated_at = now()
   where id = v_order.id
     and tenant_id = v_tenant_id;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_tenant_id,
    v_actor,
    case when p_new_status = 'cancelled'
      then 'purchase_order_cancel'
      else 'purchase_order_status_change'
    end,
    'purchase_order',
    v_order.id,
    jsonb_build_object('status', v_order.status, 'note', v_order.note),
    jsonb_build_object(
      'status', p_new_status,
      'reason', v_reason,
      'atomic', true
    )
  );

  return jsonb_build_object(
    'purchase_order_id', v_order.id,
    'code', v_order.code,
    'status', p_new_status,
    'idempotent', false
  );
end;
$$;

revoke all on function public.set_purchase_order_state_atomic(
  uuid, text, text
) from public, anon;

grant execute on function public.set_purchase_order_state_atomic(
  uuid, text, text
) to authenticated;

comment on function public.set_purchase_order_state_atomic(
  uuid, text, text
) is 'Atomically orders or cancels an unreceived purchase order with audit.';

-- Harden closing the unreceived remainder of a partially received order.
-- The legacy actor argument is retained for API compatibility but cannot spoof auth.uid().
create or replace function public.close_purchase_order_short(
  p_order_id uuid,
  p_reason text,
  p_actor_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_order record;
  v_reason text := trim(coalesce(p_reason, ''));
  v_received_count integer := 0;
  v_remaining_count integer := 0;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if p_actor_id is not null and p_actor_id <> v_actor then
    raise exception using errcode = '42501', message = 'ACTOR_SPOOF_BLOCKED';
  end if;
  if length(v_reason) < 5 then
    raise exception using errcode = '22023', message = 'INVALID_REASON';
  end if;

  select p.tenant_id into v_tenant_id
    from public.profiles p
   where p.id = v_actor
     and coalesce(p.is_active, true);
  if v_tenant_id is null then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if not public.user_has_permission(v_actor, 'inventory.create_po') then
    raise exception using errcode = '42501', message = 'INSUFFICIENT_PERMISSION';
  end if;

  select po.id, po.code, po.tenant_id, po.branch_id, po.status, po.note
    into v_order
    from public.purchase_orders po
   where po.id = p_order_id
     and po.tenant_id = v_tenant_id
   for update;
  if not found then
    raise exception using errcode = '22023', message = 'PURCHASE_ORDER_NOT_FOUND';
  end if;
  if not public.user_has_branch_access(v_actor, v_order.branch_id) then
    raise exception using errcode = '42501', message = 'BRANCH_ACCESS_DENIED';
  end if;
  if v_order.status not in ('ordered', 'partial') then
    raise exception using errcode = '22023', message = 'PURCHASE_ORDER_TRANSITION_INVALID';
  end if;

  select
    count(*) filter (where coalesce(poi.received_quantity, 0) >= poi.quantity),
    count(*) filter (where coalesce(poi.received_quantity, 0) < poi.quantity)
    into v_received_count, v_remaining_count
    from public.purchase_order_items poi
   where poi.purchase_order_id = p_order_id;

  update public.purchase_orders
     set status = 'completed',
         closed_short = true,
         close_reason = v_reason,
         closed_at = now(),
         closed_by = v_actor,
         updated_at = now()
   where id = p_order_id
     and tenant_id = v_tenant_id;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_tenant_id, v_actor, 'close_short', 'purchase_order', p_order_id,
    jsonb_build_object('status', v_order.status, 'note', v_order.note),
    jsonb_build_object(
      'status', 'completed',
      'closed_short', true,
      'reason', v_reason,
      'items_received_fully', v_received_count,
      'items_remaining', v_remaining_count,
      'atomic', true
    )
  );

  return jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'code', v_order.code,
    'items_received_fully', v_received_count,
    'items_remaining', v_remaining_count
  );
end;
$$;

revoke all on function public.close_purchase_order_short(
  uuid, text, uuid
) from public, anon;
grant execute on function public.close_purchase_order_short(
  uuid, text, uuid
) to authenticated;

comment on function public.close_purchase_order_short(
  uuid, text, uuid
) is 'Closes only the unreceived remainder of a purchase order with auth, branch and audit guards.';

select to_regprocedure(
  'public.set_purchase_order_state_atomic(uuid,text,text)'
) is not null as purchase_order_state_atomic_ok;

select to_regprocedure(
  'public.close_purchase_order_short(uuid,text,uuid)'
) is not null as close_purchase_order_short_ok;
