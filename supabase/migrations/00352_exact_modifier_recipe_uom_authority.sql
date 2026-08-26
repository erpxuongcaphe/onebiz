-- ============================================================================
-- 00352 - FnB: save exact modifier quantities in the BOM preparation unit
--
-- The operator enters 21 G, 28 G or 35 G. The database verifies that this is
-- the BOM line's preparation unit and saves the normalized stock amount (for
-- example 0.021 Kg) used later by consume_bom_for_sale.
--
-- No stock, invoice, kitchen ticket, order or historic movement is changed.
-- Existing exact mappings are deliberately a stop condition: deployments that
-- already have them need a one-off review because 00350 did not retain the
-- input unit with the mapping.
-- ============================================================================

begin;

do $guard$
begin
  if to_regclass('public.bom_modifier_option_quantities') is null then
    raise exception using errcode = 'P0001', message = 'FNB_00352_00350_TABLE_MISSING';
  end if;
  if to_regprocedure('public.save_bom_modifier_option_quantities(uuid,jsonb)') is null then
    raise exception using errcode = 'P0001', message = 'FNB_00352_00350_RPC_MISSING';
  end if;
  if to_regprocedure('public.normalize_bom_item_uom_00320()') is null then
    raise exception using errcode = 'P0001', message = 'FNB_00352_00320_UOM_GUARD_MISSING';
  end if;
  if exists (select 1 from public.bom_modifier_option_quantities) then
    raise exception using errcode = 'P0001', message = 'FNB_00352_EXISTING_EXACT_MAPS_REQUIRE_REVIEW';
  end if;
end;
$guard$;

comment on table public.bom_modifier_option_quantities is
  '00350/00352: exact FnB quantities by BOM, material and choice. quantity is normalized to the material stock unit; the operator enters the BOM preparation unit through the guarded RPC.';

create or replace function public.save_bom_modifier_option_quantities(
  p_bom_id uuid,
  p_rows jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_row jsonb;
  v_material_id uuid;
  v_option_id uuid;
  v_input_quantity numeric;
  v_input_unit text;
  v_expected_input_unit text;
  v_factor numeric;
  v_normalized_quantity numeric;
  v_seen text[] := array[]::text[];
  v_key text;
  v_group_id uuid;
  v_group_rule text;
  v_item_count integer;
  v_expected_count integer;
  v_provided_count integer;
  v_count integer := 0;
  v_normalized_rows jsonb := '[]'::jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  select p.tenant_id into v_tenant from public.profiles p
   where p.id = v_actor and p.is_active;
  if v_tenant is null then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if not exists (select 1 from public.bom b where b.id = p_bom_id and b.tenant_id = v_tenant) then
    raise exception using errcode = '42501', message = 'FNB_EXACT_RECIPE_BOM_TENANT_MISMATCH';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception using errcode = 'P0001', message = 'FNB_EXACT_RECIPE_ROWS_INVALID';
  end if;

  -- Validate and normalize the full replacement before deleting any old map.
  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    begin
      v_material_id := nullif(v_row->>'materialId', '')::uuid;
      v_option_id := nullif(v_row->>'modifierOptionId', '')::uuid;
      v_input_quantity := (v_row->>'inputQuantity')::numeric;
      v_input_unit := nullif(trim(v_row->>'inputUnit'), '');
    exception when invalid_text_representation then
      raise exception using errcode = 'P0001', message = 'FNB_EXACT_RECIPE_ROW_FORMAT_INVALID';
    end;
    if v_material_id is null or v_option_id is null or v_input_quantity is null
       or v_input_quantity < 0 or v_input_unit is null then
      raise exception using errcode = 'P0001', message = 'FNB_EXACT_RECIPE_INPUT_REQUIRED';
    end if;
    v_key := v_material_id::text || ':' || v_option_id::text;
    if v_key = any(v_seen) then
      raise exception using errcode = 'P0001', message = 'FNB_EXACT_RECIPE_DUPLICATE_ROW';
    end if;
    v_seen := array_append(v_seen, v_key);

    select g.id into v_group_id
      from public.modifier_options o
      join public.modifier_groups g on g.id = o.group_id
     where o.id = v_option_id
       and o.is_active
       and g.is_active
       and g.tenant_id = v_tenant
       and g.channel in ('fnb', 'all');
    if v_group_id is null then
      raise exception using errcode = 'P0001', message = 'FNB_EXACT_RECIPE_OPTION_TENANT_MISMATCH';
    end if;

    -- Measured quantities must only target a group that POS can show for the
    -- SKU behind this BOM. Product-level links override category links.
    if not exists (
      select 1
        from public.bom b
        join public.products p on p.id = b.product_id
       where b.id = p_bom_id
         and p.tenant_id = v_tenant
         and (
           (
             exists (
               select 1 from public.product_modifier_groups own_link
                where own_link.tenant_id = v_tenant
                  and own_link.product_id = p.id
             )
             and exists (
               select 1 from public.product_modifier_groups target_link
                where target_link.tenant_id = v_tenant
                  and target_link.product_id = p.id
                  and target_link.modifier_group_id = v_group_id
             )
           )
           or (
             not exists (
               select 1 from public.product_modifier_groups own_link
                where own_link.tenant_id = v_tenant
                  and own_link.product_id = p.id
             )
             and exists (
               select 1 from public.category_modifier_groups target_link
                where target_link.tenant_id = v_tenant
                  and target_link.category_id = p.category_id
                  and target_link.modifier_group_id = v_group_id
             )
           )
         )
    ) then
      raise exception using errcode = 'P0001', message = 'FNB_EXACT_RECIPE_GROUP_NOT_EFFECTIVE_FOR_PRODUCT';
    end if;

    select coalesce(pmg.rule_override, g.rule)
      into v_group_rule
      from public.bom b
      join public.products p on p.id = b.product_id
      join public.modifier_groups g on g.id = v_group_id
      left join public.product_modifier_groups pmg
        on pmg.tenant_id = v_tenant
       and pmg.product_id = p.id
       and pmg.modifier_group_id = g.id
     where b.id = p_bom_id
       and p.tenant_id = v_tenant;
    if v_group_rule not in ('single', 'single_required') then
      raise exception using errcode = 'P0001', message = 'FNB_EXACT_RECIPE_GROUP_MUST_SELECT_ONE';
    end if;

    select
      count(*),
      min(coalesce(nullif(trim(bi.input_unit), ''), bi.unit)),
      min(coalesce(bi.conversion_factor, 1))
      into v_item_count, v_expected_input_unit, v_factor
      from public.bom_items bi
     where bi.bom_id = p_bom_id
       and bi.material_id = v_material_id
       and bi.modifier_scale_target = v_group_id;
    if v_item_count <> 1 then
      raise exception using errcode = 'P0001', message = 'FNB_EXACT_RECIPE_BOM_ITEM_TARGET_MISMATCH';
    end if;
    if lower(v_input_unit) <> lower(v_expected_input_unit) then
      raise exception using errcode = 'P0001', message = 'FNB_EXACT_RECIPE_INPUT_UNIT_MISMATCH';
    end if;
    if v_factor is null or v_factor <= 0 then
      raise exception using errcode = 'P0001', message = 'FNB_EXACT_RECIPE_UOM_FACTOR_INVALID';
    end if;

    v_normalized_quantity := round(v_input_quantity * v_factor, 4);
    v_normalized_rows := v_normalized_rows || jsonb_build_array(jsonb_build_object(
      'materialId', v_material_id,
      'modifierOptionId', v_option_id,
      'quantity', v_normalized_quantity
    ));
  end loop;

  -- Once a material starts using exact quantities, it must cover every active
  -- choice in its select-one group. A new choice can never fall back silently.
  for v_material_id, v_group_id in
    select distinct
      (r.value->>'materialId')::uuid,
      mo.group_id
    from jsonb_array_elements(v_normalized_rows) r(value)
    join public.modifier_options mo on mo.id = (r.value->>'modifierOptionId')::uuid
  loop
    select count(*) into v_expected_count
      from public.modifier_options mo
     where mo.group_id = v_group_id and mo.is_active;
    select count(distinct (r.value->>'modifierOptionId')::uuid) into v_provided_count
      from jsonb_array_elements(v_normalized_rows) r(value)
      join public.modifier_options mo on mo.id = (r.value->>'modifierOptionId')::uuid
     where (r.value->>'materialId')::uuid = v_material_id
       and mo.group_id = v_group_id;
    if v_expected_count = 0 or v_provided_count <> v_expected_count then
      raise exception using errcode = 'P0001', message = 'FNB_EXACT_RECIPE_GROUP_INCOMPLETE';
    end if;
  end loop;

  delete from public.bom_modifier_option_quantities where bom_id = p_bom_id;
  for v_row in select value from jsonb_array_elements(v_normalized_rows)
  loop
    insert into public.bom_modifier_option_quantities (
      tenant_id, bom_id, material_id, modifier_option_id, quantity
    ) values (
      v_tenant,
      p_bom_id,
      (v_row->>'materialId')::uuid,
      (v_row->>'modifierOptionId')::uuid,
      (v_row->>'quantity')::numeric
    );
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('success', true, 'saved', v_count);
end;
$function$;

comment on function public.save_bom_modifier_option_quantities(uuid, jsonb) is
  '00352: accepts inputQuantity/inputUnit, verifies the BOM input unit, then persists normalized stock quantity.';

revoke all on function public.save_bom_modifier_option_quantities(uuid, jsonb)
  from public, anon;
grant execute on function public.save_bom_modifier_option_quantities(uuid, jsonb)
  to authenticated;

do $verify$
begin
  if position('inputQuantity' in pg_get_functiondef(
    'public.save_bom_modifier_option_quantities(uuid,jsonb)'::regprocedure
  )) = 0 or position('FNB_EXACT_RECIPE_INPUT_UNIT_MISMATCH' in pg_get_functiondef(
    'public.save_bom_modifier_option_quantities(uuid,jsonb)'::regprocedure
  )) = 0 then
    raise exception using errcode = 'P0001', message = 'FNB_00352_SAVE_RPC_NOT_HARDENED';
  end if;
end;
$verify$;

commit;

notify pgrst, 'reload schema';
