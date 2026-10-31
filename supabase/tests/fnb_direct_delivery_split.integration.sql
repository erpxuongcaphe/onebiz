-- Disposable database only: reuse actual checkout/BOM/quantity fixture.
\set ON_ERROR_STOP on
\ir 202610200004_fnb_split_quantities.integration.sql
alter table kitchen_orders
 add customer_id uuid, add customer_name text, add customer_phone text, add customer_selected boolean default false,
 add delivery_platform text, add delivery_staff_id uuid, add delivery_assigned_at timestamptz,
 add delivery_recipient text, add delivery_phone text, add delivery_address text, add delivery_note text,
 add delivery_distance_tier text, add delivery_completed_at timestamptz, add platform_commission numeric default 0;
\ir ../migrations/20261031011730_fnb_direct_delivery_split.sql
select set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
-- Zero-price packaging is a separate recipe fixture with no drink ingredients.
-- The legacy payment chain here requires a resolved recipe record.
insert into products(id,tenant_id,code,name,has_bom,inventory_role,stock,bom_code)
 values('00000000-0000-0000-0000-000000000060','00000000-0000-0000-0000-000000000002','TEST-CUP','Test cup',true,'fnb_menu_item',0,'TEST-CUP-BOM');
insert into bom(id,tenant_id,product_id,code,name)
 values('00000000-0000-0000-0000-000000000066','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000060','TEST-CUP-BOM','Test packaging recipe');
insert into kitchen_orders(id,tenant_id,branch_id,status,order_number,order_type,delivery_platform,
 delivery_fee,discount_amount,delivery_staff_id,delivery_assigned_at,delivery_recipient,delivery_phone,
 delivery_address,delivery_note,delivery_distance_tier,customer_name,customer_selected)
values('00000000-0000-0000-0000-000000000061','00000000-0000-0000-0000-000000000002',
 '00000000-0000-0000-0000-000000000003','pending','TEST-DIRECT','delivery','direct',
 15000,10000,'00000000-0000-0000-0000-000000000070',now(),'Test recipient','0900000000',
 'Test address','Test delivery note','custom','Test customer',true);
insert into kitchen_order_items(id,kitchen_order_id,product_id,product_name,quantity,unit_price,modifier_selections,note,status)
values
 ('00000000-0000-0000-0000-000000000062','00000000-0000-0000-0000-000000000061','00000000-0000-0000-0000-000000000010','Gu Viet Sua',4,30000,'[{"name":"80%"}]','Test coffee','ready'),
 ('00000000-0000-0000-0000-000000000063','00000000-0000-0000-0000-000000000061','00000000-0000-0000-0000-000000000010','Cot Dua',2,40000,'[{"name":"100%"}]','Test coconut','ready'),
 ('00000000-0000-0000-0000-000000000064','00000000-0000-0000-0000-000000000061','00000000-0000-0000-0000-000000000060','Cup',4,0,'[]',null,'ready');
do $test$
declare r jsonb; again jsonb; child uuid; qty_before numeric; stock_before numeric; n integer;
 selection jsonb:='[{"item_id":"00000000-0000-0000-0000-000000000063","quantity":1,"expected_quantity":2}]';
begin
 select quantity into stock_before from branch_stock where branch_id='00000000-0000-0000-0000-000000000003' and product_id='00000000-0000-0000-0000-000000000011';
 r:=split_kitchen_order_quantities_20261020('00000000-0000-0000-0000-000000000061',selection,'00000000-0000-0000-0000-000000000065');
 child:=(r->'children'->0->>'order_id')::uuid;
 if (select quantity from kitchen_order_items where id='00000000-0000-0000-0000-000000000063')<>1
 or (select quantity from kitchen_order_items where kitchen_order_id=child)<>1 then raise exception 'Wrong partial quantities'; end if;
 if (select modifier_selections from kitchen_order_items where kitchen_order_id=child)<>'[{"name":"100%"}]'::jsonb
 or (select note from kitchen_order_items where kitchen_order_id=child)<>'Test coconut' then raise exception 'Modifier snapshot lost'; end if;
 if exists(select 1 from kitchen_orders p join kitchen_orders c on c.id=child where p.id='00000000-0000-0000-0000-000000000061'
 and (c.order_type<>p.order_type or c.delivery_platform<>p.delivery_platform or c.delivery_staff_id is distinct from p.delivery_staff_id
 or c.delivery_assigned_at is distinct from p.delivery_assigned_at or c.delivery_address<>p.delivery_address
 or c.delivery_phone<>p.delivery_phone or c.delivery_recipient<>p.delivery_recipient or c.delivery_note<>p.delivery_note
 or c.customer_name<>p.customer_name or c.customer_selected<>p.customer_selected)) then raise exception 'Delivery/customer snapshot lost'; end if;
 if (select delivery_fee from kitchen_orders where id=child)<>0
 or (select delivery_fee from kitchen_orders where id='00000000-0000-0000-0000-000000000061')<>15000
 or (select discount_amount from kitchen_orders where id=child)<>2000
 or (select discount_amount from kitchen_orders where id='00000000-0000-0000-0000-000000000061')<>8000 then raise exception 'Fee or discount not conserved'; end if;
 if (select quantity from branch_stock where branch_id='00000000-0000-0000-0000-000000000003' and product_id='00000000-0000-0000-0000-000000000011')<>stock_before then raise exception 'Split changed stock'; end if;
 again:=split_kitchen_order_quantities_20261020('00000000-0000-0000-0000-000000000061',selection,'00000000-0000-0000-0000-000000000065');
 if r is distinct from again or (select count(*) from kitchen_orders where parent_order_id='00000000-0000-0000-0000-000000000061')<>1 then raise exception 'Retry duplicated child'; end if;
 -- Real checkout paths: total charged and recipe consumption conserved across both bills.
 perform fnb_complete_payment_atomic_v3(child,null,'Test','cash',null,999999,false,0,null,null,null,'00000000-0000-0000-0000-000000000007');
 perform fnb_complete_payment_atomic_v3('00000000-0000-0000-0000-000000000061',null,'Test','cash',null,999999,false,0,null,null,null,'00000000-0000-0000-0000-000000000007');
 if (select sum(i.total) from invoices i join kitchen_orders k on k.invoice_id=i.id where k.id in(child,'00000000-0000-0000-0000-000000000061'))<>205000 then raise exception 'Checkout double charged delivery fee'; end if;
 if stock_before-(select quantity from branch_stock where branch_id='00000000-0000-0000-0000-000000000003' and product_id='00000000-0000-0000-0000-000000000011')<>0.12 then raise exception 'Split changed recipe consumption'; end if;
 begin perform split_kitchen_order_atomic(child,'items',array['00000000-0000-0000-0000-000000000062'::uuid],null); raise exception 'Paid split allowed'; exception when invalid_parameter_value then if sqlerrm<>'KITCHEN_ORDER_NOT_SPLITTABLE' then raise; end if; end;
end $test$;
-- Platform orders reject before partial-line changes; no child/audit/stock side effects.
insert into kitchen_orders(id,tenant_id,branch_id,status,order_number,order_type,delivery_platform)
values('00000000-0000-0000-0000-000000000071','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','pending','TEST-PARTNER','delivery','grab');
insert into kitchen_order_items(id,kitchen_order_id,product_id,product_name,quantity,unit_price)
values('00000000-0000-0000-0000-000000000072','00000000-0000-0000-0000-000000000071','00000000-0000-0000-0000-000000000010','Partner drink',2,40000),
 ('00000000-0000-0000-0000-000000000073','00000000-0000-0000-0000-000000000071','00000000-0000-0000-0000-000000000010','Partner coffee',1,30000);
do $test$
declare platform text; r jsonb; child uuid; n integer;
begin
 foreach platform in array array['grab','shopeefood','be','unknown'] loop
  update kitchen_orders set delivery_platform=platform where id='00000000-0000-0000-0000-000000000071';
  begin perform split_kitchen_order_quantities_20261020('00000000-0000-0000-0000-000000000071','[{"item_id":"00000000-0000-0000-0000-000000000072","quantity":1,"expected_quantity":2}]',gen_random_uuid()); raise exception 'Platform partial split allowed'; exception when invalid_parameter_value then if sqlerrm<>'DELIVERY_ORDER_CANNOT_SPLIT' then raise; end if; end;
  begin perform split_kitchen_order_atomic('00000000-0000-0000-0000-000000000071','equal',null,2); raise exception 'Platform equal split allowed'; exception when invalid_parameter_value then if sqlerrm<>'DELIVERY_ORDER_CANNOT_SPLIT' then raise; end if; end;
 end loop;
 if (select quantity from kitchen_order_items where id='00000000-0000-0000-0000-000000000072')<>2 or exists(select 1 from kitchen_orders where parent_order_id='00000000-0000-0000-0000-000000000071') then raise exception 'Rejected split mutated order'; end if;
 update kitchen_orders set delivery_platform='direct',platform_commission_percent=5 where id='00000000-0000-0000-0000-000000000071';
 begin perform split_kitchen_order_atomic('00000000-0000-0000-0000-000000000071','equal',null,2); raise exception 'Commission split allowed'; exception when invalid_parameter_value then if sqlerrm<>'DELIVERY_ORDER_CANNOT_SPLIT' then raise; end if; end;
 update kitchen_orders set platform_commission_percent=0,delivery_completed_at=now() where id='00000000-0000-0000-0000-000000000071';
 begin perform split_kitchen_order_atomic('00000000-0000-0000-0000-000000000071','equal',null,2); raise exception 'Delivered split allowed'; exception when invalid_parameter_value then if sqlerrm<>'KITCHEN_ORDER_NOT_SPLITTABLE' then raise; end if; end;
 update kitchen_orders set delivery_completed_at=null,delivery_fee=12000 where id='00000000-0000-0000-0000-000000000071';
 r:=split_kitchen_order_atomic('00000000-0000-0000-0000-000000000071','equal',null,2);
 child:=(r->'children'->0->>'order_id')::uuid;
 if (select delivery_fee from kitchen_orders where id=child)<>0 or (select delivery_fee from kitchen_orders where id='00000000-0000-0000-0000-000000000071')<>12000 then raise exception 'Equal split duplicated fee'; end if;
 if has_function_privilege('anon','public.split_kitchen_order_atomic(uuid,text,uuid[],integer)','execute') then raise exception 'Anonymous split allowed'; end if;
end $test$;
create or replace function public.user_has_permission(uuid,text) returns boolean language sql as $$select false$$;
do $test$ begin
 begin perform split_kitchen_order_atomic('00000000-0000-0000-0000-000000000071','equal',null,2); raise exception 'Unauthorized split allowed'; exception when insufficient_privilege then null; end;
 begin perform split_kitchen_order_quantities_20261020('00000000-0000-0000-0000-000000000071','[]',gen_random_uuid()); raise exception 'Unauthorized partial split allowed'; exception when insufficient_privilege then null; end;
end $test$;
select 'PASS direct delivery split: quantities, snapshots, fees, discounts, retry, checkout, BOM, platform/delivered/permission guards' as result;
