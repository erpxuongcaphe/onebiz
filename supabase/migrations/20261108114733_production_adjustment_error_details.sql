-- Add diagnostic context to existing validation errors without changing their codes.
do $migration$
declare
  definition text := replace(pg_get_functiondef(
    'public._production_used_adjustment(uuid,timestamptz,numeric,jsonb,text,boolean,uuid,text)'::regprocedure
  ), E'\r\n', E'\n');
  unchanged_raise text := 'raise exception ''PRODUCTION_CORRECTION_LOT_RECONCILIATION_REQUIRED''';
  replacements text[] := array[
    $lot$ using detail = jsonb_build_object('kind','batch_lot','lot',lot.lot_number,
      'completed',po.completed_qty,'initial',lot.initial_qty,'remaining',lot.current_qty,'unit',p.unit)::text$lot$,
    $allocation$ using detail = jsonb_build_object('kind','allocation','lot',lot.lot_number,
      'used',used_qty,'allocated',allocation_qty,'unit',p.unit)::text$allocation$,
    $output$ using detail = jsonb_build_object('kind','stock','product',p.name,'unit',p.unit,'stock',bs.quantity,
      'lots',(select coalesce(sum(current_qty),0) from product_lots where tenant_id=tenant and branch_id=po.branch_id
        and product_id=po.product_id and variant_id is not distinct from po.variant_id and status in ('active','expired')))::text$output$,
    $material$ using detail = jsonb_build_object('kind','stock','product',m.name,'unit',m.stock_unit,'stock',bs.quantity,
      'lots',(select coalesce(sum(current_qty),0) from product_lots where tenant_id=tenant and branch_id=po.branch_id
        and product_id=m.product_id and variant_id is null and status in ('active','expired')))::text$material$
  ];
  pieces text[];
  patched text;
begin
  pieces := string_to_array(definition, unchanged_raise);
  if cardinality(pieces) <> 5
    or strpos(pieces[1], 'abs(lot.initial_qty-po.completed_qty)') = 0
    or strpos(pieces[2], 'abs(allocation_qty-used_qty)') = 0
    or strpos(pieces[3], 'product_id=po.product_id and variant_id is not distinct from po.variant_id and status') = 0
    or strpos(pieces[4], 'product_id=m.product_id and variant_id is null and status') = 0 then
    raise exception 'PRODUCTION_ADJUSTMENT_DIAGNOSTICS_SOURCE_CHANGED';
  end if;
  patched := pieces[1];
  for i in 1..4 loop
    patched := patched || unchanged_raise || replacements[i] || pieces[i+1];
  end loop;
  execute patched;
end;
$migration$;
