-- Focused real payment -> BOM -> branch ledger trigger -> line cost snapshots.
-- Receipt movements are fixtures, not a full purchase receipt/RLS/UI test.
\set ON_ERROR_STOP on
\ir 00422_fnb_payment_concurrency.setup.sql
alter table fnb_branch_product_cost_balances add updated_at timestamptz default now();
alter table products add is_fnb_stock_item boolean default false;
create table purchase_order_items(purchase_order_id uuid,product_id uuid,unit_price numeric);
create table production_orders(id uuid,tenant_id uuid,branch_id uuid,product_id uuid,cogs_amount numeric);
\i /tmp/fnb-checkout-cost-ledger.sql
\i /tmp/fnb-original-cost-trigger.sql
create trigger capture_fnb_branch_cost_stock_movement_00390 after insert on stock_movements
for each row execute function _capture_fnb_branch_cost_stock_movement_00390();
\ir ../migrations/00398_fnb_production_cancel_cost_restore.sql
insert into fnb_supply_branch_scopes values ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003',true);
select _post_fnb_branch_cost_in_00390(tenant_id,branch_id,product_id,quantity,
  case when product_id='00000000-0000-0000-0000-000000000011' then 100000 else 30000 end,
  'opening','opening_cost',product_id,null,'UAT opening',null)
from branch_stock where branch_id='00000000-0000-0000-0000-000000000003';
create function test_receipt(p_reference uuid,p_product uuid,p_qty numeric,p_price numeric) returns void language plpgsql as $$
begin
  insert into purchase_order_items values (p_reference,p_product,p_price);
  perform upsert_branch_stock('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003',p_product,p_qty);
  perform increment_product_stock(p_product,p_qty);
  insert into stock_movements(tenant_id,branch_id,product_id,type,quantity,reference_type,reference_id,note)
  values ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003',p_product,'in',p_qty,'purchase_order',p_reference,'UAT receipt movement');
end $$;
select test_receipt('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000011',5,160000);
select test_receipt('00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000012',10,50000);
insert into kitchen_order_items(kitchen_order_id,product_id,product_name,variant_label,quantity,unit_price)
select kitchen_order_id,product_id,product_name,'L',2,unit_price from kitchen_order_items limit 1;
create or replace function public.test_pay(p_order uuid default '00000000-0000-0000-0000-000000000005') returns jsonb language sql as $$
select public.fnb_complete_payment_atomic_v3($1,null,'UAT','cash',null,100000,false,0,null,null,null,'00000000-0000-0000-0000-000000000007')
$$;
create function test_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end $$;
select test_assert((select unit_cost=120000 and costed_quantity=15 and total_cost=1800000 from fnb_branch_product_cost_balances where product_id='00000000-0000-0000-0000-000000000011'),'receipt price updates raw 1 WAC');
select test_assert((select unit_cost=40000 and costed_quantity=20 and total_cost=800000 from fnb_branch_product_cost_balances where product_id='00000000-0000-0000-0000-000000000012'),'receipt price updates raw 2 WAC');
-- CI runs the two-client harness between setup and assertions.
