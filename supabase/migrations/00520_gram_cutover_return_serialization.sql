-- Readers that will restore stock must take the same product locks before
-- reading legacy quantities. A cutover cannot interleave with a paid return.
begin;
do $serialization$ declare definition text;anchor text;begin
 definition:=pg_get_functiondef('public._restore_fnb_invoice_item_bom_00410(uuid,uuid,uuid,uuid,numeric,uuid,uuid,text,uuid)'::regprocedure);
 anchor:='v_prior_return_qty := v_sale.returned_qty;';
 if position(anchor in definition)=0 then raise exception 'GRAM_RETURN_LOCK_IMPLEMENTATION_CHANGED';end if;
 if position('Serialize legacy return units with a gram cutover' in definition)=0 then
  execute replace(definition,anchor,$body$
  -- Serialize legacy return units with a gram cutover before reading snapshots.
  perform 1 from public.products p where p.id in
    (select material_id from public.fnb_invoice_item_bom_snapshot_components_00410 where invoice_item_id=p_invoice_item_id)
    order by p.id for share;
  $body$||anchor);
 end if;
 definition:=pg_get_functiondef('public.fnb_void_invoice_atomic(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid)'::regprocedure);
 if definition !~ E'\n[Bb][Ee][Gg][Ii][Nn][[:space:]]*\n' then raise exception 'GRAM_VOID_LOCK_IMPLEMENTATION_CHANGED';end if;
 if position('Serialize original issue quantities with a gram cutover' in definition)=0 then
  execute regexp_replace(definition,E'\n[Bb][Ee][Gg][Ii][Nn][[:space:]]*\n',$body$
begin
  -- Serialize original issue quantities with a gram cutover before delegating.
  perform 1 from public.products p where p.id in
    (select product_id from public.stock_movements where tenant_id=p_tenant_id and reference_id=p_invoice_id)
    order by p.id for share;
  $body$);
 end if;
end;$serialization$;
commit;
