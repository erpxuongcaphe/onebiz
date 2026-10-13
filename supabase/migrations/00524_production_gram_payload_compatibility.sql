-- stock_unit belongs to the gram guard, not the legacy production JSON contract.
-- Keep the legacy allowlist and all permission/branch/material validation intact.
-- No business rows or quantities are rewritten.
begin;
set local lock_timeout = '5s';
do $compat$
declare definition text;
begin
  definition := pg_get_functiondef('public.create_production_order_atomic(jsonb)'::regprocedure);
  if position('_create_production_before_gram_00517(p_input - ''stock_unit'')' in definition) > 0 then
    return;
  end if;
  if position('GRAM_FORM_REFRESH_REQUIRED' in definition) = 0
     or position('_create_production_before_gram_00517(p_input)' in definition) = 0 then
    raise exception 'PRODUCTION_GRAM_WRAPPER_CHANGED';
  end if;
  definition := replace(definition,
    '_create_production_before_gram_00517(p_input)',
    '_create_production_before_gram_00517(p_input - ''stock_unit'')');
  execute definition;
end;
$compat$;
commit;
notify pgrst, 'reload schema';
