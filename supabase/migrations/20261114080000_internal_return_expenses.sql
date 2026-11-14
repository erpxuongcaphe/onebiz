begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

alter table public.internal_stock_return_items
 add column receiving_treatment text not null default 'stock'
 check (receiving_treatment in ('stock', 'expense'));

do $migration$
declare
 definition text;
 function_name text;
 patch record;
begin
 for patch in select * from (values
  ('public.send_internal_stock_return(uuid,jsonb,text,uuid)', 'lot record; lot_take numeric; lot_remaining numeric;',
   'lot record; lot_take numeric; lot_remaining numeric; treatment text; charged_qty numeric; confirmed_return_qty numeric;'),
  ('public.send_internal_stock_return(uuid,jsonb,text,uuid)', $old$  if coalesce((select treatment from internal_receiving_usage_confirmations where sale_item_id=i.id and tenant_id=t),i.receiving_treatment,'stock')<>'stock' then
   raise exception 'RETURN_NON_STOCK_ITEM' using detail=i.product_name;
  end if;
  product:=coalesce(i.receiving_product_id,i.product_id); factor:=coalesce(i.receiving_factor,1);$old$,
   $new$  select coalesce((select c.treatment from internal_receiving_usage_confirmations c where c.sale_item_id=i.id and c.tenant_id=t),i.receiving_treatment,'stock') into treatment;
  if treatment not in ('stock','expense') or (treatment='expense' and s.receipt_mode<>'actual') then
   raise exception 'RETURN_NON_STOCK_ITEM' using detail=i.product_name;
  end if;
  product:=case when treatment='expense' then i.product_id else coalesce(i.receiving_product_id,i.product_id) end;
  factor:=case when treatment='expense' then 1 else coalesce(i.receiving_factor,1) end;$new$),
  ('public.send_internal_stock_return(uuid,jsonb,text,uuid)', '  update branch_stock set quantity=quantity-stock_qty,updated_at=now()',
   $new$  if treatment='expense' then
   select coalesce(sum(e.quantity),0) into charged_qty from internal_receipt_expense_sources e
    where e.tenant_id=t and e.sale_id=s.id and e.sale_item_id=i.id and e.is_active;
   select coalesce(sum(ri.received),0) into confirmed_return_qty from internal_stock_return_items ri where ri.sale_item_id=i.id;
   if charged_qty<>received_qty-confirmed_return_qty then
    raise exception 'RETURN_EXPENSE_SOURCE_MISMATCH' using detail=i.product_name;
   end if;
   branch_cost:=0;
   lot_result:='[]'::jsonb;
  else
  update branch_stock set quantity=quantity-stock_qty,updated_at=now()$new$),
  ('public.send_internal_stock_return(uuid,jsonb,text,uuid)', '  insert into internal_stock_return_items(return_id',
   E'  end if;\n  insert into internal_stock_return_items(return_id'),
  ('public.send_internal_stock_return(uuid,jsonb,text,uuid)', 'credit_per_unit,warehouse_unit_cost,branch_unit_cost,lots)',
   'credit_per_unit,warehouse_unit_cost,branch_unit_cost,lots,receiving_treatment)'),
  ('public.send_internal_stock_return(uuid,jsonb,text,uuid)', 'credit,warehouse_cost,branch_cost,lot_result);',
   'credit,warehouse_cost,branch_cost,lot_result,treatment);'),
  ('public.receive_internal_stock_return(uuid,jsonb,text,uuid)', 'prior_qty numeric; line_credit numeric;',
   'prior_qty numeric; line_credit numeric; expense_receipt record;'),
  ('public.receive_internal_stock_return(uuid,jsonb,text,uuid)', '  update internal_stock_return_items set received=received+qty where id=i.id;',
   $new$  update internal_stock_return_items set received=received+qty where id=i.id;
  if i.receiving_treatment='expense' then
   select receipt.id,receipt.revision into strict expense_receipt
    from internal_sale_receipts receipt
    join internal_sale_receipt_items line on line.receipt_id=receipt.id
    where receipt.internal_sale_id=s.id and line.sale_item_id=i.sale_item_id and line.quantity>0
    order by receipt.created_at,receipt.id limit 1;
   perform public._sync_internal_receipt_expense_00570(s.id,expense_receipt.id,i.sale_item_id,0,expense_receipt.revision,'Nhận trả nội bộ '||r.code,a);
  end if;$new$),
  ('public._sync_internal_receipt_expense_00570(uuid,uuid,uuid,numeric,integer,text,uuid)', ' v_cost_allocated numeric:=0;',
   ' v_returned_qty numeric; v_receipt_return_qty numeric; v_cost_allocated numeric:=0;'),
  ('public._sync_internal_receipt_expense_00570(uuid,uuid,uuid,numeric,integer,text,uuid)', ' -- Cumulative rounding keeps all partial receipts equal to the original line.',
   $new$ select coalesce(sum(received),0) into v_returned_qty
  from internal_stock_return_items where sale_item_id=p_item and receiving_treatment='expense';
 -- Consume confirmed returns in receipt order. Receipt history remains the
 -- source of truth for quantities and the existing ledger records revisions.
 -- Cumulative rounding keeps all partial receipts equal to the original line.$new$),
  ('public._sync_internal_receipt_expense_00570(uuid,uuid,uuid,numeric,integer,text,uuid)', '  v_cumulative:=v_cumulative+v_quantity;',
   $new$  v_receipt_return_qty:=least(v_quantity,v_returned_qty);
  v_returned_qty:=v_returned_qty-v_receipt_return_qty;
  v_quantity:=v_quantity-v_receipt_return_qty;
  v_cumulative:=v_cumulative+v_quantity;$new$)
 ) x(function_name,old_text,new_text) loop
  if function_name is distinct from patch.function_name then
   if function_name is not null then execute definition; end if;
   function_name:=patch.function_name;
   definition:=replace(pg_get_functiondef(to_regprocedure(function_name)),chr(13)||chr(10),chr(10));
  end if;
  if definition is null or (length(definition)-length(replace(definition,patch.old_text,'')))/length(patch.old_text)<>1 then
   raise exception 'INTERNAL_RETURN_EXPENSE_FUNCTION_CHANGED: % (%)',patch.function_name,left(patch.old_text,80);
  end if;
  definition:=replace(definition,patch.old_text,patch.new_text);
 end loop;
 execute definition;
end
$migration$;

notify pgrst,'reload schema';
commit;
