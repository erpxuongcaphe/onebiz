do $test$
declare t uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); b2 uuid:=gen_random_uuid();
 a uuid:=gen_random_uuid(); cashier uuid:=gen_random_uuid(); sku uuid:=gen_random_uuid(); mat uuid:=gen_random_uuid();
 unknown uuid:=gen_random_uuid(); recipe uuid:=gen_random_uuid(); inv uuid:=gen_random_uuid(); inv2 uuid:=gen_random_uuid();
 movement uuid:=gen_random_uuid(); line uuid:=gen_random_uuid(); payload jsonb; qty numeric; event_count integer;
begin
 insert into tenants values(t); insert into branches values(b,t),(b2,t);
 insert into profiles(id,tenant_id,role) values(a,t,'owner'),(cashier,t,'cashier');
 perform set_config('test.actor',a::text,false);
 perform test_assert(not branch_sale_stock_policy_00473(b),'F&B remains blocked until enabled');
 insert into products(id,tenant_id,code,name,stock,inventory_role) values(sku,t,'TEST-MENU','Drink',0,'fnb_menu_item'),(mat,t,'TEST-MAT','Milk',.01,'fnb_material'),(unknown,t,'TEST-UNKNOWN','Bottle',0,'fnb_material');
 insert into bom(id,tenant_id,product_id,code,name) values(recipe,t,sku,'TEST-BOM','Drink');
 insert into bom_items(bom_id,material_id,unit,quantity) values(recipe,mat,'Kg',.015);
 insert into branch_stock(tenant_id,branch_id,product_id,quantity) values(t,b,mat,.01),(t,b2,mat,2);
 insert into product_lots(tenant_id,branch_id,product_id,lot_number,current_qty) values(t,b,mat,'TEST-OPENING',.01);
 insert into fnb_branch_product_cost_balances(tenant_id,branch_id,product_id,costed_quantity,total_cost,unit_cost,opening_cost_confirmed) values(t,b,mat,.01,1000,100000,true);
 begin
 perform consume_bom_for_sale(t,b,sku,1,inv,a); raise exception 'TEST_EXPECTED_BLOCK';
 exception when others then if sqlerrm='TEST_EXPECTED_BLOCK' then raise; end if; end;
 perform test_assert((select quantity=.01 from branch_stock where branch_id=b and product_id=mat),'blocked sale leaves stock untouched');
 perform test_assert(branch_sale_stock_policy_00473(b,true),'enable branch');
 perform test_assert(not branch_sale_stock_policy_00473(b2),'another branch stays blocked');
 perform set_config('test.actor',cashier::text,false);
 begin perform branch_sale_stock_policy_00473(b,false); raise exception 'TEST_EXPECTED_DENIAL'; exception when insufficient_privilege then null; end;
 perform set_config('test.actor',a::text,false);
 payload:=consume_bom_for_sale(t,b,sku,1,inv,a);
 perform test_assert(jsonb_array_length(payload->'warnings')=1,'POS shortage warning');
 perform test_assert((select abs(quantity-(-.005))<.0001 from branch_stock where branch_id=b and product_id=mat),'full BOM deducted to negative stock');
 perform test_assert((select abs(stock-(-.005))<.0001 from products where id=mat),'company aggregate follows deduction');
 perform test_assert((select sum(current_qty)=0 from product_lots where branch_id=b),'FIFO consumes available quantity when selling beyond stock');
 perform test_assert((select deficit_quantity=.005 and costed_quantity=0 from fnb_branch_product_cost_balances where branch_id=b and product_id=mat),'cost deficit matches short quantity');
 perform test_assert((select sum(total_cost)=1500 from fnb_branch_product_cost_events where source_reference_id=inv),'entire sale cost uses confirmed branch quote');
 perform test_assert((select quantity=2 from branch_stock where branch_id=b2 and product_id=mat),'other branch stock untouched');
 -- Retry the same movement cannot consume cost a second time.
 select source_stock_movement_id into movement from fnb_branch_product_cost_events where source_reference_id=inv;
 select count(*) into event_count from fnb_branch_product_cost_events;
 perform _post_fnb_branch_cost_out_00390(t,b,mat,.015,'bom_consume','bom_consume',inv,movement,null,a);
 perform test_assert((select count(*)=event_count from fnb_branch_product_cost_events),'outbound retry idempotent');
 -- Partial receipt fills shortage first, without manufacturing positive stock.
 movement:=gen_random_uuid();
 perform _post_fnb_branch_cost_in_00390(t,b,mat,.002,120000,'purchase_receipt','purchase_order',gen_random_uuid(),movement,null,a);
 perform upsert_branch_stock(t,b,mat,.002); perform increment_product_stock(mat,.002);
 insert into product_lots(tenant_id,branch_id,product_id,lot_number,current_qty) values(t,b,mat,'TEST-PARTIAL',.002);
 set constraints settle_negative_sale_lot_00473 immediate;
 perform test_assert((select sum(current_qty)=0 from product_lots where branch_id=b),'partial receipt lot settles stock still negative');
 set constraints settle_negative_sale_lot_00473 deferred;
 perform test_assert((select deficit_quantity=.003 and costed_quantity=0 from fnb_branch_product_cost_balances where branch_id=b and product_id=mat),'partial receipt only fills deficit');
 perform _post_fnb_branch_cost_in_00390(t,b,mat,.002,120000,'purchase_receipt','purchase_order',gen_random_uuid(),movement,null,a);
 perform test_assert((select deficit_quantity=.003 from fnb_branch_product_cost_balances where branch_id=b and product_id=mat),'receipt retry idempotent');
 perform _post_fnb_branch_cost_in_00390(t,b,mat,1,120000,'purchase_receipt','purchase_order',gen_random_uuid(),gen_random_uuid(),null,a);
 perform upsert_branch_stock(t,b,mat,1); perform increment_product_stock(mat,1);
 insert into product_lots(tenant_id,branch_id,product_id,lot_number,current_qty) values(t,b,mat,'TEST-RECEIPT',1);
 set constraints settle_negative_sale_lot_00473 immediate;
 perform test_assert((select sum(current_qty)=.997 from product_lots where branch_id=b),'receipt lots match branch stock after shortage settlement');
 set constraints settle_negative_sale_lot_00473 deferred;
 perform test_assert((select costed_quantity=.997 and deficit_quantity=0 and total_cost=119640 from fnb_branch_product_cost_balances where branch_id=b and product_id=mat),'late receipt restores exact available quantity and value');
 perform test_assert((select sum(settled_actual_cost)=600 from fnb_sale_cost_shortfalls_00473 where invoice_id=inv),'actual shortage cost recorded separately');
 perform test_assert((select total_cost=1500 from fnb_branch_product_cost_events where source_reference_id=inv and direction='out'),'original cost snapshot immutable');
 -- Switch off again: cost shortages remain blocked, including production.
 perform branch_sale_stock_policy_00473(b,false);
 begin perform _post_fnb_branch_cost_out_00390(t,b,mat,2,'bom_consume','bom_consume',inv2,gen_random_uuid(),null,a); raise exception 'TEST_EXPECTED_BLOCK';
 exception when others then if sqlerrm<>'FNB_BRANCH_COST_REQUIRED' then raise; end if; end;
 perform branch_sale_stock_policy_00473(b,true);
 begin perform _post_fnb_branch_cost_out_00390(t,b,mat,2,'production_consume','production_order',inv2,gen_random_uuid(),null,a); raise exception 'TEST_EXPECTED_BLOCK';
 exception when others then if sqlerrm<>'FNB_BRANCH_COST_REQUIRED' then raise; end if; end;
 -- No quote is visibly unknown, never a free-cost profit snapshot.
 perform _post_fnb_branch_cost_out_00390(t,b,unknown,1,'bom_consume','bom_consume',inv2,gen_random_uuid(),null,a);
 insert into invoices values(inv2,t,b,'fnb'); insert into invoice_items values(line,inv2,sku,1,123);
 perform _snapshot_fnb_invoice_line_cost_00412(line,0,0);
 perform test_assert((select unit_cost is null from invoice_items where id=line),'unknown material cost marks invoice profit incomplete');
 -- Void the unpaid cost deficit: no new shortage and no phantom leftover.
 perform _post_fnb_branch_cost_in_00390(t,b,unknown,1,0,'invoice_void_restore','invoice_void',inv2,gen_random_uuid(),null,a);
 perform test_assert((select deficit_quantity=0 and costed_quantity=0 from fnb_branch_product_cost_balances where branch_id=b and product_id=unknown),'void restores shortage without phantom stock');
 perform test_assert((select pending_quantity=0 from fnb_sale_cost_shortfalls_00473 where invoice_id=inv2),'void settles its own shortage');
end; $test$;
