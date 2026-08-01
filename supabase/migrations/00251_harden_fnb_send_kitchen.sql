-- ============================================================
-- 00251: Harden F&B send-to-kitchen
--
-- Function definitions and grants only. Applying this migration does not
-- update existing business rows.
--
-- New orders are built from trusted catalog data in one transaction:
-- - actor and tenant come from auth.uid();
-- - permission and branch access are checked server-side;
-- - product, variant, topping and modifier snapshots are rebuilt from DB;
-- - stale/tampered prices fail closed unless actor has pos_fnb.edit_price;
-- - delivery metadata is persisted with the order, not as follow-up writes.
-- ============================================================

begin;

-- Migration 00138 used one unique (order, batch) value on every item row.
-- A batch containing two different items therefore conflicted with itself.
-- Keep item.batch_id for traceability and move idempotency to one row per batch.
drop index if exists public.uniq_kitchen_order_items_batch;
create index if not exists idx_kitchen_order_items_batch
  on public.kitchen_order_items(kitchen_order_id, batch_id)
  where batch_id is not null;

create table if not exists public.fnb_kitchen_item_batches (
  id uuid primary key default extensions.uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  kitchen_order_id uuid not null
    references public.kitchen_orders(id) on delete cascade,
  batch_key text not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint fnb_kitchen_item_batches_order_key_unique
    unique (kitchen_order_id, batch_key)
);

alter table public.fnb_kitchen_item_batches enable row level security;
revoke all on table public.fnb_kitchen_item_batches
  from public, anon, authenticated;

create or replace function public.fnb_send_to_kitchen_atomic_v2(
  p_branch_id uuid,
  p_table_id uuid default null,
  p_order_type text default 'dine_in',
  p_note text default null,
  p_idempotency_key text default null,
  p_items jsonb default '[]'::jsonb,
  p_delivery_platform text default null,
  p_delivery_fee numeric default 0,
  p_platform_commission_percent numeric default null,
  p_delivery_staff_id uuid default null,
  p_delivery_distance_tier text default null,
  p_existing_order_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_tenant_settings jsonb := '{}'::jsonb;
  v_order_id uuid;
  v_order_number text;
  v_existing record;
  v_existing_order record;
  v_batch_row_id uuid;
  v_item_batch_id uuid;
  v_item jsonb;
  v_product record;
  v_variant_id uuid;
  v_variant_name text;
  v_variant_price numeric;
  v_station_id uuid;
  v_quantity numeric;
  v_base_price numeric;
  v_expected_unit_price numeric;
  v_submitted_unit_price numeric;
  v_final_unit_price numeric;
  v_modifier_extra numeric;
  v_modifier_snapshot jsonb;
  v_selection jsonb;
  v_selection_option jsonb;
  v_group record;
  v_option record;
  v_options_snapshot jsonb;
  v_selected_count int;
  v_seen_group_ids uuid[];
  v_seen_option_ids uuid[];
  v_group_id uuid;
  v_option_id uuid;
  v_toppings_snapshot jsonb;
  v_topping jsonb;
  v_topping_product record;
  v_topping_qty numeric;
  v_topping_price numeric;
  v_submitted_topping_price numeric;
  v_claimed int;
  v_platform text;
  v_delivery_fee numeric := 0;
  v_default_commission numeric := 0;
  v_commission_percent numeric := 0;
  v_can_edit_price boolean := false;
  v_price_overrides jsonb := '[]'::jsonb;
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;

  select p.tenant_id, coalesce(t.settings, '{}'::jsonb)
    into v_tenant_id, v_tenant_settings
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
  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'KITCHEN_ORDER_ITEMS_REQUIRED' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'TOO_MANY_ORDER_ITEMS' using errcode = 'P0001';
  end if;

  v_can_edit_price := public.user_has_permission(v_actor, 'pos_fnb.edit_price');
  v_item_batch_id := null;

  if p_existing_order_id is not null then
    select
      ko.id,
      ko.order_number,
      ko.branch_id,
      ko.table_id,
      ko.order_type,
      ko.status,
      ko.invoice_id,
      ko.delivery_platform,
      ko.delivery_fee,
      ko.platform_commission_percent,
      ko.delivery_staff_id,
      ko.delivery_distance_tier
      into v_existing_order
      from public.kitchen_orders ko
     where ko.id = p_existing_order_id
       and ko.tenant_id = v_tenant_id
     for update;
    if not found then
      raise exception 'KITCHEN_ORDER_NOT_FOUND' using errcode = 'P0001';
    end if;
    if not public.user_has_branch_access(v_actor, v_existing_order.branch_id) then
      raise exception 'BRANCH_ACCESS_DENIED' using errcode = 'P0001';
    end if;
    if v_existing_order.invoice_id is not null
       or v_existing_order.status in ('completed', 'cancelled') then
      raise exception 'KITCHEN_ORDER_CLOSED' using errcode = 'P0001';
    end if;
    if nullif(p_idempotency_key, '') is null then
      raise exception 'ITEM_BATCH_KEY_REQUIRED' using errcode = 'P0001';
    end if;

    p_branch_id := v_existing_order.branch_id;
    p_table_id := v_existing_order.table_id;
    p_order_type := v_existing_order.order_type;
    v_order_id := v_existing_order.id;
    v_order_number := v_existing_order.order_number;
    v_platform := case
      when p_order_type = 'delivery'
        then coalesce(v_existing_order.delivery_platform, 'direct')
      else null
    end;
    v_delivery_fee := coalesce(v_existing_order.delivery_fee, 0);
    v_commission_percent := coalesce(
      v_existing_order.platform_commission_percent,
      0
    );

    insert into public.fnb_kitchen_item_batches (
      tenant_id,
      branch_id,
      kitchen_order_id,
      batch_key,
      created_by
    ) values (
      v_tenant_id,
      p_branch_id,
      v_order_id,
      p_idempotency_key,
      v_actor
    )
    on conflict (kitchen_order_id, batch_key) do nothing
    returning id into v_batch_row_id;

    if v_batch_row_id is null then
      return jsonb_build_object(
        'kitchen_order_id', v_order_id,
        'order_number', v_order_number,
        'idempotent', true,
        'items_added', 0
      );
    end if;

    begin
      v_item_batch_id := p_idempotency_key::uuid;
    exception when invalid_text_representation then
      v_item_batch_id := null;
    end;
  else
    if not public.user_has_branch_access(v_actor, p_branch_id) then
      raise exception 'BRANCH_ACCESS_DENIED' using errcode = 'P0001';
    end if;
    if not exists (
      select 1
        from public.branches b
       where b.id = p_branch_id
         and b.tenant_id = v_tenant_id
         and coalesce(b.is_active, true)
    ) then
      raise exception 'BRANCH_NOT_FOUND' using errcode = 'P0001';
    end if;
    if p_order_type not in ('dine_in', 'takeaway', 'delivery') then
      raise exception 'INVALID_ORDER_TYPE' using errcode = 'P0001';
    end if;
    if length(coalesce(p_note, '')) > 2000 then
      raise exception 'ORDER_NOTE_TOO_LONG' using errcode = 'P0001';
    end if;

    if p_order_type = 'delivery' then
      v_platform := coalesce(nullif(p_delivery_platform, ''), 'direct');
      if v_platform not in ('shopee_food', 'grab_food', 'gojek', 'be', 'direct') then
        raise exception 'INVALID_DELIVERY_PLATFORM' using errcode = 'P0001';
      end if;

      if coalesce(
        (v_tenant_settings #>> array[
          'fnb_delivery_platforms', v_platform, 'active'
        ])::boolean,
        true
      ) is false then
        raise exception 'DELIVERY_PLATFORM_DISABLED' using errcode = 'P0001';
      end if;

      v_default_commission := coalesce(
        (v_tenant_settings #>> array[
          'fnb_delivery_platforms', v_platform, 'commissionPercent'
        ])::numeric,
        case v_platform
          when 'shopee_food' then 25
          when 'grab_food' then 25
          when 'gojek' then 25
          when 'be' then 20
          else 0
        end
      );
      v_commission_percent := coalesce(
        p_platform_commission_percent,
        v_default_commission
      );
      if v_commission_percent < 0 or v_commission_percent > 100 then
        raise exception 'INVALID_PLATFORM_COMMISSION' using errcode = 'P0001';
      end if;
      if abs(v_commission_percent - v_default_commission) > 0.01
         and not v_can_edit_price then
        raise exception 'PLATFORM_COMMISSION_OVERRIDE_DENIED' using errcode = 'P0001';
      end if;

      if p_delivery_distance_tier is not null
         and p_delivery_distance_tier not in ('near', 'mid', 'far', 'custom') then
        raise exception 'INVALID_DELIVERY_DISTANCE_TIER' using errcode = 'P0001';
      end if;

      if p_delivery_distance_tier in ('near', 'mid', 'far') then
        select ft.fee
          into v_delivery_fee
          from public.fnb_delivery_fee_tiers ft
         where ft.tenant_id = v_tenant_id
           and ft.tier_code = p_delivery_distance_tier
           and ft.is_active
           and (ft.branch_id = p_branch_id or ft.branch_id is null)
         order by (ft.branch_id = p_branch_id) desc
         limit 1;
        if not found then
          raise exception 'DELIVERY_FEE_TIER_NOT_CONFIGURED' using errcode = 'P0001';
        end if;
      else
        v_delivery_fee := coalesce(p_delivery_fee, 0);
      end if;
      if v_delivery_fee < 0 then
        raise exception 'INVALID_DELIVERY_FEE' using errcode = 'P0001';
      end if;

      if p_delivery_staff_id is not null and not exists (
        select 1
          from public.profiles sp
         where sp.id = p_delivery_staff_id
           and sp.tenant_id = v_tenant_id
           and coalesce(sp.is_active, true)
           and public.user_has_branch_access(sp.id, p_branch_id)
      ) then
        raise exception 'DELIVERY_STAFF_NOT_AVAILABLE_FOR_BRANCH' using errcode = 'P0001';
      end if;
    else
      v_platform := null;
      v_delivery_fee := 0;
      v_commission_percent := 0;
      p_delivery_staff_id := null;
      p_delivery_distance_tier := null;
    end if;

    if p_order_type = 'dine_in' and p_table_id is not null then
      if not exists (
        select 1
          from public.restaurant_tables rt
         where rt.id = p_table_id
           and rt.tenant_id = v_tenant_id
           and rt.branch_id = p_branch_id
           and rt.is_active
      ) then
        raise exception 'TABLE_NOT_FOUND_FOR_BRANCH' using errcode = 'P0001';
      end if;
    elsif p_order_type <> 'dine_in' then
      p_table_id := null;
    end if;

    if p_existing_order_id is null
       and nullif(p_idempotency_key, '') is not null then
      select ko.id, ko.order_number
        into v_existing
        from public.kitchen_orders ko
       where ko.tenant_id = v_tenant_id
         and ko.branch_id = p_branch_id
         and ko.created_by = v_actor
         and ko.idempotency_key = p_idempotency_key
       limit 1;
      if found then
        return jsonb_build_object(
          'kitchen_order_id', v_existing.id,
          'order_number', v_existing.order_number,
          'idempotent', true
        );
      end if;
    end if;

    v_order_number := public.next_code(v_tenant_id, 'kitchen_order');
    if nullif(v_order_number, '') is null then
      v_order_number := 'KB' || extract(epoch from clock_timestamp())::bigint::text;
    end if;

    insert into public.kitchen_orders (
      tenant_id,
      branch_id,
      table_id,
      order_number,
      order_type,
      note,
      created_by,
      idempotency_key,
      delivery_platform,
      delivery_fee,
      platform_commission,
      platform_commission_percent,
      delivery_staff_id,
      delivery_distance_tier,
      delivery_assigned_at
    ) values (
      v_tenant_id,
      p_branch_id,
      p_table_id,
      v_order_number,
      p_order_type,
      nullif(trim(p_note), ''),
      v_actor,
      nullif(p_idempotency_key, ''),
      v_platform,
      v_delivery_fee,
      0,
      v_commission_percent,
      p_delivery_staff_id,
      p_delivery_distance_tier,
      case when p_delivery_staff_id is not null then now() else null end
    )
    returning id into v_order_id;
  end if;

  for v_item in
    select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'INVALID_ORDER_ITEM' using errcode = 'P0001';
    end if;

    begin
      v_quantity := (v_item->>'quantity')::numeric;
    exception when others then
      raise exception 'INVALID_ITEM_QUANTITY' using errcode = 'P0001';
    end;
    if v_quantity <= 0
       or v_quantity > 1000
       or v_quantity <> trunc(v_quantity) then
      raise exception 'INVALID_ITEM_QUANTITY' using errcode = 'P0001';
    end if;

    select
      p.id,
      p.name,
      p.category_id,
      p.sell_price,
      c.kitchen_station_id
      into v_product
      from public.products p
      left join public.categories c
        on c.id = p.category_id
       and c.tenant_id = p.tenant_id
     where p.id = nullif(v_item->>'productId', '')::uuid
       and p.tenant_id = v_tenant_id
       and p.is_active
       and p.allow_sale;
    if not found then
      raise exception 'PRODUCT_NOT_AVAILABLE' using errcode = 'P0001';
    end if;
    v_station_id := v_product.kitchen_station_id;

    v_variant_id := null;
    v_variant_name := null;
    v_variant_price := null;
    v_base_price := null;
    if nullif(v_item->>'variantId', '') is not null then
      select pv.id, pv.name, pv.sell_price
        into v_variant_id, v_variant_name, v_variant_price
        from public.product_variants pv
       where pv.id = (v_item->>'variantId')::uuid
         and pv.product_id = v_product.id
         and pv.tenant_id = v_tenant_id
         and pv.is_active;
      if not found then
        raise exception 'PRODUCT_VARIANT_NOT_AVAILABLE' using errcode = 'P0001';
      end if;
      v_base_price := v_variant_price;
    elsif p_order_type = 'delivery' and v_platform <> 'direct' then
      select ppp.override_price
        into v_base_price
        from public.product_platform_prices ppp
       where ppp.tenant_id = v_tenant_id
         and ppp.product_id = v_product.id
         and ppp.platform = v_platform;
      v_base_price := coalesce(v_base_price, v_product.sell_price);
    else
      v_base_price := v_product.sell_price;
    end if;

    if v_item ? 'modifierSelections'
       and v_item->'modifierSelections' is not null
       and jsonb_typeof(v_item->'modifierSelections') <> 'array' then
      raise exception 'INVALID_MODIFIER_SELECTIONS' using errcode = 'P0001';
    end if;

    v_modifier_extra := 0;
    v_modifier_snapshot := '[]'::jsonb;
    v_seen_group_ids := array[]::uuid[];

    for v_group in
      select distinct
        mg.id,
        mg.name,
        coalesce(pmg.rule_override, mg.rule) as effective_rule
      from public.modifier_groups mg
      left join public.product_modifier_groups pmg
        on pmg.modifier_group_id = mg.id
       and pmg.product_id = v_product.id
       and pmg.tenant_id = v_tenant_id
      left join public.category_modifier_groups cmg
        on cmg.modifier_group_id = mg.id
       and cmg.category_id = v_product.category_id
       and cmg.tenant_id = v_tenant_id
      where mg.tenant_id = v_tenant_id
        and mg.is_active
        and mg.channel in ('fnb', 'all')
        and (pmg.id is not null or cmg.id is not null)
        and coalesce(pmg.rule_override, mg.rule) = 'single_required'
    loop
      if not exists (
        select 1
          from jsonb_array_elements(
            coalesce(v_item->'modifierSelections', '[]'::jsonb)
          ) s
         where s->>'groupId' = v_group.id::text
           and jsonb_typeof(s->'options') = 'array'
           and jsonb_array_length(s->'options') = 1
      ) then
        raise exception 'REQUIRED_MODIFIER_MISSING:%', v_group.name
          using errcode = 'P0001';
      end if;
    end loop;

    for v_selection in
      select value
        from jsonb_array_elements(
          coalesce(v_item->'modifierSelections', '[]'::jsonb)
        )
    loop
      begin
        v_group_id := (v_selection->>'groupId')::uuid;
      exception when others then
        raise exception 'INVALID_MODIFIER_GROUP' using errcode = 'P0001';
      end;
      if v_group_id = any(v_seen_group_ids) then
        raise exception 'DUPLICATE_MODIFIER_GROUP' using errcode = 'P0001';
      end if;
      v_seen_group_ids := array_append(v_seen_group_ids, v_group_id);

      select distinct
        mg.id,
        mg.name,
        coalesce(pmg.rule_override, mg.rule) as effective_rule
        into v_group
        from public.modifier_groups mg
        left join public.product_modifier_groups pmg
          on pmg.modifier_group_id = mg.id
         and pmg.product_id = v_product.id
         and pmg.tenant_id = v_tenant_id
        left join public.category_modifier_groups cmg
          on cmg.modifier_group_id = mg.id
         and cmg.category_id = v_product.category_id
         and cmg.tenant_id = v_tenant_id
       where mg.id = v_group_id
         and mg.tenant_id = v_tenant_id
         and mg.is_active
         and mg.channel in ('fnb', 'all')
         and (pmg.id is not null or cmg.id is not null)
       limit 1;
      if not found then
        raise exception 'MODIFIER_GROUP_NOT_APPLICABLE' using errcode = 'P0001';
      end if;
      if jsonb_typeof(v_selection->'options') <> 'array' then
        raise exception 'INVALID_MODIFIER_OPTIONS' using errcode = 'P0001';
      end if;

      v_selected_count := jsonb_array_length(v_selection->'options');
      if v_group.effective_rule in ('single', 'single_required')
         and v_selected_count > 1 then
        raise exception 'TOO_MANY_MODIFIER_OPTIONS:%', v_group.name
          using errcode = 'P0001';
      end if;
      if v_group.effective_rule = 'single_required'
         and v_selected_count <> 1 then
        raise exception 'REQUIRED_MODIFIER_MISSING:%', v_group.name
          using errcode = 'P0001';
      end if;

      v_options_snapshot := '[]'::jsonb;
      v_seen_option_ids := array[]::uuid[];
      for v_selection_option in
        select value from jsonb_array_elements(v_selection->'options')
      loop
        begin
          v_option_id := (v_selection_option->>'optionId')::uuid;
        exception when others then
          raise exception 'INVALID_MODIFIER_OPTION' using errcode = 'P0001';
        end;
        if v_option_id = any(v_seen_option_ids) then
          raise exception 'DUPLICATE_MODIFIER_OPTION' using errcode = 'P0001';
        end if;
        v_seen_option_ids := array_append(v_seen_option_ids, v_option_id);

        select
          mo.id,
          mo.label,
          mo.price_delta,
          mo.scale_factor,
          case
            when linked.tenant_id = v_tenant_id then mo.linked_product_id
            else null
          end as linked_product_id
          into v_option
          from public.modifier_options mo
          left join public.products linked on linked.id = mo.linked_product_id
         where mo.id = v_option_id
           and mo.group_id = v_group.id
           and mo.is_active;
        if not found then
          raise exception 'MODIFIER_OPTION_NOT_AVAILABLE' using errcode = 'P0001';
        end if;

        v_modifier_extra := v_modifier_extra + coalesce(v_option.price_delta, 0);
        v_options_snapshot := v_options_snapshot || jsonb_build_array(
          jsonb_build_object(
            'optionId', v_option.id,
            'label', v_option.label,
            'scaleFactor', v_option.scale_factor,
            'priceDelta', v_option.price_delta,
            'linkedProductId', v_option.linked_product_id
          )
        );
      end loop;

      v_modifier_snapshot := v_modifier_snapshot || jsonb_build_array(
        jsonb_build_object(
          'groupId', v_group.id,
          'groupName', v_group.name,
          'rule', v_group.effective_rule,
          'options', v_options_snapshot
        )
      );
    end loop;

    v_expected_unit_price := v_base_price + v_modifier_extra;
    begin
      v_submitted_unit_price := (v_item->>'unitPrice')::numeric;
    exception when others then
      raise exception 'INVALID_ITEM_PRICE' using errcode = 'P0001';
    end;
    if v_submitted_unit_price < 0 then
      raise exception 'INVALID_ITEM_PRICE' using errcode = 'P0001';
    end if;

    if abs(v_submitted_unit_price - v_expected_unit_price) > 0.01 then
      if not v_can_edit_price then
        raise exception 'PRICE_CHANGED:%:%:%',
          v_product.name,
          v_submitted_unit_price,
          v_expected_unit_price
          using errcode = 'P0001';
      end if;
      v_final_unit_price := v_submitted_unit_price;
      v_price_overrides := v_price_overrides || jsonb_build_array(
        jsonb_build_object(
          'product_id', v_product.id,
          'submitted_price', v_submitted_unit_price,
          'catalog_price', v_expected_unit_price
        )
      );
    else
      v_final_unit_price := v_expected_unit_price;
    end if;

    if v_item ? 'toppings'
       and v_item->'toppings' is not null
       and jsonb_typeof(v_item->'toppings') <> 'array' then
      raise exception 'INVALID_TOPPINGS' using errcode = 'P0001';
    end if;

    v_toppings_snapshot := '[]'::jsonb;
    for v_topping in
      select value
        from jsonb_array_elements(coalesce(v_item->'toppings', '[]'::jsonb))
    loop
      begin
        v_topping_qty := (v_topping->>'quantity')::numeric;
      exception when others then
        raise exception 'INVALID_TOPPING_QUANTITY' using errcode = 'P0001';
      end;
      if v_topping_qty <= 0
         or v_topping_qty > 100
         or v_topping_qty <> trunc(v_topping_qty) then
        raise exception 'INVALID_TOPPING_QUANTITY' using errcode = 'P0001';
      end if;

      select p.id, p.name, p.sell_price
        into v_topping_product
        from public.products p
       where p.id = nullif(v_topping->>'productId', '')::uuid
         and p.tenant_id = v_tenant_id
         and p.is_active
         and p.code ilike 'NVL-TOP%';
      if not found then
        raise exception 'TOPPING_NOT_AVAILABLE' using errcode = 'P0001';
      end if;

      v_topping_price := v_topping_product.sell_price;
      begin
        v_submitted_topping_price := (v_topping->>'price')::numeric;
      exception when others then
        raise exception 'INVALID_TOPPING_PRICE' using errcode = 'P0001';
      end;
      if v_submitted_topping_price < 0 then
        raise exception 'INVALID_TOPPING_PRICE' using errcode = 'P0001';
      end if;
      if abs(v_submitted_topping_price - v_topping_price) > 0.01 then
        if not v_can_edit_price then
          raise exception 'TOPPING_PRICE_CHANGED:%:%:%',
            v_topping_product.name,
            v_submitted_topping_price,
            v_topping_price
            using errcode = 'P0001';
        end if;
        v_topping_price := v_submitted_topping_price;
        v_price_overrides := v_price_overrides || jsonb_build_array(
          jsonb_build_object(
            'product_id', v_topping_product.id,
            'submitted_price', v_submitted_topping_price,
            'catalog_price', v_topping_product.sell_price,
            'kind', 'topping'
          )
        );
      end if;

      v_toppings_snapshot := v_toppings_snapshot || jsonb_build_array(
        jsonb_build_object(
          'productId', v_topping_product.id,
          'name', v_topping_product.name,
          'quantity', v_topping_qty,
          'price', v_topping_price
        )
      );
    end loop;

    insert into public.kitchen_order_items (
      kitchen_order_id,
      product_id,
      product_name,
      variant_id,
      variant_label,
      quantity,
      unit_price,
      note,
      toppings,
      kitchen_station_id,
      modifier_selections,
      batch_id
    ) values (
      v_order_id,
      v_product.id,
      v_product.name,
      v_variant_id,
      v_variant_name,
      v_quantity::int,
      v_final_unit_price,
      nullif(trim(v_item->>'note'), ''),
      case
        when jsonb_array_length(v_toppings_snapshot) > 0
          then v_toppings_snapshot
        else null
      end,
      v_station_id,
      case
        when jsonb_array_length(v_modifier_snapshot) > 0
          then v_modifier_snapshot
        else null
      end,
      v_item_batch_id
    );
  end loop;

  if p_existing_order_id is null
     and p_order_type = 'dine_in'
     and p_table_id is not null then
    update public.restaurant_tables
       set status = 'occupied',
           current_order_id = v_order_id,
           updated_at = now()
     where id = p_table_id
       and tenant_id = v_tenant_id
       and branch_id = p_branch_id
       and status = 'available'
       and is_active;
    get diagnostics v_claimed = row_count;
    if v_claimed = 0 then
      raise exception 'TABLE_NOT_AVAILABLE' using errcode = 'P0001';
    end if;
  end if;

  insert into public.audit_log (
    tenant_id,
    user_id,
    action,
    entity_type,
    entity_id,
    new_data
  ) values (
    v_tenant_id,
    v_actor,
    case
      when p_existing_order_id is null then 'fnb_send_to_kitchen'
      else 'fnb_add_kitchen_items'
    end,
    'kitchen_order',
    v_order_id,
    jsonb_build_object(
      'branch_id', p_branch_id,
      'order_type', p_order_type,
      'item_count', jsonb_array_length(p_items),
      'delivery_platform', v_platform,
      'delivery_fee', v_delivery_fee,
      'platform_commission_percent', v_commission_percent,
      'price_overrides', v_price_overrides
    )
  );

  return jsonb_build_object(
    'kitchen_order_id', v_order_id,
    'order_number', v_order_number,
    'items_added', jsonb_array_length(p_items)
  );
exception
  when unique_violation then
    if nullif(p_idempotency_key, '') is not null then
      select ko.id, ko.order_number
        into v_existing
        from public.kitchen_orders ko
       where ko.tenant_id = v_tenant_id
         and ko.branch_id = p_branch_id
         and ko.created_by = v_actor
         and ko.idempotency_key = p_idempotency_key
       limit 1;
      if found then
        return jsonb_build_object(
          'kitchen_order_id', v_existing.id,
          'order_number', v_existing.order_number,
          'idempotent', true
        );
      end if;
    end if;
    raise;
end;
$$;

-- Compatibility signature for clients deployed before this migration.
-- Tenant, actor, names and prices supplied by the client are never trusted.
create or replace function public.fnb_send_to_kitchen_atomic(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_created_by uuid,
  p_table_id uuid default null,
  p_order_type text default 'dine_in',
  p_note text default null,
  p_idempotency_key text default null,
  p_order_number text default null,
  p_items jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  select p.tenant_id
    into v_tenant_id
    from public.profiles p
   where p.id = v_actor
     and coalesce(p.is_active, true);
  if not found then
    raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode = 'P0001';
  end if;
  if p_created_by is not null and p_created_by <> v_actor then
    raise exception 'ACTOR_SPOOF_BLOCKED' using errcode = 'P0001';
  end if;
  if p_tenant_id is not null and p_tenant_id <> v_tenant_id then
    raise exception 'TENANT_SPOOF_BLOCKED' using errcode = 'P0001';
  end if;

  return public.fnb_send_to_kitchen_atomic_v2(
    p_branch_id,
    p_table_id,
    p_order_type,
    p_note,
    p_idempotency_key,
    p_items,
    null,
    0,
    null,
    null,
    null,
    null
  );
end;
$$;

revoke all on function public.fnb_send_to_kitchen_atomic_v2(
  uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid
) from public, anon;
grant execute on function public.fnb_send_to_kitchen_atomic_v2(
  uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid
) to authenticated;

revoke all on function public.fnb_send_to_kitchen_atomic(
  uuid,uuid,uuid,uuid,text,text,text,text,jsonb
) from public, anon;
grant execute on function public.fnb_send_to_kitchen_atomic(
  uuid,uuid,uuid,uuid,text,text,text,text,jsonb
) to authenticated;

comment on function public.fnb_send_to_kitchen_atomic_v2 is
  'Secure atomic F&B order creation and supplemental-item append. Actor/tenant are derived from auth; catalog, price and delivery data are validated server-side.';

commit;

select
  to_regprocedure(
    'public.fnb_send_to_kitchen_atomic_v2(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)'
  ) is not null as send_kitchen_v2_ok,
  p.prosecdef as security_definer_ok,
  p.prosrc like '%auth.uid()%' as actor_derived_ok,
  p.prosrc like '%user_has_permission%' as permission_check_ok,
  p.prosrc like '%user_has_branch_access%' as branch_check_ok,
  p.prosrc like '%product_platform_prices%' as trusted_price_ok
from pg_proc p
where p.oid = to_regprocedure(
  'public.fnb_send_to_kitchen_atomic_v2(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)'
);
