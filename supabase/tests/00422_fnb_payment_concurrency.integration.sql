\set ON_ERROR_STOP on
create function public.test_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end $$;
select test_assert((select count(*)=2 from test_payment_results),'two clients returned');
select test_assert((select a.result->>'invoice_id' = b.result->>'invoice_id' and b.result->>'idempotent'='true' from test_payment_results a cross join test_payment_results b where a.client='A' and b.client='B'),'same persisted invoice, second is replay');
select test_assert((select (result->>'change_amount')::numeric=20000 and (result->>'paid')::numeric=30000 from test_payment_results where client='A'),'cash change is not revenue');
select test_assert((select count(*)=1 and min(total)=30000 and min(paid)=30000 and min(debt)=0 from invoices),'one settled invoice');
select test_assert((select count(*)=1 and sum(amount)=30000 from cash_transactions),'one receipt, settled cash only');
select test_assert((select count(*)=1 and min(quantity)=1 and min(total)=30000 and bool_and(unit_cost is null) from invoice_items),'one sale line; no cost event stays unknown, not zero');
select test_assert((select count(*)=1 from audit_log),'one checkout audit');
select test_assert((select count(*)=2 and sum(quantity)=0.12 and bool_and(reference_type='bom_consume') from stock_movements),'two ingredient movements once');
select test_assert((select count(*)=2 and sum(quantity)=0.12 from fnb_invoice_item_bom_snapshot_components_00410),'exact consumed quantities snapshotted once');
select test_assert((select quantity=9.98 from branch_stock where branch_id='00000000-0000-0000-0000-000000000003' and product_id='00000000-0000-0000-0000-000000000011'),'raw 1 branch quantity');
select test_assert((select quantity=9.9 from branch_stock where branch_id='00000000-0000-0000-0000-000000000003' and product_id='00000000-0000-0000-0000-000000000012'),'raw 2 branch quantity');
select test_assert((select stock=509.98 from products where code='UAT-RAW1') and (select stock=509.9 from products where code='UAT-RAW2'),'global ingredient totals match branch deductions');
select test_assert((select bool_and(quantity=500) and count(*)=2 from branch_stock where branch_id='00000000-0000-0000-0000-000000000009'),'Retail sentinel branch unchanged');
select test_assert((select stock=0 from products where code='UAT-MENU') and not exists(select 1 from stock_movements where product_id='00000000-0000-0000-0000-000000000010'),'no virtual menu stock deduction');
select test_assert((select count(*)=2 and sum(quantity)=0.12 from lot_allocations) and (select sum(current_qty)=19.88 from product_lots),'lots allocated once');
select test_assert((select status='pending' and invoice_id is not null from kitchen_orders where id='00000000-0000-0000-0000-000000000005'),'paying does not finish kitchen workflow');

-- All writes performed before the ingredient check must roll back on failure.
insert into kitchen_orders(id,tenant_id,branch_id,status,order_number) select '00000000-0000-0000-0000-000000000006',tenant_id,branch_id,'pending','UAT-INSUFFICIENT' from kitchen_orders limit 1;
insert into kitchen_order_items(kitchen_order_id,product_id,product_name,quantity,unit_price) values ('00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000010','UAT insufficient',100,300);
select set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
do $$ declare v_message text; begin
  begin perform test_pay('00000000-0000-0000-0000-000000000006');
  exception when others then get stacked diagnostics v_message=message_text; end;
  if v_message is null or v_message not like 'NVL_INSUFFICIENT:%' then raise exception 'Expected ingredient shortage, got %',v_message; end if;
end $$;
select test_assert((select count(*)=1 from invoices) and (select count(*)=1 from invoice_items) and (select count(*)=1 from cash_transactions) and (select count(*)=1 from audit_log),'shortage rolls back money/lines/audit');
select test_assert((select count(*)=2 from stock_movements) and (select count(*)=2 from lot_allocations) and (select count(*)=2 from fnb_invoice_item_bom_snapshot_components_00410),'shortage rolls back stock/lot/snapshot writes');
select test_assert((select invoice_id is null from kitchen_orders where id='00000000-0000-0000-0000-000000000006'),'failed checkout never links invoice');
select test_assert((select stock=509.98 from products where code='UAT-RAW1') and (select quantity=9.98 from branch_stock where branch_id='00000000-0000-0000-0000-000000000003' and product_id='00000000-0000-0000-0000-000000000011') and (select sum(current_qty)=19.88 from product_lots),'shortage on second ingredient restores first ingredient and lots');
\echo 'PASS: first-payment money and BOM posting, concurrent replay, Retail sentinel and shortage rollback. Auth/RLS and cost-ledger triggers are outside this fixture.'
