-- ============================================================================
-- 00379 - Allow paid FnB kitchen orders to finish the kitchen workflow
--
-- Paying an order closes the cashier workflow, not the kitchen workflow.
-- A paid order must still move pending -> preparing -> ready -> served.
-- This migration replaces function definitions only and does not update data.
-- ============================================================================

begin;

do $$
begin
  if to_regprocedure('public.fnb_update_kitchen_item_status_v2(uuid,text)') is null
     or to_regprocedure('public.fnb_update_kitchen_order_status_v2(uuid,text)') is null then
    raise exception 'FNB_00379_REQUIRED_RPC_MISSING' using errcode = 'P0001';
  end if;
  if to_regclass('public.kitchen_orders') is null
     or to_regclass('public.kitchen_order_items') is null
     or to_regclass('public.audit_log') is null then
    raise exception 'FNB_00379_REQUIRED_TABLE_MISSING' using errcode = 'P0001';
  end if;
end;
$$;

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

  -- invoice_id only means the cashier has collected payment. Kitchen work is
  -- closed solely by a terminal kitchen-order status.
  if v_item.order_status in ('completed', 'cancelled', 'served') then
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
    jsonb_build_object('status', p_new_status, 'order_status', v_order_status)
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

  -- A linked invoice must not prevent the kitchen from serving a paid order.
  if v_order.status in ('completed', 'cancelled') then
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

revoke all on function public.fnb_update_kitchen_item_status_v2(uuid, text)
  from public, anon;
grant execute on function public.fnb_update_kitchen_item_status_v2(uuid, text)
  to authenticated;

revoke all on function public.fnb_update_kitchen_order_status_v2(uuid, text)
  from public, anon;
grant execute on function public.fnb_update_kitchen_order_status_v2(uuid, text)
  to authenticated;

comment on function public.fnb_update_kitchen_item_status_v2(uuid, text) is
  'KDS item transition RPC. Paid orders may continue; terminal kitchen orders remain locked.';
comment on function public.fnb_update_kitchen_order_status_v2(uuid, text) is
  'KDS serve RPC. Requires all active items ready; paid orders may be served.';

do $$
declare
  v_item_definition text;
  v_order_definition text;
begin
  select lower(pg_get_functiondef(
    'public.fnb_update_kitchen_item_status_v2(uuid,text)'::regprocedure
  )) into v_item_definition;
  select lower(pg_get_functiondef(
    'public.fnb_update_kitchen_order_status_v2(uuid,text)'::regprocedure
  )) into v_order_definition;

  if position('invoice_id is not null' in v_item_definition) > 0
     or position('invoice_id is not null' in v_order_definition) > 0 then
    raise exception 'FNB_00379_PAID_ORDER_GUARD_STILL_ACTIVE' using errcode = 'P0001';
  end if;
  if not has_function_privilege(
       'authenticated',
       'public.fnb_update_kitchen_item_status_v2(uuid,text)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated',
       'public.fnb_update_kitchen_order_status_v2(uuid,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.fnb_update_kitchen_item_status_v2(uuid,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.fnb_update_kitchen_order_status_v2(uuid,text)',
       'EXECUTE'
     ) then
    raise exception 'FNB_00379_RPC_PRIVILEGE_CHECK_FAILED' using errcode = 'P0001';
  end if;
end;
$$;

commit;
notify pgrst, 'reload schema';

select
  true as paid_kitchen_progress_enabled,
  true as terminal_status_guards_kept,
  true as authenticated_only;
