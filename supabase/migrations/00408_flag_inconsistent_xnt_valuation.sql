-- 00408: do not publish a "complete" valuation when quantity and value disagree.
-- This only changes report confidence; it never rewrites stock or cost rows.
begin;

do $$
declare
  v_signature constant text := 'timestamptz,timestamptz,uuid,text';
  v_definition text;
  v_pattern constant text := $pattern$and abs\(\s*quantity_row\.closing_qty\s*-\s*coalesce\(valued_row\.ledger_opening_qty, 0\)\s*-\s*coalesce\(valued_row\.ledger_period_net_qty, 0\)\s*\) <= 0\.0001\s*\) as is_complete$pattern$;
  v_replacement constant text := $replacement$and abs(
           quantity_row.closing_qty
           - coalesce(valued_row.ledger_opening_qty, 0)
           - coalesce(valued_row.ledger_period_net_qty, 0)
         ) <= 0.0001
        and quantity_row.opening_qty >= -0.0001
        and quantity_row.closing_qty >= -0.0001
        and coalesce(valued_row.opening_value_raw, 0) >= -0.0001
        and (
          coalesce(valued_row.opening_value_raw, 0)
          + coalesce(valued_row.in_value_raw, 0)
          - coalesce(valued_row.out_value_raw, 0)
        ) >= -0.0001
        and (
          abs(quantity_row.opening_qty) > 0.0001
          or abs(coalesce(valued_row.opening_value_raw, 0)) <= 0.0001
        )
        and (
          abs(quantity_row.closing_qty) > 0.0001
          or abs(
            coalesce(valued_row.opening_value_raw, 0)
            + coalesce(valued_row.in_value_raw, 0)
            - coalesce(valued_row.out_value_raw, 0)
          ) <= 0.0001
        )
      ) as is_complete$replacement$;
  v_count integer;
begin
  select pg_get_functiondef(
    to_regprocedure('public.get_xnt_report_v2(' || v_signature || ')')
  ) into v_definition;

  if v_definition is null then
    raise exception '00408: missing get_xnt_report_v2(%)', v_signature;
  end if;

  if v_definition like '%quantity_row.closing_qty >= -0.0001%' then
    return;
  end if;

  select count(*)::integer
    into v_count
    from regexp_matches(v_definition, v_pattern, 'g');
  if v_count <> 1 then
    raise exception '00408: expected one XNT completeness clause, found %', v_count;
  end if;

  execute regexp_replace(v_definition, v_pattern, v_replacement, 'g');
end $$;

commit;
