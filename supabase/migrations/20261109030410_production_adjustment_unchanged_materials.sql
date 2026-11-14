-- Validate current inventory only for ingredients with a normalized quantity delta.
do $migration$
declare
  definition text := replace(pg_get_functiondef(
    'public._production_used_adjustment(uuid,timestamptz,numeric,jsonb,text,boolean,uuid,text)'::regprocedure
  ), E'\r\n', E'\n');
  checks text := substring(definition from $rx$select \* into bs from branch_stock where tenant_id=tenant and branch_id=po\.branch_id and product_id=m\.product_id and variant_id is null;.*?then raise exception 'PRODUCTION_CORRECTION_COST_REQUIRED'; end if;[[:space:]]+if not tracked and exists.*?then raise exception 'PRODUCTION_CORRECTION_COST_REQUIRED'; end if;$rx$);
  stock_read text := 'select * into bs from branch_stock where tenant_id=tenant and branch_id=po.branch_id and product_id=m.product_id and variant_id is null;';
  state_anchor text := 'state:=state||jsonb_build_object(m.product_id::text';
  token_anchor text := $sql$'state',state,'plan',plan,'reason'$sql$;
begin
  if checks is null or strpos(checks,'PRODUCTION_CORRECTION_STOCK_REQUIRED')=0
     or strpos(definition,token_anchor)=0 or strpos(definition,state_anchor)=0 then
    raise exception 'PRODUCTION_UNCHANGED_MATERIAL_SOURCE_CHANGED';
  end if;
  definition := replace(definition,checks,replace(checks,stock_read,stock_read || E'\n  if d<>0 then') || E'\n  end if;');
  definition := replace(definition,state_anchor,'if d<>0 then ' || state_anchor);
  definition := replace(definition,$sql$and product_id=m.product_id)));
 end loop;$sql$,$sql$and product_id=m.product_id))); end if;
 end loop;$sql$);
  if strpos(definition,'and product_id=m.product_id))); end if;')=0 then
    raise exception 'PRODUCTION_UNCHANGED_MATERIAL_SNAPSHOT_SOURCE_CHANGED';
  end if;
  -- Keep current stock in the display but exclude it from the confirmation
  -- token when the ingredient is only listed for reference.
  definition := replace(definition,token_anchor,$sql$'state',state,'plan',jsonb_set(plan,'{materials}',(
  select jsonb_agg(case when (row.value->>'stockDelta')::numeric=0
    then row.value-'stockBefore'-'stockAfter' else row.value end order by row.position)
  from jsonb_array_elements(snapshots) with ordinality as row(value,position)
  )),'reason'$sql$);
  execute definition;
end;
$migration$;
