-- Keep item notes when rebuilding the outgoing invoice from the POS payload.
do $migration$
declare
  signature regprocedure := 'public._checkout_internal_pos_before_fnb_bridge_20261023(jsonb)'::regprocedure;
  definition text;
  old_insert text := 'insert into invoice_items(invoice_id,product_id,product_name,unit,quantity,unit_price,discount,vat_rate,vat_amount,total)';
  old_values text := 'round((round(v_qty*v_price)-v_disc)*v_scale*v_vat/100),round(v_qty*v_price)-v_disc);';
begin
  definition := pg_get_functiondef(signature);
  if strpos(definition, old_insert) = 0
     or strpos(definition, old_values) = 0
     or length(definition) - length(replace(definition, old_insert, '')) <> length(old_insert)
     or length(definition) - length(replace(definition, old_values, '')) <> length(old_values) then
    raise exception 'INTERNAL_POS_ITEM_NOTE_SOURCE_CHANGED';
  end if;
  execute replace(
    replace(definition, old_insert, replace(old_insert, 'total)', 'total,note)')),
    old_values,
    'round((round(v_qty*v_price)-v_disc)*v_scale*v_vat/100),round(v_qty*v_price)-v_disc,nullif(v_item->>''note'',''''));'
  );
end;
$migration$;
