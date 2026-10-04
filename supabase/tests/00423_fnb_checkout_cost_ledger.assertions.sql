\set ON_ERROR_STOP on
select test_assert((select count(*)=2 from test_payment_results) and (select count(*)=1 and min(total)=90000 and min(paid)=90000 from invoices) and (select count(*)=1 and sum(amount)=90000 from cash_transactions),'concurrent costed checkout posts money once');
select test_assert((select count(*)=2 and bool_and(unit_cost=6400) and sum(quantity*unit_cost)=19200 from invoice_items),'each same-product line snapshots its own event delta');
select test_assert((select count(*)=4 and sum(total_cost)=19200 and sum(quantity)=0.36 from fnb_branch_product_cost_events where direction='out'),'BOM ledger cost and quantity once');
select test_assert((select count(*)=4 from fnb_invoice_item_bom_snapshot_components_00410),'both lines have exact ingredient snapshots');
select test_assert((select costed_quantity=14.94 and total_cost=1792800 and unit_cost=120000 from fnb_branch_product_cost_balances where product_id='00000000-0000-0000-0000-000000000011'),'raw 1 remaining ledger');
select test_assert((select costed_quantity=19.7 and total_cost=788000 and unit_cost=40000 from fnb_branch_product_cost_balances where product_id='00000000-0000-0000-0000-000000000012'),'raw 2 remaining ledger');
select test_assert(not exists(select 1 from branch_stock bs join fnb_branch_product_cost_balances cb using(tenant_id,branch_id,product_id) where bs.quantity<>cb.costed_quantity),'physical and costed branch quantities agree');
select test_assert((select count(*)=2 and bool_and(quantity=500) from branch_stock where branch_id='00000000-0000-0000-0000-000000000009') and not exists(select 1 from fnb_branch_product_cost_events where branch_id='00000000-0000-0000-0000-000000000009'),'Retail sentinel stock and cost ledger untouched');
select test_assert((select count(*)=4 and sum(quantity)=0.36 from lot_allocations),'actual lot allocation agrees with BOM issue');
-- Refresh the purchase price after the first invoice. Historic sale cost is fixed.
select test_receipt('00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000011',5,180000);
select test_assert((select unit_cost=round(2692800::numeric/19.94,6) from fnb_branch_product_cost_balances where product_id='00000000-0000-0000-0000-000000000011'),'later receipt updates current WAC');
select test_assert((select bool_and(unit_cost=6400) from invoice_items),'new receipt never reprices old invoice');
select set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
create temp table replay_baseline as select count(*) as events,sum(total_cost) as cost from fnb_branch_product_cost_events;
select test_assert((test_pay()->>'idempotent')='true','costed checkout replay returns persisted invoice');
select test_assert((select count(*)=b.events and sum(total_cost)=b.cost from fnb_branch_product_cost_events cross join replay_baseline b group by b.events,b.cost),'replay leaves cost events unchanged');
insert into kitchen_orders(id,tenant_id,branch_id,status,order_number) values ('00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','pending','UAT-NEW-COST');
insert into kitchen_order_items(kitchen_order_id,product_id,product_name,quantity,unit_price) values ('00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000010','UAT new cost',1,30000);
select test_pay('00000000-0000-0000-0000-000000000006');
select test_assert((select ii.unit_cost=6700.9027 from invoice_items ii join invoices i on i.id=ii.invoice_id join kitchen_orders ko on ko.invoice_id=i.id where ko.id='00000000-0000-0000-0000-000000000006'),'next sale uses refreshed WAC');
select test_assert((select bool_and(ii.unit_cost=6400) from invoice_items ii join kitchen_orders ko on ko.invoice_id=ii.invoice_id where ko.id='00000000-0000-0000-0000-000000000005'),'old sale still keeps recorded cost');
-- Physical stock is sufficient but raw 2 ledger is absent. Do not fall back to
-- Retail cost or zero; rollback the earlier raw 1 stock and cost issue too.
delete from fnb_branch_product_cost_balances where product_id='00000000-0000-0000-0000-000000000012';
create temp table failure_baseline as select
 (select jsonb_agg(to_jsonb(b) order by branch_id,product_id) from branch_stock b) as physical,
 (select jsonb_agg(to_jsonb(b) order by product_id) from fnb_branch_product_cost_balances b) as balances,
 (select jsonb_agg(to_jsonb(e) order by id) from fnb_branch_product_cost_events e) as events,
 (select jsonb_agg(to_jsonb(l) order by id) from product_lots l) as lots;
insert into kitchen_orders(id,tenant_id,branch_id,status,order_number) values ('00000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','pending','UAT-MISSING-COST');
insert into kitchen_order_items(kitchen_order_id,product_id,product_name,quantity,unit_price) values ('00000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000010','UAT missing cost',1,30000);
do $$ declare v_message text; begin
 begin perform test_pay('00000000-0000-0000-0000-000000000008'); exception when others then get stacked diagnostics v_message=message_text; end;
 if v_message is distinct from 'FNB_BRANCH_COST_REQUIRED' then raise exception 'Expected missing cost guard, got %',v_message; end if;
end $$;
select test_assert((select count(*)=2 from invoices) and (select count(*)=2 from cash_transactions) and (select count(*)=3 from invoice_items),'missing cost rolls back invoice and cash, no zero-cost sale');
select test_assert((select
 physical=(select jsonb_agg(to_jsonb(b) order by branch_id,product_id) from branch_stock b) and
 balances=(select jsonb_agg(to_jsonb(b) order by product_id) from fnb_branch_product_cost_balances b) and
 events=(select jsonb_agg(to_jsonb(e) order by id) from fnb_branch_product_cost_events e) and
 lots=(select jsonb_agg(to_jsonb(l) order by id) from product_lots l) from failure_baseline),'missing cost rolls back physical, ledger and lots');
select test_assert((select invoice_id is null from kitchen_orders where id='00000000-0000-0000-0000-000000000008'),'missing cost does not link a partial invoice');
\echo 'PASS: actual checkout -> BOM -> branch WAC ledger trigger -> per-line cost snapshots; concurrent replay, historical immutability and missing-cost rollback. Minimal schema/auth adapters, not complete production/RLS/UI acceptance.'
