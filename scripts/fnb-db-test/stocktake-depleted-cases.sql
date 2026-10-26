do $test$
declare t uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); other_branch uuid:=gen_random_uuid();
 actor uuid:=gen_random_uuid(); product uuid:=gen_random_uuid(); unknown uuid:=gen_random_uuid();
 quote uuid:=gen_random_uuid(); doc uuid:=gen_random_uuid(); movement uuid; before_count integer;
begin
 insert into tenants values(t); insert into branches values(b,t),(other_branch,t);
 insert into profiles(id,tenant_id,role) values(actor,t,'owner');
 perform set_config('test.actor',actor::text,false);
 perform branch_sale_stock_policy_00473(b,true);
 insert into products(id,tenant_id,code,name,stock,inventory_role) values
 (product,t,'COUNT-KNOWN','Known prepared batch',0,'fnb_material'),
 (unknown,t,'COUNT-UNKNOWN','Unknown cost',0,'fnb_material'),
 (quote,t,'COUNT-ZERO','Zero opening quote',0,'fnb_material');
 insert into inventory_checks values(doc,t,b);
 -- Real receipt followed by a sale beyond stock leaves a known-price deficit.
 perform _post_fnb_branch_cost_in_00390(t,b,product,2,100,'purchase_receipt','purchase_receipt',gen_random_uuid());
 perform _post_fnb_branch_cost_in_00390(t,b,product,2,200,'purchase_receipt','purchase_receipt',gen_random_uuid());
 perform _post_fnb_branch_cost_out_00390(t,b,product,5,'bom_consume','invoice',gen_random_uuid());
 insert into branch_stock(tenant_id,branch_id,product_id,quantity) values(t,b,product,-1);
 perform test_assert((select deficit_quantity=1 and costed_quantity=0 from fnb_branch_product_cost_balances where branch_id=b and product_id=product),'deficit fixture');
 -- Counting 2 from -1 produces an adjustment in of 3; 1 settles the deficit.
 update branch_stock set quantity=2 where branch_id=b and product_id=product;
 insert into stock_movements(tenant_id,branch_id,product_id,type,quantity,reference_type,reference_id,created_by)
 values(t,b,product,'in',3,'inventory_check',doc,actor);
 perform test_assert((select deficit_quantity=0 and costed_quantity=2 and total_cost=300 and unit_cost=150 from fnb_branch_product_cost_balances where branch_id=b and product_id=product),'stocktake settles deficit and values only remaining stock');
 perform test_assert((select sum(pending_quantity)=0 from fnb_sale_cost_shortfalls_00473 where branch_id=b and product_id=product),'FIFO shortfalls settled');
 -- Exhaust known stock again; stocktake at zero still has a receipt cost.
 perform _post_fnb_branch_cost_out_00390(t,b,product,2,'inventory_adjustment','inventory_check',doc);
 update branch_stock set quantity=0 where branch_id=b and product_id=product;
 insert into stock_movements(tenant_id,branch_id,product_id,type,quantity,reference_type,reference_id,created_by)
 values(t,b,product,'in',.5,'inventory_check',doc,actor);
 perform test_assert((select costed_quantity=.5 and total_cost=75 from fnb_branch_product_cost_balances where branch_id=b and product_id=product),'depleted receipt cost retained');
 -- Unknown cost cannot borrow another branch's receipt or global catalog price.
 perform _post_fnb_branch_cost_in_00390(t,other_branch,unknown,1,999,'purchase_receipt','purchase_receipt',gen_random_uuid());
 insert into fnb_branch_product_cost_balances(tenant_id,branch_id,product_id) values(t,b,unknown);
 select count(*) into before_count from stock_movements;
 begin
  insert into stock_movements(tenant_id,branch_id,product_id,type,quantity,reference_type,reference_id)
  values(t,b,unknown,'in',1,'inventory_check',doc);
  raise exception 'TEST_EXPECTED_UNKNOWN_COST';
 exception when others then if sqlerrm<>'FNB_MANUAL_STOCK_GAIN_COST_REQUIRED' then raise;end if;end;
 perform test_assert((select count(*)=before_count from stock_movements),'failed stocktake rolls back movement');
 perform test_assert((select costed_quantity=0 and total_cost=0 from fnb_branch_product_cost_balances where branch_id=b and product_id=unknown),'unknown balance unchanged');
 insert into fnb_branch_product_cost_balances(tenant_id,branch_id,product_id,opening_cost_confirmed,unit_cost) values(t,b,quote,true,0);
 insert into stock_movements(tenant_id,branch_id,product_id,type,quantity,reference_type,reference_id)
 values(t,b,quote,'in',1,'inventory_check',doc);
 perform test_assert((select costed_quantity=1 and total_cost=0 from fnb_branch_product_cost_balances where branch_id=b and product_id=quote),'explicit zero opening quote still allowed');
 -- Other inventory operations retain their original restriction.
 perform _post_fnb_branch_cost_out_00390(t,b,product,.5,'inventory_adjustment','inventory_check',doc);
 begin
  insert into stock_movements(tenant_id,branch_id,product_id,type,quantity,reference_type,reference_id)
  values(t,b,product,'in',1,'stock_adjustment',gen_random_uuid());
  raise exception 'TEST_EXPECTED_ADJUSTMENT_GUARD';
 exception when others then if sqlerrm<>'FNB_MANUAL_STOCK_GAIN_COST_REQUIRED' then raise;end if;end;
end $test$;
