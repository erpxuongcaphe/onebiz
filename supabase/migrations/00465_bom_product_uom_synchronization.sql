-- Keep preparation quantities authoritative when product packaging changes.
-- Historical invoices, stock movements and consumption snapshots are untouched.
begin;
create table public.bom_uom_sync_history_00465 (
 id bigint generated always as identity primary key,
 tenant_id uuid not null, bom_id uuid not null, material_id uuid not null,
 actor_id uuid, old_data jsonb not null, new_data jsonb not null,
 changed_at timestamptz not null default now()
);
alter table public.bom_uom_sync_history_00465 enable row level security;
revoke all on public.bom_uom_sync_history_00465 from public, anon, authenticated;
alter table public.bom_modifier_option_quantities
  add column if not exists input_quantity numeric(18,8),
  add column if not exists input_unit text;

-- Recover the original preparation amount using the factor stored with its BOM.
update public.bom_modifier_option_quantities q
set input_quantity = q.quantity / bi.conversion_factor,
    input_unit = bi.input_unit
from public.bom_items bi
where bi.bom_id = q.bom_id and bi.material_id = q.material_id
  and bi.conversion_factor > 0 and bi.input_unit is not null
  and q.input_quantity is null;

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
      'quantity', v_normalized_quantity, 'input_quantity', v_input_quantity, 'input_unit', v_input_unit
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
      tenant_id, bom_id, material_id, modifier_option_id, quantity, input_quantity, input_unit
    ) values (
      v_tenant,
      p_bom_id,
      (v_row->>'materialId')::uuid,
      (v_row->>'modifierOptionId')::uuid,
      (v_row->>'quantity')::numeric, (v_row->>'input_quantity')::numeric, v_row->>'input_unit'
    );
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('success', true, 'saved', v_count);
end;
$function$;



create or replace function public.sync_product_bom_uom_00465(p_product_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_tenant uuid; v_item record; v_factor numeric; v_quantity numeric;
begin
  select tenant_id into v_tenant from public.products
  where id = p_product_id and coalesce(is_active, true) for update;
  if v_tenant is null then return; end if;
  for v_item in
    select bi.* from public.bom_items bi join public.bom b on b.id = bi.bom_id
    where bi.material_id = p_product_id and b.tenant_id = v_tenant and b.is_active
      and bi.input_quantity is not null and bi.input_unit is not null
    order by bi.id for update of bi
  loop
    v_factor := public.resolve_product_uom_factor(v_tenant, p_product_id, v_item.input_unit);
    v_quantity := round(v_item.input_quantity * v_factor, 4);
    if v_quantity <= 0 then raise exception 'BOM_NORMALIZED_QUANTITY_INVALID'; end if;
    if v_quantity is distinct from v_item.quantity
       or v_factor::numeric(20,8) is distinct from v_item.conversion_factor then
      -- Trigger normalizes from input because quantity and unit are unchanged.
      update public.bom_items set input_quantity = input_quantity where id = v_item.id;
      insert into public.bom_uom_sync_history_00465(tenant_id, actor_id, bom_id, material_id, old_data, new_data)
      values (v_tenant, auth.uid(), v_item.bom_id, p_product_id,
        jsonb_build_object('quantity', v_item.quantity, 'factor', v_item.conversion_factor),
        jsonb_build_object('quantity', v_quantity, 'factor', v_factor, 'input_quantity', v_item.input_quantity, 'input_unit', v_item.input_unit));
      if auth.uid() is not null then
      insert into public.audit_log(tenant_id, user_id, action, entity_type, entity_id, old_data, new_data)
      values (v_tenant, auth.uid(), 'bom_uom_synchronized', 'bom', v_item.bom_id,
        jsonb_build_object('material_id', p_product_id, 'quantity', v_item.quantity, 'factor', v_item.conversion_factor),
        jsonb_build_object('material_id', p_product_id, 'quantity', v_quantity, 'factor', v_factor, 'input_quantity', v_item.input_quantity, 'input_unit', v_item.input_unit));
      end if;
    end if;
    if exists (select 1 from public.bom_modifier_option_quantities q
      where q.bom_id = v_item.bom_id and q.material_id = p_product_id and q.input_quantity is null) then
      raise exception 'BOM_EXACT_INPUT_REQUIRED';
    end if;
    update public.bom_modifier_option_quantities q
    set quantity = round(q.input_quantity * public.resolve_product_uom_factor(v_tenant, p_product_id, q.input_unit), 4)
    where q.bom_id = v_item.bom_id and q.material_id = p_product_id
      and q.quantity is distinct from round(q.input_quantity * public.resolve_product_uom_factor(v_tenant, p_product_id, q.input_unit), 4);
  end loop;
end;
$$;
revoke all on function public.sync_product_bom_uom_00465(uuid) from public, anon, authenticated;

-- Deferred until the complete replacement is visible, never between deactivate/insert.
create or replace function public.sync_bom_after_uom_00465()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$ begin
  if tg_op <> 'INSERT' then perform public.sync_product_bom_uom_00465(old.product_id); end if;
  if tg_op <> 'DELETE' and (tg_op = 'INSERT' or new.product_id is distinct from old.product_id) then
    perform public.sync_product_bom_uom_00465(new.product_id);
  end if;
  return null;
end; $$;
revoke all on function public.sync_bom_after_uom_00465() from public, anon, authenticated;
create constraint trigger sync_bom_after_uom_00465
after insert or update or delete on public.uom_conversions
deferrable initially deferred for each row execute function public.sync_bom_after_uom_00465();

do $$ declare v_product uuid; begin
  for v_product in select distinct bi.material_id from public.bom_items bi
    join public.products p on p.id = bi.material_id
    where coalesce(p.is_active, true) and bi.input_quantity is not null and bi.input_unit is not null
  loop perform public.sync_product_bom_uom_00465(v_product); end loop;
end $$;
commit;
notify pgrst, 'reload schema';
