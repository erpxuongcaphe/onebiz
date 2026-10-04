-- Disposable only: actual payment/BOM/cost snapshot -> actual restore helper
-- and return-cost trigger. Return document/auth/refund RPC and lot restocking
-- are NOT exercised: test_restore is a bounded document fixture adapter.
\set ON_ERROR_STOP on
do $$ begin
  if current_database() <> 'fnb_payment_return_cost_test' or to_regclass('public.products') is not null then
    raise exception 'Requires a fresh dedicated payment-return test database';
  end if;
end $$;
\ir 00423_fnb_checkout_cost_ledger.integration.sql
\ir ../migrations/00397_fnb_return_bom_cost_restore.sql
select set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
select test_pay();
select test_assert((select count(*)=1 and min(total)=90000 and min(paid)=90000 from invoices),'paid invoice posts once');
select test_assert((select count(*)=2 and bool_and(unit_cost=6400) from invoice_items),'actual payment records both line costs');
select test_assert((select count(*)=4 and sum(total_cost)=19200 from fnb_branch_product_cost_events where direction='out'),'actual BOM records original branch costs');

-- Change live inputs after checkout: returns must use historic consumption/cost.
update bom_items set quantity=quantity*10;
select test_receipt('00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000011',5,180000);
select test_receipt('00000000-0000-0000-0000-000000000023','00000000-0000-0000-0000-000000000012',5,100000);
select test_assert((select bool_and(unit_cost=6400) from invoice_items),'later prices and BOM do not reprice old lines');

create function test_restore(p_line uuid,p_qty numeric,p_return uuid) returns jsonb language plpgsql as $$
declare v_line invoice_items%rowtype; v_invoice invoices%rowtype; v_result jsonb;
begin
  select * into strict v_line from invoice_items where id=p_line;
  select * into strict v_invoice from invoices where id=v_line.invoice_id;
  insert into sales_returns(id,invoice_id,tenant_id,branch_id,status)
  values (p_return,v_invoice.id,v_invoice.tenant_id,v_invoice.branch_id,'completed');
  insert into return_items(return_id,invoice_item_id,product_id,quantity)
  values (p_return,p_line,v_line.product_id,p_qty);
  v_result:=_restore_fnb_invoice_item_bom_00410(p_line,v_invoice.tenant_id,v_invoice.branch_id,v_line.product_id,p_qty,p_return,null,'UAT-RETURN',null);
  update invoice_items set returned_qty=returned_qty+p_qty where id=p_line;
  return v_result;
end $$;

create function test_snapshot() returns jsonb language sql as $$
select jsonb_build_object(
 'products',(select jsonb_agg(to_jsonb(p) order by id) from products p),
 'stock',(select jsonb_agg(to_jsonb(s) order by branch_id,product_id) from branch_stock s),
 'balances',(select jsonb_agg(to_jsonb(b) order by branch_id,product_id) from fnb_branch_product_cost_balances b),
 'events',(select jsonb_agg(to_jsonb(e) order by id) from fnb_branch_product_cost_events e),
 'movements',(select jsonb_agg(to_jsonb(m) order by id) from stock_movements m),
 'invoice_items',(select jsonb_agg(to_jsonb(i) order by id) from invoice_items i),
 'returns',(select jsonb_agg(to_jsonb(r) order by id) from sales_returns r),
 'return_items',(select jsonb_agg(to_jsonb(r) order by id) from return_items r),
 'invoices',(select jsonb_agg(to_jsonb(i) order by id) from invoices i),
 'cash',(select jsonb_agg(to_jsonb(c) order by id) from cash_transactions c)
);
$$;

-- Force failure after both the first component and the second cost event.
create function test_late_return_failure() returns trigger language plpgsql as $$
begin
  if new.reference_type='return_bom_restore' and new.product_id='00000000-0000-0000-0000-000000000012' then
    raise exception 'UAT_LATE_RETURN_FAILURE';
  end if;
  return new;
end $$;
create trigger zzzz_test_late_return_failure after insert on stock_movements for each row execute function test_late_return_failure();
do $$ declare before_state jsonb:=test_snapshot(); message text; begin
  begin
    perform test_restore((select id from invoice_items where quantity=2),1,'00000000-0000-0000-0000-000000000030');
  exception when others then get stacked diagnostics message=message_text;
  end;
  perform test_assert(message='UAT_LATE_RETURN_FAILURE','late failure reached second ingredient');
  perform test_assert(test_snapshot()=before_state,'late return failure rolls back documents, quantities, ledger and money snapshots');
end $$;
drop trigger zzzz_test_late_return_failure on stock_movements;

select test_assert((test_restore((select id from invoice_items where quantity=2),1,'00000000-0000-0000-0000-000000000031')->>'snapshot_mode')='invoice_item','partial return uses the paid invoice line snapshot');
select test_assert((select sum(quantity)=0.12 from stock_movements where reference_type='return_bom_restore'),'partial return restores historic quantity, not updated BOM');
select test_assert((select sum(total_cost)=6400 from fnb_branch_product_cost_events where source_type='return_bom_restore'),'partial return uses historic 120000/40000 costs, not current WAC');
select test_assert((select returned_qty=0 from invoice_items where quantity=1),'partial return does not consume another same-SKU line');
select test_restore((select id from invoice_items where quantity=1),1,'00000000-0000-0000-0000-000000000032');
select test_restore((select id from invoice_items where quantity=2),1,'00000000-0000-0000-0000-000000000033');
select test_assert((select bool_and(returned_qty=quantity) from invoice_items),'both invoice lines returned exactly');
select test_assert((select count(*)=6 and sum(quantity)=0.36 and sum(total_cost)=19200 from fnb_branch_product_cost_events where source_type='return_bom_restore'),'partial sequence restores exactly original issue cost and quantity');
select test_assert((select costed_quantity=20 and total_cost=2700000 from fnb_branch_product_cost_balances where product_id='00000000-0000-0000-0000-000000000011'),'raw 1 returns original value into refreshed balance');
select test_assert((select costed_quantity=25 and total_cost=1300000 from fnb_branch_product_cost_balances where product_id='00000000-0000-0000-0000-000000000012'),'raw 2 returns original value into refreshed balance');
select test_assert(not exists(select 1 from branch_stock bs join fnb_branch_product_cost_balances cb using(tenant_id,branch_id,product_id) where bs.quantity<>cb.costed_quantity),'physical and cost quantities agree after returns');

do $$ declare before_state jsonb:=test_snapshot(); message text; begin
  begin
    perform test_restore((select id from invoice_items where quantity=2),1,'00000000-0000-0000-0000-000000000034');
  exception when others then get stacked diagnostics message=message_text;
  end;
  perform test_assert(message='FNB_RETURN_BOM_QUANTITY_EXCEEDED','over-return fails closed');
  perform test_assert(test_snapshot()=before_state,'over-return changes no persisted document, stock or cost');
end $$;
select test_assert((select count(*)=2 and bool_and(quantity=500) from branch_stock where branch_id='00000000-0000-0000-0000-000000000009') and not exists(select 1 from fnb_branch_product_cost_events where branch_id='00000000-0000-0000-0000-000000000009'),'Retail sentinel untouched by checkout and returns');
select test_assert((select count(*)=1 and sum(amount)=90000 from cash_transactions),'restore helper does not pretend to refund cash');
\echo 'PASS: actual payment snapshots -> historic partial BOM restore -> actual cost ledger; refreshed inputs, same-SKU lines, late rollback and over-return guards. Fixture return documents; not full refund RPC/RLS/UI/lot acceptance.'
