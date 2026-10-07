-- Run after 00442 integration in the same disposable database.
\set ON_ERROR_STOP on
\i /tmp/fnb-inventory-cost-trigger.sql
create table inventory_checks(id uuid primary key,tenant_id uuid,branch_id uuid);
\ir ../migrations/00444_zero_stock_opening_cost_quotes.sql
create trigger capture_quote_test after insert on stock_movements
for each row execute function _capture_fnb_inventory_cost_event_00400();
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000010',false);
insert into products(id,tenant_id,code,name,unit,product_type,channel,inventory_role) values
('00000000-0000-0000-0000-000000000070','00000000-0000-0000-0000-000000000001','ZERO-QUOTE','Quote','G','sku','retail','stockable'),
('00000000-0000-0000-0000-000000000071','00000000-0000-0000-0000-000000000001','NO-QUOTE','No quote','G','sku','retail','stockable');
do $$declare rows jsonb; preview jsonb; begin
 rows:='[{"productCode":"ZERO-QUOTE","branchCode":"QUAN","quantity":0,"costPrice":123.456}]';
 preview:=preview_inventory_opening_00442(rows);
 perform commit_inventory_opening_00442(gen_random_uuid(),rows,preview,'migration',now(),'Confirmed opening quote','zero.xlsx');
 if not exists(select 1 from fnb_branch_product_cost_balances where product_id='00000000-0000-0000-0000-000000000070'
  and costed_quantity=0 and total_cost=0 and unit_cost=123.456 and opening_cost_confirmed) then raise exception 'ZERO_QUOTE_MISSING';end if;
 if exists(select 1 from stock_movements where product_id='00000000-0000-0000-0000-000000000070')
  or exists(select 1 from fnb_branch_product_cost_events where product_id='00000000-0000-0000-0000-000000000070')
  then raise exception 'QUOTE_CREATED_INVENTORY';end if;
 if has_function_privilege('authenticated','public._confirm_zero_opening_cost_00444(uuid,uuid,uuid,numeric,uuid)','execute')
  then raise exception 'PRIVATE_QUOTE_HELPER_EXPOSED';end if;
end$$;
insert into inventory_checks values('00000000-0000-0000-0000-000000000080','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000020');
insert into stock_movements(tenant_id,branch_id,product_id,type,quantity,reference_type,reference_id,created_by)
values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000070','in',1.2345,'inventory_check','00000000-0000-0000-0000-000000000080','00000000-0000-0000-0000-000000000010');
do $$begin
 if not exists(select 1 from fnb_branch_product_cost_balances where product_id='00000000-0000-0000-0000-000000000070'
  and costed_quantity=1.2345 and total_cost=round(1.2345*123.456,4)) then raise exception 'QUOTE_NOT_POSTED_EXACTLY_ONCE';end if;
 begin
  insert into stock_movements(tenant_id,branch_id,product_id,type,quantity,reference_type,reference_id)
  values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000071','in',1,'inventory_check','00000000-0000-0000-0000-000000000080');
  raise exception 'UNCONFIRMED_COST_ACCEPTED';
 exception when others then if sqlerrm not like '%FNB_MANUAL_STOCK_GAIN_COST_REQUIRED%' then raise;end if;end;
 update fnb_branch_product_cost_balances set costed_quantity=0,total_cost=0 where product_id='00000000-0000-0000-0000-000000000070';
 begin
  insert into stock_movements(tenant_id,branch_id,product_id,type,quantity,reference_type,reference_id)
  values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000070','in',1,'inventory_check','00000000-0000-0000-0000-000000000080');
  raise exception 'OLD_QUOTE_REUSED';
 exception when others then if sqlerrm not like '%FNB_MANUAL_STOCK_GAIN_COST_REQUIRED%' then raise;end if;end;
end$$;
select '00444 zero opening quotes: no stock created, private helper, first stocktake valued, absent/stale cost blocked' as result;
