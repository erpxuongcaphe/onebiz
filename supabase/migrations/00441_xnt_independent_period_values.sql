-- Value period receipts/issues independently of incomplete opening history.
-- Keep all existing cost-source, F&B, permission and closing-valuation guards.
begin;

do $$
declare
  v_definition text;
  v_anchor text := 'count(*) filter (where source.movement_value is not null)::bigint';
begin
  select pg_get_functiondef(to_regprocedure(
    'public.get_xnt_report_v2(timestamptz,timestamptz,uuid,text)'
  )) into v_definition;
  if v_definition is null then
    raise exception '00441: XNT function missing';
  end if;
  if position('period_in_complete' in v_definition) > 0 then return; end if;
  if position('internal_sale_cost.total_cost' in v_definition) = 0
     or position('movement.reference_type = ''bom_consume''' in v_definition) = 0
     or position(v_anchor in v_definition) = 0 then
    raise exception '00441: unexpected XNT definition; apply after 00411';
  end if;

  v_definition := replace(v_definition, v_anchor, $new$
      count(*) filter (where source.created_at >= p_date_from
        and source.type = 'in' and source.movement_value is null
        and abs(source.quantity) > 0.0000001) as period_in_missing,
      count(*) filter (where source.created_at >= p_date_from
        and source.type = 'out' and source.movement_value is null
        and abs(source.quantity) > 0.0000001) as period_out_missing,
      coalesce(sum(source.quantity) filter (where source.created_at >= p_date_from
        and source.type = 'in'), 0) as period_in_qty,
      coalesce(sum(source.quantity) filter (where source.created_at >= p_date_from
        and source.type = 'out'), 0) as period_out_qty,
      count(*) filter (where source.movement_value is not null)::bigint$new$);

  v_anchor := 'coalesce(valued_row.valued_movement_count, 0)::bigint as valued_count,';
  if position(v_anchor in v_definition) = 0 then
    raise exception '00441: resolved valuation anchor missing';
  end if;
  v_definition := replace(v_definition, v_anchor, $new$
      (coalesce(valued_row.period_in_missing, 0) = 0
       and abs(coalesce(valued_row.period_in_qty, 0)
         - (quantity_row.in_supplier + quantity_row.in_check + quantity_row.in_return
            + quantity_row.in_transfer + quantity_row.in_production + quantity_row.in_other)) <= 0.0001
       and coalesce(valued_row.in_value_raw, 0) >= -0.0001) as period_in_complete,
      (coalesce(valued_row.period_out_missing, 0) = 0
       and abs(coalesce(valued_row.period_out_qty, 0)
         - (quantity_row.out_sale + quantity_row.out_disposal + quantity_row.out_supplier_return
            + quantity_row.out_check + quantity_row.out_transfer + quantity_row.out_production
            + quantity_row.out_internal + quantity_row.out_other)) <= 0.0001
       and coalesce(valued_row.out_value_raw, 0) >= -0.0001) as period_out_complete,
      coalesce(valued_row.valued_movement_count, 0)::bigint as valued_count,$new$);

  if position('case when resolved.is_complete then resolved.in_value_raw else null end,' in v_definition) = 0
     or position('case when resolved.is_complete then resolved.out_value_raw else null end,' in v_definition) = 0 then
    raise exception '00441: output valuation anchors missing';
  end if;
  v_definition := replace(v_definition,
    'case when resolved.is_complete then resolved.in_value_raw else null end,',
    'case when resolved.period_in_complete then resolved.in_value_raw else null end,');
  v_definition := replace(v_definition,
    'case when resolved.is_complete then resolved.out_value_raw else null end,',
    'case when resolved.period_out_complete then resolved.out_value_raw else null end,');
  execute v_definition;
end $$;

commit;
