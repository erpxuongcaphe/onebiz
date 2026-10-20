-- Retail pricing only: initialize the optional customer record before PostgreSQL
-- resolves fields in expressions for walk-in checkout. No business data writes.
begin;
set local lock_timeout = '3s';
do $patch$
declare
  target regprocedure := to_regprocedure('public.pos_prepare_retail_checkout(uuid,uuid,uuid,uuid,jsonb,text,numeric,uuid,text,integer,uuid,numeric,numeric)');
  definition text;
  anchor text := '  if p_customer_id is not null then';
  initialization text := $init$  -- retail_optional_customer_00572
  select null::uuid as id, null::text as name, null::uuid as group_id,
         null::uuid as price_tier_id, null::integer as loyalty_points,
         0::numeric as group_discount_percent
    into v_customer;
$init$;
begin
  if target is null then raise exception 'RETAIL_00572_PREPARE_MISSING'; end if;
  definition := pg_get_functiondef(target);
  if position('retail_optional_customer_00572' in definition) > 0 then return; end if;
  if position('v_customer record;' in definition) = 0
     or position('v_customer.price_tier_id' in definition) = 0
     or position('v_customer.group_discount_percent' in definition) = 0
     or position(anchor in definition) = 0 then
    raise exception 'RETAIL_00572_PREPARE_DEFINITION_CHANGED';
  end if;
  -- Insert once, before the first optional-customer lookup. Keep all newer
  -- permission, manager approval, pricing and stock policy guards intact.
  definition := overlay(definition placing initialization || anchor
    from position(anchor in definition) for length(anchor));
  execute definition;
end $patch$;
notify pgrst, 'reload schema';
commit;
