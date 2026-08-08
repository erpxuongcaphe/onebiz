-- ============================================================
-- 00303 — GIAI DOAN 1: NEN TUONG THICH TOPPING F&B
-- CEO chot 07/08/2026. Sinh tu dong tu 00251 (khong chep tay).
--
-- DAY CHI LA NEN. CHUA cho giao dien gui SKU-TPP chinh thuc.
--    Ly do: ham thanh toan hien tai van co the tru THANG ton SKU mon neu
--    BOM bi tat SAU khi da gui bep. Viec do thuoc GIAI DOAN 2.
--
-- LAM:
--   1. Bo dieu kien cung NVL-TOP% khoi cau tra topping; phan luong ro rang
--   2. Luong cu NVL-TOP% van nhan (dung tenant + dang bat)
--   3. Luong moi chi nhan SKU kenh fnb CO BOM THAT dang ap dung cho chi
--      nhanh (get_active_bom_for_branch), KHONG tin co products.has_bom
--   4. Snapshot ghi CA 'productId' lan 'product_id' (tuong thich tam thoi)
--      + 'isLegacy' + 'bomId' (chi ghi nhan, chua dung)
--   5. Ghi audit_log 'legacy_topping' — MOT dong moi lan gui
--
-- KHONG LAM:
--   x KHONG chan NVL-TOP%        x KHONG tat nhom tuy chon Topping
--   x KHONG dung ham thanh toan  x KHONG dung du lieu kinh doanh
--   x KHONG doi don vi ton kho
--
-- Gia topping van luon lay tu products.sell_price cua may chu; guard
-- TOPPING_PRICE_CHANGED giu nguyen — khong tin gia trinh duyet gui len.
--
-- KHOI PHUC: chay 00303_rollback_fnb_topping_compat_phase1.sql
-- ============================================================

begin;

-- ── CHOT VAN TAY: ban dang cai phai DUNG bang ban da preflight ─────────
-- Neu ai do da sua ham nay sau preflight, migration DUNG, khong ghi de.
do $guard$
begin
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.proname = 'fnb_send_to_kitchen_atomic_v2'
      and md5(pg_get_functiondef(p.oid)) = '695f1b1bfd4cd967297d9b7e75345a4c'
  ) then
    raise exception
      'DUNG — VAN TAY KHONG KHOP. fnb_send_to_kitchen_atomic_v2 dang cai KHAC ban da preflight (%). Chay lai preflight roi sinh lai 00303.',
      '695f1b1bfd4cd967297d9b7e75345a4c'
      using errcode = 'P0001';
  end if;
end
$guard$;

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
  -- 00303 (Giai đoạn 1): phân luồng topping cũ/mới + ghi vết.
  v_topping_is_legacy boolean;
  v_topping_bom_id uuid;
  v_legacy_topping_codes text[] := '{}';
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

      -- 00303: bỏ điều kiện cứng NVL-TOP% khỏi câu tra; phân luồng ở dưới.
      select p.id, p.name, p.sell_price, p.code, p.product_type, p.channel
        into v_topping_product
        from public.products p
       where p.id = nullif(v_topping->>'productId', '')::uuid
         and p.tenant_id = v_tenant_id
         and p.is_active;
      if not found then
        raise exception 'TOPPING_NOT_AVAILABLE' using errcode = 'P0001';
      end if;

      -- 00303 — PHAN LUONG TOPPING (Giai doan 1: nhan CA HAI, chua chan cu)
      --  * LUONG CU  : ma NVL-TOP% -> nhan tam, ghi vet legacy_topping.
      --  * LUONG MOI : SKU kenh fnb -> CHI nhan khi tim duoc BOM THAT dang
      --                ap dung cho chi nhanh. KHONG tin co products.has_bom:
      --                5 ma SKU-TOP dang has_bom=true nhung BOM toan cuc
      --                is_active=false -> co noi doi o moi chi nhanh khac.
      --  * Con lai   : tu choi.
      if v_topping_product.code ilike 'NVL-TOP%' then
        v_topping_is_legacy := true;
        v_topping_bom_id := null;
        v_legacy_topping_codes := v_legacy_topping_codes || v_topping_product.code;
      elsif v_topping_product.product_type = 'sku'
            and v_topping_product.channel = 'fnb' then
        v_topping_is_legacy := false;
        v_topping_bom_id := public.get_active_bom_for_branch(
          v_topping_product.id, p_branch_id, null
        );
        if v_topping_bom_id is null then
          raise exception 'TOPPING_BOM_MISSING:%', v_topping_product.name
            using errcode = 'P0001';
        end if;
      else
        raise exception 'TOPPING_NOT_ELIGIBLE:%', v_topping_product.name
          using errcode = 'P0001';
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
          -- 00303 TUONG THICH TAM THOI — KHONG PHAI THIET KE LAU DAI.
          -- Ham thanh toan dang doc 'product_id'; ghi them khoa nay de no
          -- lay duoc ma topping ma KHONG phai chep lai 20.106 ky tu ham tien.
          -- KE HOACH BO: sau khi Giai doan 2 hoan tat, migration Giai doan 2
          -- phai XOA dong 'product_id' nay.
          'product_id', v_topping_product.id,
          'name', v_topping_product.name,
          'quantity', v_topping_qty,
          'price', v_topping_price,
          -- Hai khoa duoi CHI DE GHI NHAN, CHUA DUOC DUNG de tru kho.
          -- Chung KHONG giai quyet tinh huong BOM bi tat sau khi gui bep —
          -- viec do thuoc Giai doan 2.
          'isLegacy', v_topping_is_legacy,
          'bomId', v_topping_bom_id
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

  -- 00303: ghi vet luong cu — DUNG MOT DONG cho moi lan gui (ke ca gui bo
  -- sung), kem danh sach ma. KHONG ghi tung topping de audit_log khong phinh.
  -- Dung de biet bao gio luong NVL-TOP% het phat sinh -> moi sang Giai doan 2.
  if array_length(v_legacy_topping_codes, 1) > 0 then
    insert into public.audit_log (
      tenant_id, user_id, action, entity_type, entity_id, new_data
    ) values (
      v_tenant_id, v_actor, 'legacy_topping', 'kitchen_order', v_order_id,
      jsonb_build_object(
        'ly_do', 'Topping con dung ma nguyen lieu NVL-TOP (luong cu)',
        'branch_id', p_branch_id,
        'ma_topping', to_jsonb(v_legacy_topping_codes),
        'so_luot', array_length(v_legacy_topping_codes, 1)
      )
    );
  end if;

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

commit;

-- ============================================================
-- SAU KHI CHAY — kiem nhanh (chi doc):
--
--   select md5(pg_get_functiondef(p.oid)) as van_tay_moi,
--          (pg_get_functiondef(p.oid) like '%TOPPING_BOM_MISSING%') as co_guard_bom,
--          (pg_get_functiondef(p.oid) like '%legacy_topping%')      as co_ghi_vet
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname='public' and p.prokind='f'
--     and p.proname='fnb_send_to_kitchen_atomic_v2';
--
--   -- Theo doi luong cu con phat sinh khong:
--   select date_trunc('day', created_at) as ngay, count(*) as so_lan_gui
--   from public.audit_log where action = 'legacy_topping'
--   group by 1 order by 1 desc;
-- ============================================================
