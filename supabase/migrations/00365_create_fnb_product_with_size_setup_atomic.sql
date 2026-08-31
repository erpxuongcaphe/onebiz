-- 00365 - Create an FnB product and its complete per-size setup atomically.
--
-- 00357 made variants/BOMs/exact quantities atomic after a product existed.
-- The web create flow still inserted products first, so a rejected size setup
-- could leave an active zero-price parent SKU. This wrapper keeps the parent,
-- product-level modifier override and 00357 payload in one transaction.

begin;

do $prerequisite$
begin
  if to_regclass('public.products') is null
     or to_regclass('public.categories') is null
     or to_regprocedure('public.user_has_permission(uuid,text)') is null
     or to_regprocedure('public.save_product_modifier_groups_atomic(uuid,uuid[])') is null
     or to_regprocedure('public.save_fnb_size_setup_atomic(uuid,jsonb)') is null then
    raise exception using errcode = 'P0001', message = 'FNB_00365_PREREQUISITE_MISSING';
  end if;
end;
$prerequisite$;

create or replace function public.create_fnb_product_with_size_setup_atomic(
  p_product jsonb,
  p_variants jsonb,
  p_modifier_group_ids uuid[] default '{}'::uuid[]
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_product_id uuid := extensions.uuid_generate_v4();
  v_category_id uuid;
  v_code text;
  v_name text;
  v_unit text;
  v_sell_price numeric;
  v_cost_price numeric;
  v_size_result jsonb;
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
    raise exception using errcode = '42501', message = 'FNB_PRODUCT_CREATE_PERMISSION_DENIED';
  end if;
  if p_product is null or jsonb_typeof(p_product) <> 'object'
     or p_variants is null or jsonb_typeof(p_variants) <> 'array'
     or jsonb_array_length(p_variants) = 0 then
    raise exception using errcode = '22023', message = 'FNB_PRODUCT_CREATE_PAYLOAD_INVALID';
  end if;

  begin
    v_category_id := nullif(p_product->>'categoryId', '')::uuid;
    v_sell_price := (p_product->>'sellPrice')::numeric;
    v_cost_price := coalesce((p_product->>'costPrice')::numeric, 0);
  exception when invalid_text_representation then
    raise exception using errcode = '22023', message = 'FNB_PRODUCT_CREATE_FORMAT_INVALID';
  end;
  v_code := nullif(trim(p_product->>'code'), '');
  v_name := nullif(trim(p_product->>'name'), '');
  v_unit := coalesce(nullif(trim(p_product->>'unit'), ''), 'Ly');

  if v_code is null or v_name is null or v_category_id is null
     or v_sell_price is null or v_sell_price <= 0 or v_cost_price < 0 then
    raise exception using errcode = '22023', message = 'FNB_PRODUCT_CREATE_REQUIRED_FIELDS';
  end if;
  if not exists (
    select 1 from public.categories c
     where c.id = v_category_id and c.tenant_id = v_tenant
  ) then
    raise exception using errcode = 'P0001', message = 'FNB_PRODUCT_CREATE_CATEGORY_INVALID';
  end if;
  if exists (
    select 1 from public.products p
     where p.tenant_id = v_tenant and lower(p.code) = lower(v_code)
  ) then
    raise exception using errcode = '23505', message = 'FNB_PRODUCT_CREATE_CODE_DUPLICATE';
  end if;

  insert into public.products (
    id, tenant_id, code, name, sell_price, cost_price, category_id,
    unit, purchase_unit, stock_unit, sell_unit, stock, min_stock, max_stock,
    vat_rate, barcode, weight, description, image_url, allow_sale, is_active,
    product_type, channel, has_bom, bom_code, group_code,
    shelf_life_days, shelf_life_unit, supplier_id, brand
  ) values (
    v_product_id, v_tenant, v_code, v_name, v_sell_price, v_cost_price,
    v_category_id, v_unit,
    coalesce(nullif(trim(p_product->>'purchaseUnit'), ''), v_unit),
    coalesce(nullif(trim(p_product->>'stockUnit'), ''), v_unit),
    coalesce(nullif(trim(p_product->>'sellUnit'), ''), v_unit),
    0,
    coalesce((p_product->>'minStock')::numeric, 0),
    coalesce((p_product->>'maxStock')::numeric, 1000),
    coalesce((p_product->>'vatRate')::numeric, 0),
    nullif(p_product->>'barcode', ''),
    nullif(p_product->>'weight', '')::numeric,
    nullif(p_product->>'description', ''),
    nullif(p_product->>'image', ''),
    coalesce((p_product->>'allowSale')::boolean, true),
    true, 'sku', 'fnb', true,
    nullif(p_product->>'bomCode', ''),
    nullif(p_product->>'groupCode', ''),
    nullif(p_product->>'shelfLifeDays', '')::integer,
    coalesce(nullif(p_product->>'shelfLifeUnit', ''), 'day'),
    nullif(p_product->>'supplierId', '')::uuid,
    nullif(p_product->>'brand', '')
  );

  if coalesce(array_length(p_modifier_group_ids, 1), 0) > 0 then
    perform public.save_product_modifier_groups_atomic(
      v_product_id,
      p_modifier_group_ids
    );
  end if;

  v_size_result := public.save_fnb_size_setup_atomic(v_product_id, p_variants);

  return jsonb_build_object(
    'success', true,
    'productId', v_product_id,
    'code', v_code,
    'variants', coalesce(v_size_result->'variants', '[]'::jsonb)
  );
end;
$function$;

alter function public.create_fnb_product_with_size_setup_atomic(jsonb,jsonb,uuid[]) owner to postgres;
revoke all on function public.create_fnb_product_with_size_setup_atomic(jsonb,jsonb,uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.create_fnb_product_with_size_setup_atomic(jsonb,jsonb,uuid[])
  to authenticated;

comment on function public.create_fnb_product_with_size_setup_atomic(jsonb,jsonb,uuid[]) is
  '00365: Atomically create an FnB SKU, modifier override, sizes, BOMs and exact quantities.';

commit;

notify pgrst, 'reload schema';
