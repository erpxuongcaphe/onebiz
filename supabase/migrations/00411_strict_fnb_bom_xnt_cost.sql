-- 00411: require branch cost events for tracked F&B BOM consumption.
-- This prevents a shared product cost snapshot from validating F&B XNT.
-- Retail and branches outside F&B cost tracking retain the 00404 fallback.

begin;

do $$
declare
  v_signature constant text := 'timestamptz,timestamptz,uuid,text';
  v_definition text;
  v_pattern constant text := $pattern$when movement\.type = 'in'\s+and movement\.reference_type = 'internal_sale'$pattern$;
  v_replacement constant text := $replacement$when movement.type = 'out'
         and movement.reference_type = 'bom_consume'
         and public._fnb_branch_cost_tracking_enabled_00390(
           movement.tenant_id, movement.branch_id
         )
          then null::numeric
        when movement.type = 'in'
         and movement.reference_type = 'internal_sale'$replacement$;
  v_count integer;
begin
  select pg_get_functiondef(
    to_regprocedure('public.get_xnt_report_v2(' || v_signature || ')')
  ) into v_definition;

  if v_definition is null then
    raise exception '00411: missing get_xnt_report_v2(%)', v_signature;
  end if;

  if v_definition like '%movement.reference_type = ''bom_consume''%'
     and v_definition like '%then null::numeric%'
     and v_definition like '%internal_sale_cost.total_cost%' then
    return;
  end if;

  if v_definition not like '%internal_sale_cost.total_cost%'
     or v_definition not like '%public._fnb_branch_cost_tracking_enabled_00390%' then
    raise exception '00411: unexpected XNT function version; apply after 00409 and 00410';
  end if;

  select count(*)::integer
    into v_count
    from regexp_matches(v_definition, v_pattern, 'g');

  if v_count <> 1 then
    raise exception '00411: expected one internal-sale valuation branch, found %', v_count;
  end if;

  execute regexp_replace(v_definition, v_pattern, v_replacement, 'g');
end $$;

commit;

