-- Disposable contract schema with real payment/return/lot/cost functions.
-- Auth/permission and code generators are fixture adapters, not Supabase RLS.
\set ON_ERROR_STOP on
do $$ begin
  if current_database() <> 'fnb_full_refund_test' or to_regclass('public.products') is not null then
    raise exception 'Requires a fresh dedicated full refund test database';
  end if;
end $$;
\ir 00423_fnb_checkout_cost_ledger.integration.sql
alter table sales_returns alter id set default gen_random_uuid();
alter table sales_returns add code text, add customer_id uuid, add customer_name text, add total numeric,
  add refunded numeric, add reason text, add note text, add created_by uuid;
alter table return_items add product_name text, add unit text, add unit_price numeric, add total numeric;
alter table invoice_items add variant_id uuid;
alter table product_lots add variant_id uuid, add source_type text, add initial_qty numeric, add note text;
alter table kitchen_orders add cancel_reason_code text, add cancel_reason text, add cancelled_at timestamptz, add cancelled_by uuid;
alter table audit_log add old_data jsonb;
create table customer_debt_adjustments(tenant_id uuid,customer_id uuid,invoice_id uuid,amount numeric,reason text,idempotency_key text,created_by uuid);
create function next_cash_code(uuid,text) returns text language sql as $$ select public.next_code($1,$2) $$;
\i /tmp/fnb-sales-return-chain.sql
\ir ../migrations/00405_return_item_source_identity.sql
\ir ../migrations/00410_fnb_invoice_item_bom_return_snapshot.sql
select set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
-- Receipt adapter does not post lots; align the fixture opening quantities using
-- the actual lot function before payment, so later returns can be compared.
select _reconcile_product_lots_to_branch_00284(tenant_id,branch_id,product_id,'purchase_order',gen_random_uuid(),auth.uid(),'fixture opening')
from branch_stock where branch_id='00000000-0000-0000-0000-000000000003';
select test_pay();
-- Keep KDS active to exercise full-return closure; do not reopen a real order.
update kitchen_orders set status='preparing';
update bom_items set quantity=quantity*10;

create function test_full_snapshot() returns jsonb language sql as $$
select jsonb_build_object(
 'stock',(select jsonb_agg(to_jsonb(s) order by branch_id,product_id) from branch_stock s),
 'products',(select jsonb_agg(to_jsonb(p) order by id) from products p),
 'cost',(select jsonb_agg(to_jsonb(c) order by branch_id,product_id) from fnb_branch_product_cost_balances c),
 'events',(select jsonb_agg(to_jsonb(e) order by id) from fnb_branch_product_cost_events e),
 'moves',(select jsonb_agg(to_jsonb(m) order by id) from stock_movements m),
 'lots',(select jsonb_agg(to_jsonb(l) order by id) from product_lots l),
 'allocations',(select jsonb_agg(to_jsonb(a) order by lot_id,source_id) from lot_allocations a),
 'invoices',(select jsonb_agg(to_jsonb(i) order by id) from invoices i),
 'lines',(select jsonb_agg(to_jsonb(i) order by id) from invoice_items i),
 'returns',(select jsonb_agg(to_jsonb(r) order by id) from sales_returns r),
 'return_lines',(select jsonb_agg(to_jsonb(r) order by id) from return_items r),
 'cash',(select jsonb_agg(to_jsonb(c) order by id) from cash_transactions c),
 'kds',(select jsonb_agg(to_jsonb(k) order by id) from kitchen_orders k),
 'audit',(select jsonb_agg(to_jsonb(a) order by entity_id,action,new_data::text) from audit_log a)
);
$$;
create function test_refund(p_quantity numeric,p_refund numeric) returns jsonb language sql as $$
select create_sales_return_atomic((select id from invoices),
 jsonb_build_array(jsonb_build_object('invoiceItemId',(select id from invoice_items where quantity=2),'quantity',p_quantity)),
 p_refund,'cash','UAT only',null,'00000000-0000-0000-0000-000000000007');
$$;
\ir ../migrations/00421_fnb_sales_return_checkout_permission.sql
\ir ../migrations/00421_fnb_sales_return_checkout_permission.sql
-- Configurable adapter exercises return guards, not Supabase RLS.
create or replace function public.user_has_permission(uuid,text) returns boolean language sql as $$
 select coalesce(nullif(current_setting('test.permission.' || $2,true),'')::boolean,true)
$$;
do $$ declare before_state jsonb:=test_full_snapshot(); message text; begin
 perform set_config('test.permission.pos_fnb.checkout','false',false);
 begin perform test_refund(1,30000); exception when others then get stacked diagnostics message=message_text; end;
 perform test_assert(message='FNB_RETURN_CHECKOUT_DENIED','view or Retail checkout does not authorize F&B refund');
 perform test_assert(test_full_snapshot()=before_state,'denied refund changes no business rows');
 update invoices set source='pos'; message:=null;
 begin perform test_refund(0,0); exception when others then get stacked diagnostics message=message_text; end;
 perform test_assert(message='INVALID_RETURN_ITEM','Retail permission remains accepted');
 perform set_config('test.permission.pos_retail.checkout','false',false);
 perform set_config('test.permission.pos_fnb.view_orders','false',false); message:=null;
 begin perform test_refund(0,0); exception when others then get stacked diagnostics message=message_text; end;
 perform test_assert(message='INSUFFICIENT_PERMISSION','Retail retains original denial rule');
 update invoices set source='fnb';
 perform set_config('test.permission.pos_fnb.checkout','true',false); message:=null;
 begin perform test_refund(0,0); exception when others then get stacked diagnostics message=message_text; end;
 perform test_assert(message='INVALID_RETURN_ITEM','F&B checkout alone is sufficient');
 perform test_assert(test_full_snapshot()=before_state,'permission probes leave snapshot unchanged');
 perform set_config('test.permission.pos_retail.checkout','true',false);
 perform set_config('test.permission.pos_fnb.view_orders','true',false);
end $$;
do $$ declare before_state jsonb:=test_full_snapshot(); message text; begin
 begin perform test_refund(1,40000); exception when others then get stacked diagnostics message=message_text; end;
 perform test_assert(message='REFUND_EXCEEDS_RETURN_TOTAL','cannot refund beyond returned line value');
 perform test_assert(test_full_snapshot()=before_state,'excess refund has no side effects');
 message:=null;
 begin perform test_refund(0,0); exception when others then get stacked diagnostics message=message_text; end;
 perform test_assert(message='INVALID_RETURN_ITEM','zero returned quantity rejected');
 perform test_assert(test_full_snapshot()=before_state,'invalid quantity has no side effects');
 perform set_config('test.actor','',false); message:=null;
 begin perform test_refund(1,30000); exception when others then get stacked diagnostics message=message_text; end;
 perform set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
 perform test_assert(message='UNAUTHENTICATED','return implementation checks actor');
 perform test_assert(test_full_snapshot()=before_state,'unauthenticated return has no side effects');
end $$;
-- Fail lot reconciliation after the authoritative return has already written
-- cash and restored BOM: the outer RPC must roll everything back together.
create function test_late_lot_failure() returns trigger language plpgsql as $$
begin raise exception 'UAT_LATE_LOT_FAILURE'; end $$;
create trigger test_late_lot_failure after insert on product_lots for each row execute function test_late_lot_failure();
do $$ declare before_state jsonb:=test_full_snapshot(); message text; begin
 begin perform test_refund(1,30000); exception when others then get stacked diagnostics message=message_text; end;
 perform test_assert(message='UAT_LATE_LOT_FAILURE','return reaches lot stage after cash and BOM; actual=' || coalesce(message,'no exception'));
 perform test_assert(test_full_snapshot()=before_state,'late failure rolls back refund, BOM, cost, documents, lots and KDS');
end $$;
drop trigger test_late_lot_failure on product_lots;
select test_assert((test_refund(1,30000)->>'refunded')::numeric=30000,'actual partial refund posts requested cash');
select test_assert((select sum(amount)=30000 and count(*)=1 from cash_transactions where type='payment'),'one partial refund payment');
select test_assert((select status='preparing' from kitchen_orders),'partial return keeps KDS active');
select test_assert((select sum(total_cost)=6400 from fnb_branch_product_cost_events where source_type='return_bom_restore'),'historic cost despite BOM change');
select test_assert((select returned_qty=1 from invoice_items where quantity=2),'exact sold line partially returned');
select test_assert((select bool_and(invoice_item_id is not null) from return_items),'actual return stores sold line identity');
select test_refund(1,30000);
select test_assert((select status='preparing' from kitchen_orders),'other sold line still open after first line fully returned');
select create_sales_return_atomic((select id from invoices),jsonb_build_array(jsonb_build_object('invoiceItemId',(select id from invoice_items where quantity=1),'quantity',1)),30000,'cash','UAT final',null,'00000000-0000-0000-0000-000000000007');
select test_assert((select sum(amount)=90000 and count(*)=3 from cash_transactions where type='payment'),'full cash refund exactly original paid');
select test_assert((select count(*)=3 and sum(total)=90000 and sum(refunded)=90000 from sales_returns),'actual return documents reconcile');
select test_assert((select status='cancelled' and cancel_reason_code='full_sales_return' from kitchen_orders),'full return closes linked KDS');
select test_assert((select count(*)=6 and sum(total_cost)=19200 and sum(quantity)=0.36 from fnb_branch_product_cost_events where source_type='return_bom_restore'),'restore original quantities and cost once');
select test_assert(not exists(select 1 from branch_stock bs where branch_id='00000000-0000-0000-0000-000000000003' and quantity<>(select sum(current_qty) from product_lots pl where pl.product_id=bs.product_id and pl.branch_id=bs.branch_id and pl.status in ('active','expired'))),'lot balances match physical branch stock');
do $$ declare before_state jsonb:=test_full_snapshot(); message text; begin
 begin perform test_refund(1,30000); exception when others then get stacked diagnostics message=message_text; end;
 perform test_assert(message='RETURN_QUANTITY_EXCEEDED','over-return rejected by full RPC');
 perform test_assert(test_full_snapshot()=before_state,'over-return does not duplicate refund or stock');
end $$;
select test_assert((select count(*)=2 and bool_and(quantity=500) from branch_stock where branch_id='00000000-0000-0000-0000-000000000009'),'Retail stock sentinel unchanged');
\echo 'PASS: actual payment -> full return RPC -> refund cash, source lines, historical BOM/cost, lot balance, KDS closure and late rollback. Auth/code/schema fixtures, not Supabase RLS/UI/device acceptance.'
