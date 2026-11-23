begin;
set local lock_timeout = '2s';

-- Update the existing open bill. Kitchen lines and print jobs are untouched.
create function public.fnb_change_bill_service_v1(
  p_order_id uuid, p_expected_type text, p_order_type text, p_table_id uuid,
  p_platform text, p_fee numeric, p_tier text, p_policy_revision bigint
) returns jsonb
language plpgsql security definer
set search_path = ''
set lock_timeout = '2s'
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_order public.kitchen_orders;
  v_table public.restaurant_tables;
  v_remaining uuid;
  v_policy jsonb;
  v_pricing jsonb;
  v_changed boolean := false;
begin
  select tenant_id into v_tenant from public.profiles where id = v_actor and coalesce(is_active, true);
  if v_tenant is null then raise exception 'FNB_SERVICE_DENIED' using errcode = '42501'; end if;
  if p_order_type is null or p_order_type not in ('takeaway','dine_in','delivery')
    or (p_order_type = 'dine_in') <> (p_table_id is not null)
    or (p_order_type = 'delivery') <> (p_platform is not null)
    or (p_order_type = 'delivery' and (
      p_platform not in ('direct','shopee_food','grab_food','gojek','be') or p_fee is null
      or p_fee not between 0 and 9007199254740991
    )) then
    raise exception 'FNB_SERVICE_INVALID' using errcode = '22023';
  end if;

  select * into v_order from public.kitchen_orders
    where id = p_order_id and tenant_id = v_tenant
      and public.user_has_branch_access(v_actor, branch_id) is true
      and public._staff_permission_at_scope(v_actor, 'pos_fnb.send_kitchen', branch_id) is true
    for update;
  if not found then raise exception 'FNB_SERVICE_DENIED' using errcode = '42501'; end if;
  if v_order.invoice_id is not null or v_order.merged_into_id is not null
    or v_order.status not in ('pending','preparing','ready','served') then
    raise exception 'FNB_SERVICE_CLOSED';
  end if;

  if v_order.order_type = p_order_type then
    -- A retry of a committed request returns the saved state without moving a table twice.
    if v_order.table_id is distinct from p_table_id
      or (p_order_type = 'delivery' and (
        v_order.delivery_platform is distinct from p_platform
        or v_order.delivery_distance_tier is distinct from p_tier
        or (coalesce(p_tier, 'custom') = 'custom' and v_order.delivery_fee is distinct from p_fee)
      )) then
      raise exception 'FNB_SERVICE_STALE' using errcode = 'PT409';
    end if;
  else
    if v_order.order_type is distinct from p_expected_type then
      raise exception 'FNB_SERVICE_STALE' using errcode = 'PT409';
    end if;
    if v_order.delivery_completed_at is not null then raise exception 'FNB_SERVICE_DELIVERED'; end if;

    if p_order_type = 'delivery' and p_platform = 'direct' then
      v_policy := public.get_fnb_delivery_price_policy(v_order.branch_id);
      if (v_policy->>'revision')::bigint is distinct from p_policy_revision then
        raise exception 'FNB_SERVICE_POLICY_CHANGED' using errcode = 'PT409';
      end if;
      if coalesce((v_policy->>'enabled')::boolean, false) and (
        p_tier is distinct from 'custom' or not exists (
          select 1 from jsonb_array_elements(v_policy->'rules') rule
          where (rule->>'enabled')::boolean and (rule->>'fee')::numeric = p_fee
        )
      ) then raise exception 'FNB_SERVICE_FEE_INVALID' using errcode = '22023'; end if;
    end if;

    perform id from public.restaurant_tables
      where tenant_id = v_tenant and branch_id = v_order.branch_id
        and id in (v_order.table_id, p_table_id)
      order by id for update;

    if p_table_id is not null then
      select * into v_table from public.restaurant_tables
        where id = p_table_id and tenant_id = v_tenant and branch_id = v_order.branch_id;
      if not found or not coalesce(v_table.is_active, true) or v_table.status <> 'available'
        or v_table.current_order_id is not null or exists (
          select 1 from public.kitchen_orders
          where tenant_id = v_tenant and branch_id = v_order.branch_id and table_id = p_table_id
            and invoice_id is null and merged_into_id is null and status in ('pending','preparing','ready','served')
        ) then raise exception 'FNB_SERVICE_TABLE_UNAVAILABLE' using errcode = 'PT409'; end if;
    end if;

    update public.kitchen_orders set order_type = p_order_type, table_id = p_table_id,
      original_table_id = coalesce(original_table_id, v_order.table_id),
      delivery_platform = p_platform, delivery_fee = 0, delivery_distance_tier = null,
      platform_commission = 0, platform_commission_percent = 0, platform_commission_amount = 0,
      delivery_staff_id = null, delivery_assigned_at = null,
      delivery_address = null, delivery_phone = null, delivery_recipient = null,
      updated_at = clock_timestamp()
      where id = v_order.id;

    if p_order_type = 'delivery' then
      v_pricing := public.fnb_set_delivery_pricing_v2(v_order.id, p_platform, p_fee, null, p_tier);
    end if;

    if v_order.table_id is not null then
      select id into v_remaining from public.kitchen_orders
        where tenant_id = v_tenant and branch_id = v_order.branch_id and table_id = v_order.table_id
          and invoice_id is null and merged_into_id is null and status in ('pending','preparing','ready','served')
        order by created_at, id limit 1;
      update public.restaurant_tables set
        status = case when v_remaining is null then 'available' else 'occupied' end,
        current_order_id = v_remaining, updated_at = clock_timestamp()
        where id = v_order.table_id and tenant_id = v_tenant and branch_id = v_order.branch_id;
    end if;
    if p_table_id is not null then
      update public.restaurant_tables set status = 'occupied', current_order_id = v_order.id,
        updated_at = clock_timestamp() where id = p_table_id;
    end if;

    insert into public.audit_log(tenant_id, user_id, action, entity_type, entity_id, old_data, new_data)
      values (v_tenant, v_actor, 'fnb_order_service_change', 'kitchen_order', v_order.id,
        jsonb_build_object('order_type',v_order.order_type,'table_id',v_order.table_id,'delivery_platform',v_order.delivery_platform,
          'delivery_fee',v_order.delivery_fee,'delivery_staff_id',v_order.delivery_staff_id),
        jsonb_build_object('order_type',p_order_type,'table_id',p_table_id,'delivery_platform',p_platform,
          'delivery_fee',coalesce((v_pricing->>'delivery_fee')::numeric,0)));
    v_changed := true;
    select * into v_order from public.kitchen_orders where id = p_order_id;
  end if;

  return jsonb_build_object('id',v_order.id,'changed',v_changed,'order_type',v_order.order_type,
    'table_id',v_order.table_id,'delivery_platform',v_order.delivery_platform,'delivery_fee',v_order.delivery_fee,
    'platform_commission_percent',v_order.platform_commission_percent,'delivery_distance_tier',v_order.delivery_distance_tier,
    'delivery_staff_id',v_order.delivery_staff_id);
end $$;

revoke all on function public.fnb_change_bill_service_v1(uuid,text,text,uuid,text,numeric,text,bigint) from public, anon;
grant execute on function public.fnb_change_bill_service_v1(uuid,text,text,uuid,text,numeric,text,bigint) to authenticated;
commit;
