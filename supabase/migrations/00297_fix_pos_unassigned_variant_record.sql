-- 00297 - Prevent POS checkout from reading an unassigned variant record.
--
-- Schema/function-only repair. This migration does not insert, update, or delete
-- invoices, invoice items, stock, cash, debt, shifts, or customer data.

do $migration$
declare
  v_signature regprocedure := to_regprocedure(
    'public.pos_prepare_retail_checkout(uuid,uuid,uuid,uuid,jsonb,text,numeric,uuid,text,integer,uuid,numeric,numeric)'
  );
  v_before text;
  v_after text;
  v_item_marker text := 'v_variant_id := nullif(v_item->>''variantId'', '''')::uuid;';
  v_safe_item_marker text := E'select null::uuid as id, null::text as name, null::numeric as sell_price\n        into v_variant;\n      v_variant_id := nullif(v_item->>''variantId'', '''')::uuid;';
begin
  if v_signature is null then
    raise exception '00297_ABORT: pos_prepare_retail_checkout is not installed';
  end if;

  v_before := pg_get_functiondef(v_signature);

  if position('into v_variant;' in v_before) > 0 then
    raise notice '00297 already applied';
    return;
  end if;

  if position('v_variant record;' in v_before) = 0
     or position('v_variant.name' in v_before) = 0
     or position('v_variant.sell_price' in v_before) = 0 then
    raise exception '00297_ABORT: live function differs from the reviewed definition';
  end if;

  v_after := replace(v_before, v_item_marker, v_safe_item_marker);
  if v_after = v_before then
    raise exception '00297_ABORT: checkout variant assignment was not found';
  end if;

  execute v_after;
end;
$migration$;

revoke all on function public.pos_prepare_retail_checkout(
  uuid, uuid, uuid, uuid, jsonb, text, numeric, uuid, text, integer, uuid, numeric, numeric
) from public, anon, authenticated;
grant execute on function public.pos_prepare_retail_checkout(
  uuid, uuid, uuid, uuid, jsonb, text, numeric, uuid, text, integer, uuid, numeric, numeric
) to service_role;

notify pgrst, 'reload schema';

-- Read-only verification. All four values must be true.
with target as (
  select pg_get_functiondef(
    to_regprocedure(
      'public.pos_prepare_retail_checkout(uuid,uuid,uuid,uuid,jsonb,text,numeric,uuid,text,integer,uuid,numeric,numeric)'
    )
  ) as definition
)
select
  definition is not null as prepare_rpc_ok,
  position('into v_variant;' in definition) > 0 as variant_initialized_ok,
  position('p.status' in definition) = 0 as legacy_product_status_removed,
  position('p.is_active' in definition) > 0 as product_is_active_ok
from target;
