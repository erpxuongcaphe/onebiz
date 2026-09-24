-- Allow zero-priced FnB sizes only when their parent explicitly opts in.
-- Function definitions are guarded against drift; no product or Retail row is rewritten.
begin;

do $migration$
declare
  v_definition text;
  v_old text;
  v_new text;
begin
  if to_regprocedure('public.save_fnb_size_setup_atomic_00357(uuid,jsonb)') is null
     or to_regprocedure('public.create_fnb_product_with_size_setup_atomic(jsonb,jsonb,uuid[])') is null
     or to_regprocedure('public.resolve_sale_price_00363(uuid,uuid,uuid,uuid,text,text,numeric,timestamptz)') is null
     or not exists (
       select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'products' and column_name = 'allow_free_sale'
     ) then
    raise exception 'FNB_00395_PREREQUISITE_MISSING';
  end if;

  v_definition := pg_get_functiondef('public.save_fnb_size_setup_atomic_00357(uuid,jsonb)'::regprocedure);
  v_old := 'v_cost_price numeric;';
  v_new := 'v_cost_price numeric;' || E'\n  v_allow_free_sale boolean;';
  if position(v_new in v_definition) = 0 then
    if position(v_old in v_definition) = 0 then raise exception 'FNB_00395_SIZE_DECLARATION_CHANGED'; end if;
    v_definition := replace(v_definition, v_old, v_new);
  end if;
  v_old := 'select p.category_id into v_category_id';
  v_new := 'select p.category_id, p.allow_free_sale into v_category_id, v_allow_free_sale';
  if position(v_new in v_definition) = 0 then
    if position(v_old in v_definition) = 0 then raise exception 'FNB_00395_SIZE_PRODUCT_LOOKUP_CHANGED'; end if;
    v_definition := replace(v_definition, v_old, v_new);
  end if;
  v_old := 'v_sell_price is null or v_sell_price <= 0 or v_cost_price < 0';
  v_new := 'v_sell_price is null or v_sell_price < 0 or (v_sell_price = 0 and not v_allow_free_sale) or v_cost_price < 0';
  if position(v_new in v_definition) = 0 then
    if position(v_old in v_definition) = 0 then raise exception 'FNB_00395_SIZE_PRICE_GUARD_CHANGED'; end if;
    v_definition := replace(v_definition, v_old, v_new);
  end if;
  execute v_definition;

  v_definition := pg_get_functiondef('public.create_fnb_product_with_size_setup_atomic(jsonb,jsonb,uuid[])'::regprocedure);
  v_old := 'v_sell_price is null or v_sell_price <= 0 or v_cost_price < 0';
  v_new := 'v_sell_price is null or v_sell_price < 0 or (v_sell_price = 0 and not coalesce((p_product->>''allowFreeSale'')::boolean, false)) or v_cost_price < 0';
  if position(v_new in v_definition) = 0 then
    if position(v_old in v_definition) = 0 then raise exception 'FNB_00395_CREATE_PRICE_GUARD_CHANGED'; end if;
    v_definition := replace(v_definition, v_old, v_new);
  end if;
  v_old := 'sell_price, cost_price, category_id,';
  v_new := 'sell_price, cost_price, allow_free_sale, category_id,';
  if position(v_new in v_definition) = 0 then
    if position(v_old in v_definition) = 0 then raise exception 'FNB_00395_CREATE_COLUMNS_CHANGED'; end if;
    v_definition := replace(v_definition, v_old, v_new);
  end if;
  v_old := 'v_sell_price, v_cost_price,';
  v_new := 'v_sell_price, v_cost_price, coalesce((p_product->>''allowFreeSale'')::boolean, false),';
  if position(v_new in v_definition) = 0 then
    if position(v_old in v_definition) = 0 then raise exception 'FNB_00395_CREATE_VALUES_CHANGED'; end if;
    v_definition := replace(v_definition, v_old, v_new);
  end if;
  execute v_definition;

  v_definition := pg_get_functiondef('public.resolve_sale_price_00363(uuid,uuid,uuid,uuid,text,text,numeric,timestamptz)'::regprocedure);
  v_old := 'select p.id, p.sell_price into v_product';
  v_new := 'select p.id, p.sell_price, p.allow_free_sale into v_product';
  if position(v_new in v_definition) = 0 then
    if position(v_old in v_definition) = 0 then raise exception 'FNB_00395_RESOLVER_LOOKUP_CHANGED'; end if;
    v_definition := replace(v_definition, v_old, v_new);
  end if;
  v_old := 'p_channel = ''fnb'' and coalesce(v_unit_price, 0) <= 0';
  v_new := 'p_channel = ''fnb'' and (v_unit_price is null or v_unit_price < 0 or (v_unit_price = 0 and not v_product.allow_free_sale))';
  if position(v_new in v_definition) = 0 then
    if position(v_old in v_definition) = 0 then raise exception 'FNB_00395_RESOLVER_GUARD_CHANGED'; end if;
    v_definition := replace(v_definition, v_old, v_new);
  end if;
  execute v_definition;
end;
$migration$;

commit;
notify pgrst, 'reload schema';
