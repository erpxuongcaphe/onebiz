-- For a measured reduction at a branch with its own cost ledger, validate
-- the stock and cost at that branch even if other branches make the total negative.
do $migration$
declare
  definition text := replace(pg_get_functiondef(
    'public._production_used_adjustment(uuid,timestamptz,numeric,jsonb,text,boolean,uuid,text)'::regprocedure
  ), E'\r\n', E'\n');
  old_guard text := $sql$if bs.quantity+output_delta<0 or p.stock+output_delta<0 then raise exception 'PRODUCTION_CORRECTION_STOCK_REQUIRED'; end if;
 tracked:=_fnb_branch_cost_tracking_enabled_00390(tenant,po.branch_id);$sql$;
  new_guard text := $sql$tracked:=_fnb_branch_cost_tracking_enabled_00390(tenant,po.branch_id);
 branch_balance_only:=tracked and po.variant_id is null and output_delta<0 and p.stock<0;
 if bs.quantity+output_delta<0 or (p.stock+output_delta<0 and not branch_balance_only) then
  raise exception 'PRODUCTION_CORRECTION_STOCK_REQUIRED';
 end if;$sql$;
  material_guard text := 'if output_lot_gap>.0001 and d<>0 then';
begin
  if strpos(definition,old_guard)=0 or strpos(definition,material_guard)=0
     or strpos(definition,'output_lot_gap numeric;')=0 then
    raise exception 'PRODUCTION_OUTPUT_BRANCH_BALANCE_SOURCE_CHANGED';
  end if;
  definition := replace(definition,'output_lot_gap numeric;','output_lot_gap numeric; branch_balance_only boolean;');
  definition := replace(definition,old_guard,new_guard);
  definition := replace(definition,material_guard,'if (output_lot_gap>.0001 or branch_balance_only) and d<>0 then');
  execute definition;
end;
$migration$;
