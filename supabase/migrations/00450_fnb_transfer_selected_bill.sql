-- Transfer only the selected unpaid bill, including split bills.
-- Definition-only migration: no existing business rows are changed.

create or replace function public.fnb_transfer_table_atomic(
  p_tenant_id uuid,
  p_order_id uuid,
  p_from_table_id uuid,
  p_to_table_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_order record;
  v_from_table record;
  v_to_table record;
  v_remaining_order_id uuid;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'FNB_TRANSFER_AUTH_REQUIRED';
  end if;

  select p.tenant_id
    into v_tenant_id
    from public.profiles p
   where p.id = v_actor
     and coalesce(p.is_active, true);
  if v_tenant_id is null then
    raise exception using errcode = '42501', message = 'FNB_TRANSFER_ACTIVE_PROFILE_REQUIRED';
  end if;
  if p_tenant_id is distinct from v_tenant_id then
    raise exception using errcode = '42501', message = 'FNB_TRANSFER_TENANT_DENIED';
  end if;
  if not public.user_has_permission(v_actor, 'pos_fnb.transfer_table') then
    raise exception using errcode = '42501', message = 'FNB_TRANSFER_PERMISSION_REQUIRED';
  end if;
  if p_from_table_id = p_to_table_id then
    raise exception using errcode = '22023', message = 'FNB_TRANSFER_SAME_TABLE';
  end if;

  select ko.id, ko.branch_id, ko.table_id, ko.order_type, ko.status,
         ko.invoice_id, ko.original_table_id, ko.order_number, ko.merged_into_id
    into v_order
    from public.kitchen_orders ko
   where ko.id = p_order_id
     and ko.tenant_id = v_tenant_id
   for update;
  if not found then
    raise exception using errcode = '22023', message = 'FNB_TRANSFER_ORDER_NOT_FOUND';
  end if;
  if not public.user_has_branch_access(v_actor, v_order.branch_id) then
    raise exception using errcode = '42501', message = 'FNB_TRANSFER_BRANCH_DENIED';
  end if;
  if v_order.order_type is distinct from 'dine_in'
     or v_order.invoice_id is not null
     or v_order.merged_into_id is not null
     or v_order.status not in ('pending', 'preparing', 'ready', 'served') then
    raise exception using errcode = '22023', message = 'FNB_TRANSFER_ORDER_NOT_ELIGIBLE';
  end if;
  if v_order.table_id is distinct from p_from_table_id then
    raise exception using errcode = 'PT409', message = 'FNB_TRANSFER_SOURCE_STALE';
  end if;

  -- Lock both tables in a stable order so concurrent transfers cannot cross.
  perform rt.id
    from public.restaurant_tables rt
   where rt.tenant_id = v_tenant_id
     and rt.id in (p_from_table_id, p_to_table_id)
   order by rt.id
   for update;

  select rt.id, rt.branch_id, rt.status, rt.current_order_id, rt.is_active,
         rt.table_number, rt.name
    into v_from_table
    from public.restaurant_tables rt
   where rt.id = p_from_table_id
     and rt.tenant_id = v_tenant_id;
  if not found then
    raise exception using errcode = '22023', message = 'FNB_TRANSFER_TABLE_NOT_FOUND';
  end if;

  select rt.id, rt.branch_id, rt.status, rt.current_order_id, rt.is_active,
         rt.table_number, rt.name
    into v_to_table
    from public.restaurant_tables rt
   where rt.id = p_to_table_id
     and rt.tenant_id = v_tenant_id;
  if not found then
    raise exception using errcode = '22023', message = 'FNB_TRANSFER_TABLE_NOT_FOUND';
  end if;
  if not coalesce(v_from_table.is_active, true)
     or not coalesce(v_to_table.is_active, true)
     or v_from_table.branch_id <> v_order.branch_id
     or v_to_table.branch_id <> v_order.branch_id then
    raise exception using errcode = '42501', message = 'FNB_TRANSFER_TABLE_SCOPE_DENIED';
  end if;
  if v_from_table.status <> 'occupied'
     or (v_from_table.current_order_id is not null and not exists (
       select 1 from public.kitchen_orders ko where ko.id = v_from_table.current_order_id
         and ko.tenant_id = v_tenant_id and ko.branch_id = v_order.branch_id
         and ko.table_id = v_from_table.id and ko.invoice_id is null
         and ko.merged_into_id is null and ko.status in ('pending', 'preparing', 'ready', 'served')
     )) then
    raise exception using errcode = 'PT409', message = 'FNB_TRANSFER_SOURCE_STALE';
  end if;
  if v_to_table.status <> 'available' or v_to_table.current_order_id is not null
     or exists (select 1 from public.kitchen_orders ko
       where ko.tenant_id = v_tenant_id and ko.table_id = v_to_table.id
         and ko.invoice_id is null and ko.merged_into_id is null
         and ko.status in ('pending', 'preparing', 'ready', 'served')) then
    raise exception using errcode = '22023', message = 'FNB_TRANSFER_DESTINATION_UNAVAILABLE';
  end if;

  -- Only the selected bill moves. The source keeps a valid remaining bill.
  select ko.id into v_remaining_order_id from public.kitchen_orders ko
   where ko.tenant_id = v_tenant_id and ko.branch_id = v_order.branch_id
     and ko.table_id = v_from_table.id and ko.id <> v_order.id
     and ko.invoice_id is null and ko.merged_into_id is null
     and ko.status in ('pending', 'preparing', 'ready', 'served')
   order by (ko.id = v_from_table.current_order_id) desc, ko.id
   limit 1;

  update public.restaurant_tables
     set status = case when v_remaining_order_id is null then 'available' else 'occupied' end,
         current_order_id = v_remaining_order_id, updated_at = now()
   where id = v_from_table.id and tenant_id = v_tenant_id;

  update public.restaurant_tables
     set status = 'occupied', current_order_id = v_order.id, updated_at = now()
   where id = v_to_table.id and tenant_id = v_tenant_id;

  update public.kitchen_orders
     set table_id = v_to_table.id,
         original_table_id = coalesce(v_order.original_table_id, v_from_table.id),
         updated_at = now()
   where id = v_order.id and tenant_id = v_tenant_id;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_tenant_id,
    v_actor,
    'fnb_transfer_table',
    'kitchen_order',
    v_order.id,
    jsonb_build_object(
      'table_id', v_from_table.id,
      'table_number', v_from_table.table_number,
      'table_name', v_from_table.name
    ),
    jsonb_build_object(
      'table_id', v_to_table.id,
      'table_number', v_to_table.table_number,
      'table_name', v_to_table.name,
      'atomic', true,
      'scope', 'selected_bill',
      'source_remaining_order_id', v_remaining_order_id
    )
  );

  return jsonb_build_object(
    'success', true,
    'order_id', v_order.id,
    'from_table_id', v_from_table.id,
    'to_table_id', v_to_table.id
  );
end;
$$;

revoke all on function public.fnb_transfer_table_atomic(uuid, uuid, uuid, uuid)
  from public, anon;
grant execute on function public.fnb_transfer_table_atomic(uuid, uuid, uuid, uuid)
  to authenticated;

comment on function public.fnb_transfer_table_atomic(uuid, uuid, uuid, uuid) is
  'Atomic FnB table transfer. Derives actor scope from auth, validates effective permission and branch access, locks order/tables, and writes audit history.';

select
  to_regprocedure('public.fnb_transfer_table_atomic(uuid,uuid,uuid,uuid)') is not null
    as fnb_transfer_table_hardened_ok;
