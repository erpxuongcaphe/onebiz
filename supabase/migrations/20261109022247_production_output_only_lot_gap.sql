-- Allow a measured output reduction to preserve an existing surplus in the
-- branch lot ledger. The batch allocation and cost checks still apply.
do $migration$
declare
  definition text := replace(pg_get_functiondef(
    'public._production_used_adjustment(uuid,timestamptz,numeric,jsonb,text,boolean,uuid,text)'::regprocedure
  ), E'\r\n', E'\n');
  old_check text := substring(definition from $pattern$if not found or abs\(bs\.quantity-coalesce\(\(select sum\(current_qty\).*?end if;$pattern$);
  read_lot_gap text := $sql$
 if not found then
  raise exception 'PRODUCTION_CORRECTION_LOT_RECONCILIATION_REQUIRED'
   using detail = jsonb_build_object('kind','stock','product',p.name,'unit',p.unit,'stock',null,'lots',null)::text;
 end if;
 select coalesce(sum(current_qty),0) into output_lot_total
 from product_lots where tenant_id=tenant and branch_id=po.branch_id and product_id=po.product_id
   and variant_id is not distinct from po.variant_id and status in ('active','expired');
 output_lot_gap:=round(output_lot_total-bs.quantity,4);
 if output_lot_gap<-.0001 or (output_lot_gap>.0001 and (output_delta>=0 or po.variant_id is not null)) then
  raise exception 'PRODUCTION_CORRECTION_LOT_RECONCILIATION_REQUIRED'
   using detail = jsonb_build_object('kind','stock','product',p.name,'unit',p.unit,'stock',bs.quantity,'lots',output_lot_total)::text;
 end if;
$sql$;
  material_anchor text := 'q:=round((item->>''quantity'')::numeric*factor,4); d:=q-m.actual_qty;';
  material_guard text := $sql$
  if output_lot_gap>.0001 and d<>0 then
   raise exception 'PRODUCTION_ADJUSTMENT_OUTPUT_ONLY_WHEN_LOT_DRIFT';
  end if;
$sql$;
  plan_anchor text := 'token:=md5(jsonb_build_object';
  materials_update text := 'where x.production_order_id=po.id and x.product_id=(s->>''productId'')::uuid;';
begin
  if old_check is null or strpos(old_check,'''kind'',''stock'',''product'',p.name')=0
     or strpos(definition,'allocation_qty numeric;')=0
     or strpos(definition,material_anchor)=0 or strpos(definition,plan_anchor)=0
     or strpos(definition,materials_update)=0 then
    raise exception 'PRODUCTION_OUTPUT_ONLY_SOURCE_CHANGED';
  end if;
  definition := replace(definition,'allocation_qty numeric;','allocation_qty numeric; output_lot_total numeric; output_lot_gap numeric;');
  definition := replace(definition,old_check,read_lot_gap);
  definition := replace(definition,material_anchor,material_anchor || material_guard);
  definition := replace(definition,plan_anchor,$sql$if output_lot_gap>.0001 then
  plan:=plan||jsonb_build_object('existingLotGap',output_lot_gap);
 end if;
 $sql$ || plan_anchor);
  definition := replace(definition,materials_update,replace(materials_update,'::uuid;','::uuid and x.actual_qty is distinct from (s->>''after'')::numeric;'));
  execute definition;
end;
$migration$;
