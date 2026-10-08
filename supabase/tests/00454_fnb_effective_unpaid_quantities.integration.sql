-- Disposable PostgreSQL: actual checkout/BOM/source/split functions. Auth adapters
-- are permissive in this quantity contract; permission tests remain in 00452.
\set ON_ERROR_STOP on
\ir 00422_fnb_payment_concurrency.setup.sql
alter table kitchen_order_items add id uuid primary key default gen_random_uuid(),
  add cancelled_qty integer not null default 0, add note text, add status text default 'pending';
alter table kitchen_orders alter id set default gen_random_uuid();
alter table kitchen_orders add order_type text default 'dine_in', add parent_order_id uuid,
  add note text, add created_by uuid, add discount_reason text;
\ir ../migrations/00423_fnb_invoice_kitchen_line_source.sql
\ir ../migrations/00273_atomic_fnb_split_bill.sql
\i /tmp/fnb-effective-quantity-chain.sql
\ir ../migrations/00454_fnb_effective_unpaid_item_quantities.sql
-- Idempotent definition installation must not subtract cancellation twice.
\ir ../migrations/00454_fnb_effective_unpaid_item_quantities.sql

select set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
update kitchen_order_items set quantity=3, cancelled_qty=1,
  id='00000000-0000-0000-0000-000000000021';
insert into kitchen_order_items(id,kitchen_order_id,product_id,product_name,quantity,unit_price,cancelled_qty)
values('00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000005',
  '00000000-0000-0000-0000-000000000010','Fully cancelled',1,30000,1);

do $$ declare v_result jsonb; v_invoice uuid; begin
  if public._fnb_kitchen_remaining_00424('00000000-0000-0000-0000-000000000021')<>2 then
    raise exception 'KDS remaining mismatch before checkout'; end if;
  v_result:=public.fnb_complete_payment_atomic_v3(
    '00000000-0000-0000-0000-000000000005',null,'UAT','cash',null,100000,false,0,
    null,null,null,'00000000-0000-0000-0000-000000000007');
  select invoice_id into v_invoice from kitchen_orders where id='00000000-0000-0000-0000-000000000005';
  if v_invoice is null or (select total from invoices where id=v_invoice)<>60000 then
    raise exception 'Checkout charged cancelled quantity: %',v_result; end if;
  if (select count(*) from invoice_items where invoice_id=v_invoice)<>1
    or (select quantity from invoice_items where invoice_id=v_invoice)<>2 then
    raise exception 'Invoice quantity does not match active items'; end if;
  if (select quantity from kitchen_order_items where id='00000000-0000-0000-0000-000000000021')<>3
    or (select cancelled_qty from kitchen_order_items where id='00000000-0000-0000-0000-000000000021')<>1
    or (select count(*) from kitchen_order_items)<>2 then
    raise exception 'Original kitchen history was rewritten'; end if;
  if (select quantity from branch_stock where branch_id='00000000-0000-0000-0000-000000000003'
        and product_id='00000000-0000-0000-0000-000000000011')<>9.96
    or (select quantity from branch_stock where branch_id='00000000-0000-0000-0000-000000000003'
        and product_id='00000000-0000-0000-0000-000000000012')<>9.8 then
    raise exception 'BOM consumed cancelled quantity'; end if;
  if not exists(select 1 from fnb_invoice_kitchen_line_sources s join invoice_items ii on ii.id=s.invoice_item_id
    where ii.invoice_id=v_invoice and s.kitchen_order_item_id='00000000-0000-0000-0000-000000000021') then
    raise exception 'Exact refund source missing'; end if;
  if (select sum(c.quantity) from fnb_invoice_item_bom_snapshot_components_00410 c
      join invoice_items ii on ii.id=c.invoice_item_id where ii.invoice_id=v_invoice
      and c.material_id='00000000-0000-0000-0000-000000000011') is distinct from 0.04
    or (select sum(c.quantity) from fnb_invoice_item_bom_snapshot_components_00410 c
      join invoice_items ii on ii.id=c.invoice_item_id where ii.invoice_id=v_invoice
      and c.material_id='00000000-0000-0000-0000-000000000012') is distinct from 0.2 then
    raise exception 'Return recipe snapshot includes cancelled quantity'; end if;
  if exists(select 1 from branch_stock where branch_id='00000000-0000-0000-0000-000000000009' and quantity<>500) then
    raise exception 'Checkout touched other branch stock'; end if;
  update invoice_items set returned_qty=1 where invoice_id=v_invoice;
  if public._fnb_kitchen_remaining_00424('00000000-0000-0000-0000-000000000021')<>1 then
    raise exception 'KDS double-subtracted cancellation or ignored paid return'; end if;
  if has_table_privilege('authenticated','public._fnb_active_kitchen_items_00454','SELECT')
     or has_table_privilege('anon','public._fnb_active_kitchen_items_00454','SELECT') then
    raise exception 'Private projection exposed'; end if;
end $$;

-- Split follows remaining values, keeps cancelled rows, and apportions discount.
insert into kitchen_orders(id,tenant_id,branch_id,status,order_number,discount_amount)
values('00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000002',
 '00000000-0000-0000-0000-000000000003','pending','UAT-SPLIT',10000);
insert into kitchen_order_items(id,kitchen_order_id,product_id,product_name,quantity,unit_price,cancelled_qty)
select ('00000000-0000-0000-0000-0000000000'||v.id)::uuid,
 '00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000010',
 'UAT split',v.qty,30000,v.cancelled from (values('31',3,1),('32',1,0),('33',1,1)) v(id,qty,cancelled);
update kitchen_order_items set toppings='[{"quantity":1,"price":5000}]'::jsonb
  where id='00000000-0000-0000-0000-000000000031';
do $$ declare v_result jsonb; v_child uuid; begin
  v_result:=public.split_kitchen_order_atomic('00000000-0000-0000-0000-000000000030','items',
    array['00000000-0000-0000-0000-000000000031'::uuid],null);
  select kitchen_order_id into v_child from kitchen_order_items where id='00000000-0000-0000-0000-000000000031';
  if v_child='00000000-0000-0000-0000-000000000030'
    or (select discount_amount from kitchen_orders where id=v_child)<>7000
    or (select discount_amount from kitchen_orders where id='00000000-0000-0000-0000-000000000030')<>3000 then
    raise exception 'Split discount did not follow remaining quantity: %',v_result; end if;
  if (select kitchen_order_id from kitchen_order_items where id='00000000-0000-0000-0000-000000000033')
      <>'00000000-0000-0000-0000-000000000030'
    or (select quantity from kitchen_order_items where id='00000000-0000-0000-0000-000000000031')<>3 then
    raise exception 'Split lost cancelled history'; end if;
end $$;
select '00454 quantity, checkout, BOM, source, paid-return and split contracts passed' as result;
