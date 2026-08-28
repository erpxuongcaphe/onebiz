-- 00357 - FnB: save variants, per-size BOMs and exact modifier quantities atomically.
--
-- The previous web flow used multiple requests for variants, BOM headers,
-- BOM items and exact quantities. A failure in the middle could leave a size
-- half configured. This migration adds one guarded transaction and does not
-- rewrite any existing product setup when installed.

begin;

do $prerequisite$
begin
  if to_regclass('public.product_variants') is null
     or to_regclass('public.bom') is null
     or to_regclass('public.bom_items') is null
     or to_regclass('public.bom_modifier_option_quantities') is null
     or to_regprocedure('public.user_has_permission(uuid,text)') is null
     or to_regprocedure('public.save_bom_modifier_option_quantities(uuid,jsonb)') is null then
    raise exception using errcode = 'P0001', message = 'FNB_00357_PREREQUISITE_MISSING';
  end if;
end;
$prerequisite$;

create or replace function public.save_fnb_size_setup_atomic(
  p_product_id uuid,
  p_variants jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_category_id uuid;
  v_variant jsonb;
  v_item jsonb;
  v_exact_rows jsonb;
  v_variant_id uuid;
  v_bom_id uuid;
  v_material_id uuid;
  v_group_id uuid;
  v_name text;
  v_client_key text;
  v_bom_code text;
  v_bom_name text;
  v_input_unit text;
  v_input_quantity numeric;
  v_sell_price numeric;
  v_cost_price numeric;
  v_is_default boolean;
  v_kept_ids uuid[] := '{}'::uuid[];
  v_result jsonb := '[]'::jsonb;
  v_count integer;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  select p.tenant_id into v_tenant
    from public.profiles p
   where p.id = v_actor and p.is_active;
  if v_tenant is null then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if not public.user_has_permission(v_actor, 'products.edit') then
    raise exception using errcode = '42501', message = 'FNB_SIZE_SETUP_PERMISSION_DENIED';
  end if;

  select p.category_id into v_category_id
    from public.products p
   where p.id = p_product_id
     and p.tenant_id = v_tenant
     and p.product_type = 'sku'
     and p.channel = 'fnb'
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'FNB_SIZE_SETUP_PRODUCT_NOT_FNB_SKU';
  end if;

  if p_variants is null or jsonb_typeof(p_variants) <> 'array' then
    raise exception using errcode = 'P0001', message = 'FNB_SIZE_SETUP_VARIANTS_INVALID';
  end if;

  -- Validate the complete payload before changing any row.
  select count(*) into v_count from jsonb_array_elements(p_variants);
  if v_count > 0 then
    if (select count(*) from jsonb_array_elements(p_variants) v
         where nullif(trim(v->>'clientKey'), '') is null
            or nullif(trim(v->>'name'), '') is null
            or nullif(trim(v->>'bomCode'), '') is null
            or jsonb_typeof(v->'items') <> 'array'
            or jsonb_array_length(v->'items') = 0
            or jsonb_typeof(coalesce(v->'exactRows', '[]'::jsonb)) <> 'array') > 0 then
      raise exception using errcode = 'P0001', message = 'FNB_SIZE_SETUP_VARIANT_REQUIRED_FIELDS';
    end if;
    if (select count(distinct lower(trim(v->>'clientKey'))) from jsonb_array_elements(p_variants) v) <> v_count then
      raise exception using errcode = 'P0001', message = 'FNB_SIZE_SETUP_CLIENT_KEY_DUPLICATE';
    end if;
    if (select count(distinct lower(trim(v->>'name'))) from jsonb_array_elements(p_variants) v) <> v_count then
      raise exception using errcode = 'P0001', message = 'FNB_SIZE_SETUP_NAME_DUPLICATE';
    end if;
    if (select count(distinct lower(trim(v->>'bomCode'))) from jsonb_array_elements(p_variants) v) <> v_count then
      raise exception using errcode = 'P0001', message = 'FNB_SIZE_SETUP_BOM_CODE_DUPLICATE';
    end if;
    if exists (
      select 1
        from jsonb_array_elements(p_variants) v
       where nullif(v->>'id', '') is not null
       group by v->>'id'
      having count(*) > 1
    ) then
      raise exception using errcode = 'P0001', message = 'FNB_SIZE_SETUP_VARIANT_ID_DUPLICATE';
    end if;
    if (select count(*) from jsonb_array_elements(p_variants) v
         where coalesce((v->>'isDefault')::boolean, false)) <> 1 then
      raise exception using errcode = 'P0001', message = 'FNB_SIZE_SETUP_DEFAULT_INVALID';
    end if;
  end if;

  for v_variant in select value from jsonb_array_elements(p_variants)
  loop
    begin
      v_variant_id := nullif(v_variant->>'id', '')::uuid;
      v_sell_price := (v_variant->>'sellPrice')::numeric;
      v_cost_price := coalesce((v_variant->>'costPrice')::numeric, 0);
      v_is_default := coalesce((v_variant->>'isDefault')::boolean, false);
    exception when invalid_text_representation then
      raise exception using errcode = 'P0001', message = 'FNB_SIZE_SETUP_VARIANT_FORMAT_INVALID';
    end;
    if v_sell_price is null or v_sell_price <= 0 or v_cost_price < 0 then
      raise exception using errcode = 'P0001', message = 'FNB_SIZE_SETUP_PRICE_INVALID';
    end if;
    if v_variant_id is not null and not exists (
      select 1 from public.product_variants pv
       where pv.id = v_variant_id
         and pv.tenant_id = v_tenant
         and pv.product_id = p_product_id
    ) then
      raise exception using errcode = 'P0001', message = 'FNB_SIZE_SETUP_VARIANT_TENANT_MISMATCH';
    end if;

    for v_item in select value from jsonb_array_elements(v_variant->'items')
    loop
      begin
        v_material_id := nullif(v_item->>'materialId', '')::uuid;
        v_group_id := nullif(v_item->>'modifierScaleTarget', '')::uuid;
        v_input_quantity := (v_item->>'inputQuantity')::numeric;
        v_input_unit := nullif(trim(v_item->>'inputUnit'), '');
      exception when invalid_text_representation then
        raise exception using errcode = 'P0001', message = 'FNB_SIZE_SETUP_ITEM_FORMAT_INVALID';
      end;
      if v_material_id is null or v_input_quantity is null or v_input_quantity <= 0 or v_input_unit is null then
        raise exception using errcode = 'P0001', message = 'FNB_SIZE_SETUP_ITEM_INVALID';
      end if;
      if not exists (
        select 1 from public.products material
         where material.id = v_material_id and material.tenant_id = v_tenant
      ) then
        raise exception using errcode = 'P0001', message = 'FNB_SIZE_SETUP_MATERIAL_TENANT_MISMATCH';
      end if;
      if v_group_id is not null and not exists (
        select 1 from public.modifier_groups g
         where g.id = v_group_id
           and g.tenant_id = v_tenant
           and g.is_active
           and g.channel in ('fnb', 'all')
           and (
             (exists (select 1 from public.product_modifier_groups own_link
                       where own_link.tenant_id = v_tenant and own_link.product_id = p_product_id)
              and exists (select 1 from public.product_modifier_groups target_link
                           where target_link.tenant_id = v_tenant
                             and target_link.product_id = p_product_id
                             and target_link.modifier_group_id = g.id))
             or
             (not exists (select 1 from public.product_modifier_groups own_link
                            where own_link.tenant_id = v_tenant and own_link.product_id = p_product_id)
              and exists (select 1 from public.category_modifier_groups target_link
                           where target_link.tenant_id = v_tenant
                             and target_link.category_id = v_category_id
                             and target_link.modifier_group_id = g.id))
           )
      ) then
        raise exception using errcode = 'P0001', message = 'FNB_SIZE_SETUP_GROUP_NOT_EFFECTIVE';
      end if;
    end loop;
  end loop;

  -- Mutations below are covered by the function transaction. Any error rolls
  -- variants, BOM items and exact quantities back to their previous state.
  for v_variant in
    select item.value
      from jsonb_array_elements(p_variants) with ordinality as item(value, ordinality)
     order by item.ordinality
  loop
    v_client_key := trim(v_variant->>'clientKey');
    v_variant_id := nullif(v_variant->>'id', '')::uuid;
    v_name := trim(v_variant->>'name');
    v_bom_code := trim(v_variant->>'bomCode');
    v_bom_name := coalesce(nullif(trim(v_variant->>'bomName'), ''), v_name);
    v_sell_price := (v_variant->>'sellPrice')::numeric;
    v_cost_price := coalesce((v_variant->>'costPrice')::numeric, 0);
    v_is_default := coalesce((v_variant->>'isDefault')::boolean, false);

    if v_variant_id is null then
      v_variant_id := extensions.uuid_generate_v4();
      insert into public.product_variants (
        id, tenant_id, product_id, name, sell_price, cost_price,
        is_default, is_active, sort_order, bom_code
      ) values (
        v_variant_id, v_tenant, p_product_id, v_name, v_sell_price, v_cost_price,
        v_is_default, true, coalesce((v_variant->>'sortOrder')::integer, 0), v_bom_code
      );
    else
      update public.product_variants
         set name = v_name,
             sell_price = v_sell_price,
             cost_price = v_cost_price,
             is_default = v_is_default,
             is_active = true,
             sort_order = coalesce((v_variant->>'sortOrder')::integer, 0),
             bom_code = v_bom_code,
             updated_at = now()
       where id = v_variant_id and tenant_id = v_tenant and product_id = p_product_id;
    end if;
    v_kept_ids := array_append(v_kept_ids, v_variant_id);

    select b.id into v_bom_id
      from public.bom b
     where b.tenant_id = v_tenant
       and b.product_id = p_product_id
       and b.variant_id = v_variant_id
     order by b.is_active desc, b.updated_at desc nulls last, b.created_at desc
     limit 1
     for update;
    if v_bom_id is null then
      if exists (select 1 from public.bom b where b.tenant_id = v_tenant and lower(b.code) = lower(v_bom_code)) then
        raise exception using errcode = 'P0001', message = 'FNB_SIZE_SETUP_BOM_CODE_IN_USE';
      end if;
      insert into public.bom (
        tenant_id, product_id, variant_id, code, name, is_active,
        batch_size, yield_qty, yield_unit
      ) values (
        v_tenant, p_product_id, v_variant_id, v_bom_code, v_bom_name, true,
        1, 1, 'cái'
      ) returning id into v_bom_id;
    else
      update public.bom
         set code = v_bom_code, name = v_bom_name, is_active = true, updated_at = now()
       where id = v_bom_id and tenant_id = v_tenant;
    end if;

    delete from public.bom_items where bom_id = v_bom_id;
    insert into public.bom_items (
      bom_id, material_id, quantity, unit, input_quantity, input_unit,
      waste_percent, sort_order, modifier_scale_target
    )
    select
      v_bom_id,
      (item.value->>'materialId')::uuid,
      (item.value->>'inputQuantity')::numeric,
      trim(item.value->>'inputUnit'),
      (item.value->>'inputQuantity')::numeric,
      trim(item.value->>'inputUnit'),
      0,
      item.ordinality::integer - 1,
      nullif(item.value->>'modifierScaleTarget', '')::uuid
    from jsonb_array_elements(v_variant->'items') with ordinality as item(value, ordinality);

    v_exact_rows := coalesce(v_variant->'exactRows', '[]'::jsonb);
    perform public.save_bom_modifier_option_quantities(v_bom_id, v_exact_rows);

    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'clientKey', v_client_key,
      'id', v_variant_id,
      'bomCode', v_bom_code
    ));
  end loop;

  update public.product_variants
     set is_active = false, is_default = false, updated_at = now()
   where tenant_id = v_tenant
     and product_id = p_product_id
     and is_active
     and not (id = any(v_kept_ids));

  if jsonb_array_length(p_variants) > 0 then
    update public.products set has_bom = true, updated_at = now()
     where id = p_product_id and tenant_id = v_tenant;
  end if;

  return jsonb_build_object('success', true, 'variants', v_result);
end;
$function$;

alter function public.save_fnb_size_setup_atomic(uuid, jsonb) owner to postgres;
revoke all on function public.save_fnb_size_setup_atomic(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.save_fnb_size_setup_atomic(uuid, jsonb)
  to authenticated;

comment on function public.save_fnb_size_setup_atomic(uuid, jsonb) is
  '00357: Atomically replace FnB variants, per-size BOM items and exact modifier quantities.';

commit;

notify pgrst, 'reload schema';
