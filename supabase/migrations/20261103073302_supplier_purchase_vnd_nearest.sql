-- New supplier-document saves only. Do not rewrite posted orders, stock or payments.
-- Preserve the function OID and ACL: callers and replay/permission wrappers stay intact.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '20s';
do $patch$
declare
  target regprocedure := 'public.save_purchase_order_atomic(uuid,text,uuid,uuid,text,numeric,numeric,numeric,numeric,text,boolean,boolean,jsonb)'::regprocedure;
  definition text;
begin
  definition := pg_get_functiondef(target);
  if (length(definition)-length(replace(definition,'ceil(v_quantity * v_unit_price)',''))) / length('ceil(v_quantity * v_unit_price)') <> 2 then
    raise exception 'PURCHASE_ROUNDING_DEFINITION_CHANGED';
  end if;
  -- Old browser tabs keep their existing rule. The new form opts in explicitly;
  -- deploy this backend first, then the matching frontend.
  definition := replace(definition,'ceil(v_quantity * v_unit_price)',
    '(case when v_item->>''money_rounding'' = ''nearest_vnd_v1'' then round(v_quantity * v_unit_price) else ceil(v_quantity * v_unit_price) end)');
  if position('select s.id, s.name' in definition)=0 then
    raise exception 'PURCHASE_MONEY_VALIDATION_DEFINITION_CHANGED';
  end if;
  -- The original negative-value checks run first. Normalize document money, not
  -- quantities or unit prices, for callers that opted into the new policy.
  definition := replace(definition,'select s.id, s.name',
    'if p_items->0->>''money_rounding'' = ''nearest_vnd_v1'' then
       v_shipping_cost := round(v_shipping_cost);
       v_other_cost := round(v_other_cost);
       v_order_discount := round(v_order_discount);
       v_requested_paid := round(v_requested_paid);
     end if;
     select s.id, s.name');
  execute definition;
end $patch$;
commit;
