-- ============================================================
-- 00252: Harden F&B KDS and delivery mutations
--
-- Function definitions only. Applying this migration does not update
-- existing business rows.
-- ============================================================

begin;

create or replace function public.fnb_update_kitchen_item_status_v2(
  p_item_id uuid,
  p_new_status text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_item record;
  v_all_ready boolean;
  v_order_status text;
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  select p.tenant_id into v_tenant_id
    from public.profiles p
   where p.id = v_actor
     and coalesce(p.is_active, true);
  if not found then
    raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode = 'P0001';
  end if;
  if not public.user_has_permission(v_actor, 'pos_fnb.view_orders') then
    raise exception 'INSUFFICIENT_PERMISSION' using errcode = 'P0001';
  end if;

  select
    koi.id,
    koi.status,
    koi.kitchen_order_id,
    ko.branch_id,
    ko.status as order_status,
    ko.invoice_id
    into v_item
    from public.kitchen_order_items koi
    join public.kitchen_orders ko on ko.id = koi.kitchen_order_id
   where koi.id = p_item_id
     and ko.tenant_id = v_tenant_id
   for update of koi, ko;
  if not found then
    raise exception 'KITCHEN_ITEM_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not public.user_has_branch_access(v_actor, v_item.branch_id) then
    raise exception 'BRANCH_ACCESS_DENIED' using errcode = 'P0001';
  end if;
  if v_item.invoice_id is not null
     or v_item.order_status in ('completed', 'cancelled', 'served') then
    raise exception 'KITCHEN_ORDER_CLOSED' using errcode = 'P0001';
  end if;
  if not (
    (v_item.status = 'pending' and p_new_status in ('preparing', 'ready'))
    or (v_item.status = 'preparing' and p_new_status = 'ready')
    or (v_item.status = 'ready' and p_new_status = 'preparing')
    or v_item.status = p_new_status
  ) then
    raise exception 'INVALID_KITCHEN_ITEM_TRANSITION:%:%',
      v_item.status,
      p_new_status
      using errcode = 'P0001';
  end if;

  update public.kitchen_order_items
     set status = p_new_status,
         started_at = case
           when p_new_status = 'preparing' then coalesce(started_at, now())
           else started_at
         end,
         completed_at = case
           when p_new_status = 'ready' then now()
           when p_new_status = 'preparing' then null
           else completed_at
         end
   where id = p_item_id;

  select not exists (
    select 1
      from public.kitchen_order_items x
     where x.kitchen_order_id = v_item.kitchen_order_id
       and greatest(x.quantity - coalesce(x.cancelled_qty, 0), 0) > 0
       and x.status <> 'ready'
  ) into v_all_ready;

  v_order_status := case
    when v_all_ready then 'ready'
    when exists (
      select 1
        from public.kitchen_order_items x
       where x.kitchen_order_id = v_item.kitchen_order_id
         and greatest(x.quantity - coalesce(x.cancelled_qty, 0), 0) > 0
         and x.status in ('preparing', 'ready')
    ) then 'preparing'
    else 'pending'
  end;

  update public.kitchen_orders
     set status = v_order_status,
         updated_at = now()
   where id = v_item.kitchen_order_id;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_tenant_id,
    v_actor,
    'fnb_kitchen_item_status',
    'kitchen_order_item',
    p_item_id,
    jsonb_build_object('status', v_item.status),
    jsonb_build_object(
      'status', p_new_status,
      'order_status', v_order_status
    )
  );

  return jsonb_build_object(
    'item_id', p_item_id,
    'item_status', p_new_status,
    'order_id', v_item.kitchen_order_id,
    'order_status', v_order_status
  );
end;
$$;

create or replace function public.fnb_update_kitchen_order_status_v2(
  p_order_id uuid,
  p_new_status text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_order record;
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  select p.tenant_id into v_tenant_id
    from public.profiles p
   where p.id = v_actor
     and coalesce(p.is_active, true);
  if not found then
    raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode = 'P0001';
  end if;
  if not public.user_has_permission(v_actor, 'pos_fnb.view_orders') then
    raise exception 'INSUFFICIENT_PERMISSION' using errcode = 'P0001';
  end if;

  select ko.id, ko.branch_id, ko.status, ko.invoice_id
    into v_order
    from public.kitchen_orders ko
   where ko.id = p_order_id
     and ko.tenant_id = v_tenant_id
   for update;
  if not found then
    raise exception 'KITCHEN_ORDER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not public.user_has_branch_access(v_actor, v_order.branch_id) then
    raise exception 'BRANCH_ACCESS_DENIED' using errcode = 'P0001';
  end if;
  if v_order.invoice_id is not null
     or v_order.status in ('completed', 'cancelled') then
    raise exception 'KITCHEN_ORDER_CLOSED' using errcode = 'P0001';
  end if;
  if p_new_status <> 'served' then
    raise exception 'ORDER_STATUS_MANAGED_BY_ITEMS' using errcode = 'P0001';
  end if;
  if exists (
    select 1
      from public.kitchen_order_items koi
     where koi.kitchen_order_id = p_order_id
       and greatest(koi.quantity - coalesce(koi.cancelled_qty, 0), 0) > 0
       and koi.status <> 'ready'
  ) then
    raise exception 'ORDER_ITEMS_NOT_READY' using errcode = 'P0001';
  end if;

  update public.kitchen_orders
     set status = 'served',
         updated_at = now()
   where id = p_order_id;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_tenant_id,
    v_actor,
    'fnb_kitchen_order_served',
    'kitchen_order',
    p_order_id,
    jsonb_build_object('status', v_order.status),
    jsonb_build_object('status', 'served')
  );

  return jsonb_build_object(
    'kitchen_order_id', p_order_id,
    'status', 'served'
  );
end;
$$;

create or replace function public.fnb_set_delivery_pricing_v2(
  p_kitchen_order_id uuid,
  p_platform text,
  p_delivery_fee numeric,
  p_commission_percent numeric,
  p_distance_tier text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_settings jsonb := '{}'::jsonb;
  v_order record;
  v_default_commission numeric;
  v_fee numeric;
  v_effective_tier text;
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  select p.tenant_id, coalesce(t.settings, '{}'::jsonb)
    into v_tenant_id, v_settings
    from public.profiles p
    join public.tenants t on t.id = p.tenant_id
   where p.id = v_actor
     and coalesce(p.is_active, true);
  if not found then
    raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode = 'P0001';
  end if;
  if not public.user_has_permission(v_actor, 'pos_fnb.send_kitchen') then
    raise exception 'INSUFFICIENT_PERMISSION' using errcode = 'P0001';
  end if;

  select
    ko.id,
    ko.branch_id,
    ko.order_type,
    ko.status,
    ko.invoice_id,
    ko.delivery_distance_tier
    into v_order
    from public.kitchen_orders ko
   where ko.id = p_kitchen_order_id
     and ko.tenant_id = v_tenant_id
   for update;
  if not found then
    raise exception 'KITCHEN_ORDER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not public.user_has_branch_access(v_actor, v_order.branch_id) then
    raise exception 'BRANCH_ACCESS_DENIED' using errcode = 'P0001';
  end if;
  if v_order.invoice_id is not null
     or v_order.status in ('completed', 'cancelled') then
    raise exception 'KITCHEN_ORDER_CLOSED' using errcode = 'P0001';
  end if;
  if v_order.order_type <> 'delivery' then
    raise exception 'DELIVERY_ORDER_REQUIRED' using errcode = 'P0001';
  end if;
  if p_platform not in ('shopee_food', 'grab_food', 'gojek', 'be', 'direct') then
    raise exception 'INVALID_DELIVERY_PLATFORM' using errcode = 'P0001';
  end if;
  if p_distance_tier is not null
     and p_distance_tier not in ('near', 'mid', 'far', 'custom') then
    raise exception 'INVALID_DELIVERY_DISTANCE_TIER' using errcode = 'P0001';
  end if;
  v_effective_tier := coalesce(
    p_distance_tier,
    v_order.delivery_distance_tier
  );
  if coalesce(
    (v_settings #>> array[
      'fnb_delivery_platforms', p_platform, 'active'
    ])::boolean,
    true
  ) is false then
    raise exception 'DELIVERY_PLATFORM_DISABLED' using errcode = 'P0001';
  end if;

  v_default_commission := coalesce(
    (v_settings #>> array[
      'fnb_delivery_platforms', p_platform, 'commissionPercent'
    ])::numeric,
    case p_platform
      when 'shopee_food' then 25
      when 'grab_food' then 25
      when 'gojek' then 25
      when 'be' then 20
      else 0
    end
  );
  if coalesce(p_commission_percent, v_default_commission) < 0
     or coalesce(p_commission_percent, v_default_commission) > 100 then
    raise exception 'INVALID_PLATFORM_COMMISSION' using errcode = 'P0001';
  end if;
  if abs(
    coalesce(p_commission_percent, v_default_commission)
    - v_default_commission
  ) > 0.01
     and not public.user_has_permission(v_actor, 'pos_fnb.edit_price') then
    raise exception 'PLATFORM_COMMISSION_OVERRIDE_DENIED' using errcode = 'P0001';
  end if;

  if v_effective_tier in ('near', 'mid', 'far') then
    select ft.fee
      into v_fee
      from public.fnb_delivery_fee_tiers ft
     where ft.tenant_id = v_tenant_id
       and ft.tier_code = v_effective_tier
       and ft.is_active
       and (ft.branch_id = v_order.branch_id or ft.branch_id is null)
     order by (ft.branch_id = v_order.branch_id) desc
     limit 1;
    if not found then
      raise exception 'DELIVERY_FEE_TIER_NOT_CONFIGURED' using errcode = 'P0001';
    end if;
  else
    v_fee := coalesce(p_delivery_fee, 0);
  end if;
  if v_fee < 0 then
    raise exception 'INVALID_DELIVERY_FEE' using errcode = 'P0001';
  end if;

  update public.kitchen_orders
     set delivery_platform = p_platform,
         delivery_fee = v_fee,
         platform_commission = 0,
         platform_commission_percent = coalesce(
           p_commission_percent,
           v_default_commission
         ),
         delivery_distance_tier = v_effective_tier,
         updated_at = now()
   where id = p_kitchen_order_id;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_tenant_id,
    v_actor,
    'fnb_delivery_pricing_updated',
    'kitchen_order',
    p_kitchen_order_id,
    jsonb_build_object(
      'platform', p_platform,
      'delivery_fee', v_fee,
      'commission_percent', coalesce(
        p_commission_percent,
        v_default_commission
      ),
      'distance_tier', v_effective_tier
    )
  );

  return jsonb_build_object(
    'kitchen_order_id', p_kitchen_order_id,
    'delivery_platform', p_platform,
    'delivery_fee', v_fee,
    'platform_commission_percent', coalesce(
      p_commission_percent,
      v_default_commission
    ),
    'delivery_distance_tier', v_effective_tier
  );
end;
$$;

create or replace function public.assign_delivery_staff_to_order(
  p_kitchen_order_id uuid,
  p_staff_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_order record;
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  select p.tenant_id into v_tenant_id
    from public.profiles p
   where p.id = v_actor
     and coalesce(p.is_active, true);
  if not found then
    raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode = 'P0001';
  end if;
  if not public.user_has_permission(v_actor, 'pos_fnb.send_kitchen') then
    raise exception 'INSUFFICIENT_PERMISSION' using errcode = 'P0001';
  end if;

  select ko.id, ko.branch_id, ko.invoice_id, ko.delivery_staff_id
    into v_order
    from public.kitchen_orders ko
   where ko.id = p_kitchen_order_id
     and ko.tenant_id = v_tenant_id
   for update;
  if not found then
    raise exception 'KITCHEN_ORDER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not public.user_has_branch_access(v_actor, v_order.branch_id) then
    raise exception 'BRANCH_ACCESS_DENIED' using errcode = 'P0001';
  end if;
  if p_staff_id is not null and not exists (
    select 1
      from public.profiles sp
     where sp.id = p_staff_id
       and sp.tenant_id = v_tenant_id
       and coalesce(sp.is_active, true)
       and public.user_has_branch_access(sp.id, v_order.branch_id)
  ) then
    raise exception 'DELIVERY_STAFF_NOT_AVAILABLE_FOR_BRANCH'
      using errcode = 'P0001';
  end if;

  update public.kitchen_orders
     set delivery_staff_id = p_staff_id,
         delivery_assigned_at = case
           when p_staff_id is null then null
           else coalesce(delivery_assigned_at, now())
         end,
         delivery_completed_at = case
           when p_staff_id is null then null
           else delivery_completed_at
         end,
         updated_at = now()
   where id = p_kitchen_order_id;

  if v_order.invoice_id is not null then
    update public.invoices
       set delivery_staff_id = p_staff_id
     where id = v_order.invoice_id
       and tenant_id = v_tenant_id;
  end if;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_tenant_id,
    v_actor,
    case when p_staff_id is null
      then 'fnb_delivery_staff_unassigned'
      else 'fnb_delivery_staff_assigned'
    end,
    'kitchen_order',
    p_kitchen_order_id,
    jsonb_build_object('delivery_staff_id', v_order.delivery_staff_id),
    jsonb_build_object('delivery_staff_id', p_staff_id)
  );

  return jsonb_build_object(
    'kitchen_order_id', p_kitchen_order_id,
    'delivery_staff_id', p_staff_id,
    'invoice_updated', v_order.invoice_id is not null
  );
end;
$$;

create or replace function public.complete_delivery_for_order(
  p_kitchen_order_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_order record;
  v_completed_at timestamptz := now();
  v_duration_seconds int;
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  select p.tenant_id into v_tenant_id
    from public.profiles p
   where p.id = v_actor
     and coalesce(p.is_active, true);
  if not found then
    raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode = 'P0001';
  end if;

  select
    ko.id,
    ko.branch_id,
    ko.delivery_staff_id,
    ko.delivery_assigned_at,
    ko.created_at,
    ko.delivery_completed_at
    into v_order
    from public.kitchen_orders ko
   where ko.id = p_kitchen_order_id
     and ko.tenant_id = v_tenant_id
   for update;
  if not found then
    raise exception 'KITCHEN_ORDER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not public.user_has_branch_access(v_actor, v_order.branch_id) then
    raise exception 'BRANCH_ACCESS_DENIED' using errcode = 'P0001';
  end if;
  if v_order.delivery_staff_id is null then
    raise exception 'DELIVERY_STAFF_REQUIRED' using errcode = 'P0001';
  end if;
  if v_actor <> v_order.delivery_staff_id
     and not public.user_has_permission(v_actor, 'pos_fnb.send_kitchen') then
    raise exception 'INSUFFICIENT_PERMISSION' using errcode = 'P0001';
  end if;

  if v_order.delivery_completed_at is not null then
    v_completed_at := v_order.delivery_completed_at;
  else
    update public.kitchen_orders
       set delivery_completed_at = v_completed_at,
           updated_at = now()
     where id = p_kitchen_order_id;
  end if;

  v_duration_seconds := extract(
    epoch from (
      v_completed_at
      - coalesce(v_order.delivery_assigned_at, v_order.created_at)
    )
  )::int;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_tenant_id,
    v_actor,
    'fnb_delivery_completed',
    'kitchen_order',
    p_kitchen_order_id,
    jsonb_build_object(
      'completed_at', v_completed_at,
      'duration_seconds', v_duration_seconds
    )
  );

  return jsonb_build_object(
    'kitchen_order_id', p_kitchen_order_id,
    'completed_at', v_completed_at,
    'duration_seconds', v_duration_seconds
  );
end;
$$;

revoke all on function public.fnb_update_kitchen_item_status_v2(uuid,text)
  from public, anon;
grant execute on function public.fnb_update_kitchen_item_status_v2(uuid,text)
  to authenticated;

revoke all on function public.fnb_update_kitchen_order_status_v2(uuid,text)
  from public, anon;
grant execute on function public.fnb_update_kitchen_order_status_v2(uuid,text)
  to authenticated;

revoke all on function public.fnb_set_delivery_pricing_v2(
  uuid,text,numeric,numeric,text
) from public, anon;
grant execute on function public.fnb_set_delivery_pricing_v2(
  uuid,text,numeric,numeric,text
) to authenticated;

revoke all on function public.assign_delivery_staff_to_order(uuid,uuid)
  from public, anon;
grant execute on function public.assign_delivery_staff_to_order(uuid,uuid)
  to authenticated;

revoke all on function public.complete_delivery_for_order(uuid)
  from public, anon;
grant execute on function public.complete_delivery_for_order(uuid)
  to authenticated;

commit;

select
  to_regprocedure(
    'public.fnb_update_kitchen_item_status_v2(uuid,text)'
  ) is not null as kds_item_rpc_ok,
  to_regprocedure(
    'public.fnb_update_kitchen_order_status_v2(uuid,text)'
  ) is not null as kds_order_rpc_ok,
  to_regprocedure(
    'public.fnb_set_delivery_pricing_v2(uuid,text,numeric,numeric,text)'
  ) is not null as delivery_pricing_rpc_ok,
  p.prosrc like '%auth.uid()%' as delivery_actor_derived_ok,
  p.prosrc like '%user_has_branch_access%' as delivery_branch_check_ok
from pg_proc p
where p.oid = to_regprocedure(
  'public.fnb_set_delivery_pricing_v2(uuid,text,numeric,numeric,text)'
);
