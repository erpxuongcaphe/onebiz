create or replace function user_has_permission(uuid,text) returns boolean language sql set search_path=public as $$
select $2<>coalesce(current_setting('test.deny_permission',true),'') and exists(select 1 from profiles where id=$1 and role='owner')$$;
do $test$
declare t uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); c uuid:=gen_random_uuid();
 source jsonb; plan jsonb; result jsonb; req uuid:=gen_random_uuid(); args jsonb; version text; saved_bill jsonb;
 movement_count int; audit_count int; before_qty numeric; before_cost numeric;
begin
 insert into tenants values(t);insert into branches values(b,t);insert into profiles(id,tenant_id,role) values(a,t,'owner');
 perform set_config('test.actor',a::text,false);
 insert into products(id,tenant_id,code,name,stock,unit,cost_price) values(p,t,'TEST-COUNT','Count material',15,'G',999);
 insert into branch_stock(tenant_id,branch_id,product_id,quantity) values(t,b,p,15);
 insert into product_lots(tenant_id,branch_id,product_id,current_qty,initial_qty,status) values(t,b,p,15,20,'active');
 insert into inventory_checks(id,tenant_id,branch_id,code,status,note,created_by) values(c,t,b,'KK-TEST','balanced','Original note',a);
 insert into inventory_check_items(check_id,product_id,product_name,system_stock,actual_stock,unit_cost) values(c,p,'Count material',10,20,100);
 perform _post_fnb_branch_cost_in_00390(t,b,p,10,100,'purchase_receipt','receipt',gen_random_uuid());
 insert into stock_movements(tenant_id,branch_id,product_id,type,quantity,reference_type,reference_id,created_by) values(t,b,p,'in',10,'inventory_check',c,a);
 -- A later paid sale must survive both correction and cancellation.
 insert into invoices(id,tenant_id,branch_id,source) values(gen_random_uuid(),t,b,'fnb');
 select to_jsonb(i) into saved_bill from invoices i where tenant_id=t;
 perform _post_fnb_branch_cost_out_00390(t,b,p,5,'bom_consume','invoice',(saved_bill->>'id')::uuid);
 source:=get_inventory_check_change_source(c);version:=source->>'version';args:=jsonb_build_array(jsonb_build_object('productId',p,'actualStock',18));
 select count(*) into movement_count from stock_movements;select count(*) into audit_count from audit_log;
 plan:=preview_inventory_check_change(c,'edit',args,'Corrected note','Recount actual quantity',version,req);
 perform test_assert((plan->'items'->0->>'stockDelta')::numeric=-2 and (plan->'items'->0->>'stockAfter')::numeric=13,'delta uses current stock after sale');
 perform test_assert((plan->>'costDelta')::numeric=-200,'preview uses branch cost 100, not global cost 999');
 perform test_assert((select count(*)=movement_count from stock_movements) and (select count(*)=audit_count from audit_log),'preview writes no document or stock');
 result:=apply_inventory_check_change(c,'edit',args,'Corrected note','Recount actual quantity',version,req,plan->>'token');
 perform test_assert((select quantity=13 from branch_stock where branch_id=b and product_id=p),'edit only incremental difference');
 perform test_assert((select costed_quantity=13 and total_cost=1300 from fnb_branch_product_cost_balances where branch_id=b and product_id=p),'edit cost ledger aligned');
 perform test_assert((select sum(current_qty)=13 from product_lots where branch_id=b and product_id=p and status in ('active','expired')),'edit FIFO aligned');
 perform apply_inventory_check_change(c,'edit',args,'Corrected note','Recount actual quantity',version,req,plan->>'token');
 perform test_assert((select quantity=13 from branch_stock where branch_id=b and product_id=p),'retry applies once');
 begin
  perform apply_inventory_check_change(c,'edit',args,'Different note','Recount actual quantity',version,req,plan->>'token');raise exception 'expected request conflict';
 exception when others then if sqlerrm<>'INVENTORY_CHECK_REQUEST_CONFLICT' then raise;end if;end;
 begin
  perform preview_inventory_check_change(c,'edit',args,'Corrected note','Old source version',version,gen_random_uuid());raise exception 'expected stale source';
 exception when others then if sqlerrm<>'INVENTORY_CHECK_SOURCE_CHANGED' then raise;end if;end;
 source:=get_inventory_check_change_source(c);version:=source->>'version';req:=gen_random_uuid();
 plan:=preview_inventory_check_change(c,'cancel','[]','Corrected note','Wrong count entry',version,req);
 perform test_assert((plan->'items'->0->>'stockDelta')::numeric=-8,'cancel reverses updated net effect, not original ten');
 -- A sale between preview and confirmation invalidates the preview.
 update branch_stock set quantity=quantity-1 where branch_id=b and product_id=p;update products set stock=stock-1 where id=p;
 perform _post_fnb_branch_cost_out_00390(t,b,p,1,'bom_consume','invoice',(saved_bill->>'id')::uuid);
 update product_lots set current_qty=current_qty-1 where branch_id=b and product_id=p and status='active';
 begin
  perform apply_inventory_check_change(c,'cancel','[]','Corrected note','Wrong count entry',version,req,plan->>'token');raise exception 'expected stale preview';
 exception when others then if sqlerrm<>'INVENTORY_CHECK_PREVIEW_STALE' then raise;end if;end;
 plan:=preview_inventory_check_change(c,'cancel','[]','Corrected note','Wrong count entry',version,req);
 -- Simulate a late failure: every stock/cost/lot/document change must roll back.
 select quantity into before_qty from branch_stock where branch_id=b and product_id=p;
 select total_cost into before_cost from fnb_branch_product_cost_balances where branch_id=b and product_id=p;
 execute 'create function test_fail_count_audit() returns trigger language plpgsql as $f$begin raise exception ''TEST_LATE_FAILURE'';end$f$';
 execute 'create trigger test_fail_count before insert on audit_log for each row execute function test_fail_count_audit()';
 begin
  perform apply_inventory_check_change(c,'cancel','[]','Corrected note','Wrong count entry',version,req,plan->>'token');raise exception 'expected late failure';
 exception when others then if sqlerrm<>'TEST_LATE_FAILURE' then raise;end if;end;
 perform test_assert((select quantity=before_qty from branch_stock where branch_id=b and product_id=p) and (select total_cost=before_cost from fnb_branch_product_cost_balances where branch_id=b and product_id=p),'late error rolls back stock and cost');
 execute 'drop trigger test_fail_count on audit_log';execute 'drop function test_fail_count_audit()';
 result:=apply_inventory_check_change(c,'cancel','[]','Corrected note','Wrong count entry',version,req,plan->>'token');
 perform test_assert((select quantity=4 from branch_stock where branch_id=b and product_id=p),'cancel preserves all six units sold since count');
 perform test_assert((select status='cancelled' from inventory_checks where id=c),'cancelled source retained');
 perform test_assert((select count(*)=2 from inventory_check_changes where check_id=c),'immutable correction and cancellation journals');
 perform test_assert((select to_jsonb(i)=saved_bill from invoices i where tenant_id=t),'paid bill unchanged');
 perform test_assert((select sum(case when type='in' then quantity else -quantity end)=0 from stock_movements where reference_type='inventory_check' and reference_id=c),'check net ledger zero after cancellation');
 perform test_assert(not has_function_privilege('authenticated','public._change_inventory_check(uuid,text,jsonb,text,text,text,uuid,text,boolean)','execute'),'private mutator not callable');
 perform test_assert(not has_table_privilege('authenticated','inventory_check_changes','insert'),'journal cannot be forged');
 perform test_assert(not has_table_privilege('authenticated','inventory_check_items','update'),'raw item patch cannot bypass stock posting');
end $test$;

do $test$
declare t uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); c uuid:=gen_random_uuid();
 other_t uuid:=gen_random_uuid(); other_a uuid:=gen_random_uuid(); src jsonb; plan jsonb; args jsonb; req uuid;
begin
 insert into tenants values(t),(other_t);insert into branches values(b,t);insert into profiles(id,tenant_id,role) values(a,t,'owner'),(other_a,other_t,'owner');
 perform set_config('test.actor',a::text,false);perform set_config('test.deny_permission','',false);
 insert into products(id,tenant_id,code,name,stock,unit,cost_price) values(p,t,'BLOCK','Used count gain',2,'G',500);
 insert into branch_stock(tenant_id,branch_id,product_id,quantity) values(t,b,p,2);
 insert into product_lots(tenant_id,branch_id,product_id,current_qty,initial_qty,status) values(t,b,p,2,10,'active');
 insert into inventory_checks(id,tenant_id,branch_id,code,status,note) values(c,t,b,'KK-USED','balanced','');
 insert into inventory_check_items(check_id,product_id,product_name,system_stock,actual_stock) values(c,p,'Used count gain',0,10);
 -- Keep the existing stocktake trigger and real cost helper, then consume eight.
 perform _post_fnb_branch_cost_in_00390(t,b,p,1,100,'purchase_receipt','receipt',gen_random_uuid());
 perform _post_fnb_branch_cost_out_00390(t,b,p,1,'inventory_adjustment','stock_adjustment',gen_random_uuid());
 insert into stock_movements(tenant_id,branch_id,product_id,type,quantity,reference_type,reference_id) values(t,b,p,'in',10,'inventory_check',c);
 perform _post_fnb_branch_cost_out_00390(t,b,p,8,'bom_consume','invoice',gen_random_uuid());
 src:=get_inventory_check_change_source(c);req:=gen_random_uuid();
 plan:=preview_inventory_check_change(c,'cancel','[]','','Used output already sold',src->>'version',req);
 perform test_assert(not (plan->>'canApply')::boolean and plan->'items'->0->>'blocked'='INSUFFICIENT_CURRENT_STOCK','used gain cannot be cancelled into negative stock');
 begin perform apply_inventory_check_change(c,'cancel','[]','','Used output already sold',src->>'version',req,plan->>'token');raise exception 'expected block';
 exception when others then if sqlerrm<>'INVENTORY_CHECK_CHANGE_BLOCKED' then raise;end if;end;
 perform test_assert((select quantity=2 from branch_stock where branch_id=b and product_id=p),'blocked cancel leaves inventory intact');
 args:=jsonb_build_array(jsonb_build_object('productId',p,'actualStock',10.1234));req:=gen_random_uuid();
 plan:=preview_inventory_check_change(c,'edit',args,'','Correct measured gain',src->>'version',req);
 perform apply_inventory_check_change(c,'edit',args,'','Correct measured gain',src->>'version',req,plan->>'token');
 perform test_assert((select quantity=2.1234 from branch_stock where branch_id=b and product_id=p),'positive adjustment preserves 4 decimal precision');
 perform test_assert((select total_cost=212.34 and costed_quantity=2.1234 from fnb_branch_product_cost_balances where branch_id=b and product_id=p),'positive adjustment posts exact branch WAC');
 perform set_config('test.deny_permission','products.view_cost',false);
 plan:=apply_inventory_check_change(c,'edit',args,'','Correct measured gain',src->>'version',req,plan->>'token');
 perform test_assert(plan->>'costDelta' is null and plan->'items'->0->>'costDelta' is null,'retry respects revoked cost permission');
 perform set_config('test.deny_permission','',false);perform set_config('test.actor',other_a::text,false);
 begin perform get_inventory_check_change_source(c);raise exception 'expected tenant isolation';
 exception when others then if sqlerrm<>'INVENTORY_CHECK_NOT_FOUND' then raise;end if;end;
 perform set_config('test.actor',a::text,false);
 src:=get_inventory_check_change_source(c);
 update inventory_check_items set actual_stock=actual_stock+1 where check_id=c;
 begin perform preview_inventory_check_change(c,'cancel','[]','','Incorrect historic ledger',get_inventory_check_change_source(c)->>'version',gen_random_uuid());raise exception 'expected ledger mismatch';
 exception when others then if sqlerrm<>'INVENTORY_CHECK_LEDGER_MISMATCH' then raise;end if;end;
 perform test_assert((select quantity=2.1234 from branch_stock where branch_id=b and product_id=p),'ambiguous history is not guessed');
end $test$;

-- Explicit rights are separate from create/check rights; costs remain masked.
create or replace function user_has_permission(uuid,text) returns boolean language sql set search_path=public as $$
select $2<>coalesce(current_setting('test.deny_permission',true),'') and exists(select 1 from profiles where id=$1 and role='owner')$$;
do $test$
declare t uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); src jsonb; plan jsonb; args jsonb;
begin
 insert into tenants values(t);insert into branches values(b,t);insert into profiles(id,tenant_id,role) values(a,t,'owner');perform set_config('test.actor',a::text,false);
 insert into products(id,tenant_id,code,name,stock,unit) values(p,t,'PENDING','Pending count',0,'G');
 insert into inventory_checks(id,tenant_id,branch_id,code,status,note) values(c,t,b,'KK-DRAFT','draft','');
 insert into inventory_check_items(check_id,product_id,product_name,system_stock,actual_stock) values(c,p,'Pending count',0,1);
 src:=get_inventory_check_change_source(c);args:=jsonb_build_array(jsonb_build_object('productId',p,'actualStock',2));
 perform set_config('test.deny_permission','inventory.edit_check',false);
 begin perform preview_inventory_check_change(c,'edit',args,'','Correct count',src->>'version',gen_random_uuid());raise exception 'expected edit denial';
 exception when others then if sqlerrm<>'INSUFFICIENT_PERMISSION' then raise;end if;end;
 perform set_config('test.deny_permission','inventory.cancel_check',false);
 begin perform cancel_inventory_check_atomic(c);raise exception 'expected legacy cancel denial';
 exception when others then if sqlerrm<>'INSUFFICIENT_PERMISSION' then raise;end if;end;
 perform set_config('test.deny_permission','products.view_cost',false);
 plan:=preview_inventory_check_change(c,'edit',args,'','Correct count',src->>'version',gen_random_uuid());
 perform test_assert((plan->>'costDelta') is null and (plan->'items'->0->>'costDelta') is null,'costs masked without cost right');
 perform test_assert((plan->'items'->0->>'stockDelta')::numeric=0,'editing draft does not post stock');
 begin perform preview_inventory_check_change(c,'edit',args||args,'','Duplicate count row',src->>'version',gen_random_uuid());raise exception 'expected duplicate denial';
 exception when others then if sqlerrm<>'INVENTORY_CHECK_ITEMS_INVALID' then raise;end if;end;
 perform set_config('test.deny_permission','',false);
 perform set_config('test.actor',gen_random_uuid()::text,false);
 begin perform get_inventory_check_change_source(c);raise exception 'expected active auth';
 exception when others then if sqlerrm<>'ACTIVE_PROFILE_REQUIRED' then raise;end if;end;
end $test$;
