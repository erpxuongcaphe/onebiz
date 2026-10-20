\set ON_ERROR_STOP on
\ir 00454_fnb_effective_unpaid_quantities.integration.sql
alter table kitchen_orders add merged_into_id uuid;
alter table kitchen_order_items add batch_id uuid, add kitchen_station_id uuid, add started_at timestamptz, add completed_at timestamptz;
\ir ../migrations/202610200004_fnb_split_quantities.sql
insert into kitchen_orders(id,tenant_id,branch_id,status,order_number,discount_amount)
values('00000000-0000-0000-0000-000000000050','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','served','UAT-ONE-CUP',10000);
insert into kitchen_order_items(id,kitchen_order_id,product_id,product_name,quantity,unit_price,cancelled_qty,toppings,modifier_selections,note,status,completed_at,batch_id)
values('00000000-0000-0000-0000-000000000051','00000000-0000-0000-0000-000000000050','00000000-0000-0000-0000-000000000010','Coffee',3,30000,1,'[{"quantity":1,"price":5000}]','[]','Less ice','ready',now(),'00000000-0000-0000-0000-000000000052');
do $$ declare r jsonb; again jsonb; child uuid; selection jsonb:='[{"item_id":"00000000-0000-0000-0000-000000000051","quantity":1,"expected_quantity":2}]'; child_item uuid; coffee_before numeric; begin
 r:=split_kitchen_order_quantities_20261020('00000000-0000-0000-0000-000000000050',selection,'00000000-0000-0000-0000-000000000053');
 child:=(r->'children'->0->>'order_id')::uuid;
 if (select quantity from kitchen_order_items where id='00000000-0000-0000-0000-000000000051')<>2 or (select cancelled_qty from kitchen_order_items where id='00000000-0000-0000-0000-000000000051')<>1 then raise exception 'Original cancellation history lost'; end if;
 select id into child_item from kitchen_order_items where kitchen_order_id=child;
 if (select quantity from kitchen_order_items where id=child_item)<>1 or (select cancelled_qty from kitchen_order_items where id=child_item)<>0
    or (select note from kitchen_order_items where id=child_item)<>'Less ice' or (select status from kitchen_order_items where id=child_item)<>'ready'
    or (select completed_at from kitchen_order_items where id=child_item) is null or (select toppings from kitchen_order_items where id=child_item)<>'[{"quantity":1,"price":5000}]'::jsonb then raise exception 'Partial line snapshots changed'; end if;
 if (select discount_amount from kitchen_orders where id=child)<>5000 or (select discount_amount from kitchen_orders where id='00000000-0000-0000-0000-000000000050')<>5000 then raise exception 'Topping-inclusive discount allocation wrong'; end if;
 again:=split_kitchen_order_quantities_20261020('00000000-0000-0000-0000-000000000050',selection,'00000000-0000-0000-0000-000000000053');
 if r is distinct from again or (select count(*) from kitchen_orders where parent_order_id='00000000-0000-0000-0000-000000000050')<>1 then raise exception 'Retry split twice'; end if;
 begin perform split_kitchen_order_quantities_20261020('00000000-0000-0000-0000-000000000050',selection,'00000000-0000-0000-0000-000000000054'); raise exception 'Stale quantity accepted'; exception when sqlstate 'PT409' then null; end;
 begin perform split_kitchen_order_quantities_20261020('00000000-0000-0000-0000-000000000050',jsonb_set(selection,'{0,expected_quantity}','1'),'00000000-0000-0000-0000-000000000054'); raise exception 'Moved entire remaining bill'; exception when invalid_parameter_value then if sqlerrm<>'SPLIT_PARENT_EMPTY' then raise; end if; end;
 begin perform split_kitchen_order_quantities_20261020('00000000-0000-0000-0000-000000000050',jsonb_set(selection,'{0,quantity}','0'),'00000000-0000-0000-0000-000000000053'); raise exception 'Request content reuse accepted'; exception when invalid_parameter_value then if sqlerrm<>'SPLIT_REQUEST_CHANGED' then raise; end if; end;
 begin perform split_kitchen_order_quantities_20261020('00000000-0000-0000-0000-000000000050',jsonb_set(jsonb_set(selection,'{0,quantity}','1.5'),'{0,expected_quantity}','1'),'00000000-0000-0000-0000-000000000054'); raise exception 'Fraction accepted'; exception when invalid_parameter_value then if sqlerrm<>'SPLIT_QUANTITY_INVALID' then raise; end if; end;
 begin perform split_kitchen_order_quantities_20261020('00000000-0000-0000-0000-000000000050',jsonb_set(selection,'{0,item_id}','"00000000-0000-0000-0000-000000000021"'),'00000000-0000-0000-0000-000000000054'); raise exception 'Foreign order item accepted'; exception when invalid_parameter_value then if sqlerrm<>'SPLIT_ITEM_NOT_IN_ORDER' then raise; end if; end;
 if (select count(*) from audit_log where action='fnb_split_quantities'  and entity_id='00000000-0000-0000-0000-000000000050')<>1 then raise exception 'Duplicate audit'; end if;
 select quantity into coffee_before from branch_stock where branch_id='00000000-0000-0000-0000-000000000003' and product_id='00000000-0000-0000-0000-000000000011';
 perform test_pay(child); perform test_pay('00000000-0000-0000-0000-000000000050');
 if (select total from invoices where id=(select invoice_id from kitchen_orders where id=child))<>30000
    or (select total from invoices where id=(select invoice_id from kitchen_orders where id='00000000-0000-0000-0000-000000000050'))<>30000 then raise exception 'Checkout amount changed across split'; end if;
 if coffee_before-(select quantity from branch_stock where branch_id='00000000-0000-0000-0000-000000000003' and product_id='00000000-0000-0000-0000-000000000011')<>0.04 then raise exception 'Split double consumed ingredients'; end if;
 if not exists(select 1 from fnb_invoice_kitchen_line_sources where kitchen_order_item_id=child_item) then raise exception 'Child invoice lost exact source'; end if;
 if has_function_privilege('anon','public.split_kitchen_order_quantities_20261020(uuid,jsonb,uuid)','execute') then raise exception 'Anonymous split allowed'; end if;
end $$;
select set_config('test.actor','00000000-0000-0000-0000-000000000099',false);
do $$ begin
 begin perform split_kitchen_order_quantities_20261020('00000000-0000-0000-0000-000000000050','[]','00000000-0000-0000-0000-000000000053'); raise exception 'Unauthenticated profile accepted'; exception when insufficient_privilege then null; end;
end $$;
select 'Partial quantity, cancellation history, topping snapshots, discount, replay, stale write and real checkout passed' as result;
