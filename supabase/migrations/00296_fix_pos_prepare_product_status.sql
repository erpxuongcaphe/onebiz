-- 00296 - Remove the retired products.status predicate from POS price preparation.
--
-- This migration changes one stored function definition only. It does not insert,
-- update, or delete invoices, invoice items, stock, cash, debt, or customer data.

do $migration$
declare
  v_signature regprocedure := to_regprocedure(
    'public.pos_prepare_retail_checkout(uuid,uuid,uuid,uuid,jsonb,text,numeric,uuid,text,integer,uuid,numeric,numeric)'
  );
  v_before text;
  v_after text;
  v_legacy_count integer;
begin
  if v_signature is null then
    raise exception '00296_ABORT: pos_prepare_retail_checkout is not installed';
  end if;

  v_before := pg_get_functiondef(v_signature);
  v_legacy_count := (
    length(v_before) - length(replace(v_before, 'p.status', ''))
  ) / length('p.status');

  if v_legacy_count = 0 then
    if position('p.is_active' in v_before) = 0 then
      raise exception '00296_ABORT: product activity guard is missing';
    end if;
    raise notice '00296 already applied';
    return;
  end if;

  if v_legacy_count <> 1 then
    raise exception '00296_ABORT: expected one p.status reference, found %', v_legacy_count;
  end if;

  v_after := replace(v_before, E'\n      and p.status = ''active''', '');
  if v_after = v_before then
    raise exception '00296_ABORT: the live function differs from the reviewed definition';
  end if;
  if position('p.status' in v_after) > 0 or position('p.is_active' in v_after) = 0 then
    raise exception '00296_ABORT: repaired function did not pass the activity guard check';
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

-- Read-only verification of the installed function and active checkout chain.
with checkout_functions as (
  select p.oid, p.proname
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = any(array[
      'pos_prepare_retail_checkout',
      'assert_pos_stock_available',
      'pos_complete_checkout_atomic_v3',
      'complete_draft_atomic_v3',
      'complete_draft_atomic_v4',
      'complete_draft_atomic_v5'
    ])
)
select
  to_regprocedure(
    'public.pos_prepare_retail_checkout(uuid,uuid,uuid,uuid,jsonb,text,numeric,uuid,text,integer,uuid,numeric,numeric)'
  ) is not null as prepare_rpc_ok,
  position(
    'p.status' in pg_get_functiondef(
      to_regprocedure(
        'public.pos_prepare_retail_checkout(uuid,uuid,uuid,uuid,jsonb,text,numeric,uuid,text,integer,uuid,numeric,numeric)'
      )
    )
  ) = 0 as prepare_legacy_status_removed,
  position(
    'p.is_active' in pg_get_functiondef(
      to_regprocedure(
        'public.pos_prepare_retail_checkout(uuid,uuid,uuid,uuid,jsonb,text,numeric,uuid,text,integer,uuid,numeric,numeric)'
      )
    )
  ) > 0 as prepare_is_active_ok,
  count(*) filter (
    where position('p.status' in pg_get_functiondef(oid)) > 0
  ) = 0 as checkout_chain_legacy_status_removed
from checkout_functions;
