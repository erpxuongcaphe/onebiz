-- FIFO allocation rows point to lots, not products. They must use the same
-- canonical grams as the lot so later reversal/reconciliation cannot mix units.
-- This updates the private cutover implementation only, not business rows.
begin;
do $fifo$ declare definition text;anchor text;addition text;begin
 definition:=pg_get_functiondef('public.rebase_prepared_stock_to_grams_00517(uuid,text,numeric)'::regprocedure);
 if position('FIFO quantities share the lot stock unit' in definition)>0 then return;end if;
 anchor:='-- This is unit normalization, not a new receipt or cost event.';
 if position(anchor in definition)=0 then raise exception 'GRAM_FIFO_IMPLEMENTATION_CHANGED';end if;
 addition:=$body$-- FIFO quantities share the lot stock unit; retain original rows privately.
 perform 1 from public.lot_allocations a join public.product_lots l on l.id=a.lot_id
 where l.product_id=p_product order by a.id for update of a;
 insert into public.prepared_stock_unit_rows_00517(product_id,table_name,row_id,old_data)
 select p_product,'lot_allocations',a.id::text,to_jsonb(a) from public.lot_allocations a
 join public.product_lots l on l.id=a.lot_id where l.product_id=p_product;
 update public.lot_allocations a set quantity=a.quantity*p_factor
 from public.product_lots l where l.id=a.lot_id and l.product_id=p_product;
 $body$;
 definition:=replace(definition,anchor,addition||anchor);
 anchor:='or exists(select 1 from prepared_stock_unit_rows_00517 r join fnb_branch_product_cost_events s';
 if position(anchor in definition)=0 then raise exception 'GRAM_FIFO_PROOF_CHANGED';end if;
 addition:=$body$or exists(select 1 from public.prepared_stock_unit_rows_00517 r join public.lot_allocations a on a.id::text=r.row_id
 where r.product_id=p_product and r.table_name='lot_allocations' and a.quantity<>(r.old_data->>'quantity')::numeric*p_factor)
 $body$;
 definition:=replace(definition,anchor,addition||anchor);
 execute definition;
end;$fifo$;
commit;
