-- Disposable database only: reuse actual checkout/BOM/quantity fixture.
\set ON_ERROR_STOP on
\ir 202610200004_fnb_split_quantities.integration.sql
alter table kitchen_orders
 add customer_id uuid, add customer_name text, add customer_selected boolean default false,
 add delivery_platform text, add delivery_staff_id uuid, add delivery_assigned_at timestamptz,
 add delivery_recipient text, add delivery_phone text, add delivery_address text,
 add delivery_distance_tier text, add delivery_completed_at timestamptz, add platform_commission numeric default 0;
\ir ../migrations/20261031011730_fnb_direct_delivery_split.sql
\ir ../migrations/20261031031808_fnb_split_live_schema_contract.sql
-- Match production exactly for optional customer/delivery fields; invented
-- columns previously concealed a real INSERT failure on every bill type.
do $$ begin
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='kitchen_orders' and column_name in ('customer_phone','delivery_note'))
 then raise exception 'Fixture contains columns absent from production'; end if;
end $$;
-- Install the actual customer inheritance and item touch triggers as well.
CREATE OR REPLACE FUNCTION public.fnb_inherit_order_customer_context()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_parent public.kitchen_orders; v_target public.kitchen_orders;
begin
  if TG_OP='INSERT' then
    if new.parent_order_id is not null then
      select * into v_parent from public.kitchen_orders where id=new.parent_order_id and tenant_id=new.tenant_id and branch_id=new.branch_id;
      if found then new.customer_id:=v_parent.customer_id; new.customer_name:=v_parent.customer_name; new.customer_selected:=v_parent.customer_selected; end if;
    end if;
    return new;
  end if;
  if new.merged_into_id is not null and old.merged_into_id is distinct from new.merged_into_id then
    select * into v_target from public.kitchen_orders where id=new.merged_into_id and tenant_id=new.tenant_id and branch_id=new.branch_id for update;
    if found and not (new.customer_selected and v_target.customer_selected and new.customer_id is not distinct from v_target.customer_id) then
      update public.kitchen_orders set customer_id=null,customer_name=null,customer_selected=false,updated_at=now() where id=v_target.id;
    end if;
  end if;
  return new;
end $function$
;
create trigger fnb_inherit_order_customer_insert before insert on public.kitchen_orders for each row execute function public.fnb_inherit_order_customer_context();
CREATE OR REPLACE FUNCTION public.fnb_touch_kitchen_order_on_item_insert_00413()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  update public.kitchen_orders
     set updated_at = now()
   where id = new.kitchen_order_id;
  return new;
end;
$function$
;
create trigger fnb_touch_kitchen_order_on_item_insert_00413 after insert on public.kitchen_order_items for each row execute function public.fnb_touch_kitchen_order_on_item_insert_00413();
-- Actual delivery eligibility/guard with synthetic profiles and memberships.
alter table profiles add role_id uuid, add role text, add branch_id uuid, add full_name text;
alter table branches add tenant_id uuid, add is_active boolean default true;
update branches set tenant_id='00000000-0000-0000-0000-000000000002';
create table roles(id uuid,tenant_id uuid,name text);
create table user_branches(user_id uuid,branch_id uuid);
insert into profiles(id,tenant_id,is_active,role,branch_id,full_name)
values('00000000-0000-0000-0000-000000000070','00000000-0000-0000-0000-000000000002',true,'cashier','00000000-0000-0000-0000-000000000003','Test delivery staff');
\ir ../migrations/20261027163753_fnb_delivery_staff_branch_scope.sql
select set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
-- Zero-price packaging is a separate recipe fixture with no drink ingredients.
-- The legacy payment chain here requires a resolved recipe record.
insert into products(id,tenant_id,code,name,has_bom,inventory_role,stock,bom_code)
 values('00000000-0000-0000-0000-000000000060','00000000-0000-0000-0000-000000000002','TEST-CUP','Test cup',true,'fnb_menu_item',0,'TEST-CUP-BOM');
insert into bom(id,tenant_id,product_id,code,name)
 values('00000000-0000-0000-0000-000000000066','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000060','TEST-CUP-BOM','Test packaging recipe');
insert into kitchen_orders(id,tenant_id,branch_id,status,order_number,order_type,delivery_platform,
 delivery_fee,discount_amount,delivery_staff_id,delivery_assigned_at,delivery_recipient,delivery_phone,
 delivery_address,delivery_distance_tier,customer_name,customer_selected)
values('00000000-0000-0000-0000-000000000061','00000000-0000-0000-0000-000000000002',
 '00000000-0000-0000-0000-000000000003','pending','TEST-DIRECT','delivery','direct',
 15000,10000,'00000000-0000-0000-0000-000000000070',now(),'Test recipient','0900000000',
 'Test address','custom','Test customer',true);
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
 or c.delivery_phone<>p.delivery_phone or c.delivery_recipient<>p.delivery_recipient
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
-- Exercise the FIXED function for all order types, not just old fixture paths.
do $matrix$
declare kind text; mode text; parent uuid; line1 uuid; line2 uuid; line3 uuid;
 table_ref uuid; request uuid; selection jsonb; r jsonb; replay jsonb;
 before_stock jsonb; after_stock jsonb;
begin
 select jsonb_agg(to_jsonb(s) order by s.branch_id,s.product_id) into before_stock from branch_stock s;
 foreach kind in array array['dine_in','takeaway','delivery'] loop
  foreach mode in array array['partial','whole','equal'] loop
   parent:=gen_random_uuid(); line1:=gen_random_uuid(); line2:=gen_random_uuid(); line3:=gen_random_uuid();
   table_ref:=case when kind='dine_in' then gen_random_uuid() else null end;
   if table_ref is not null then
    insert into restaurant_tables(id,tenant_id,status,current_order_id) values(table_ref,'00000000-0000-0000-0000-000000000002','occupied',parent);
   end if;
   insert into kitchen_orders(id,tenant_id,branch_id,status,order_number,order_type,table_id,delivery_platform,delivery_fee,discount_amount)
   values(parent,'00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','pending','TEST-'||kind||'-'||mode,kind,table_ref,
    case when kind='delivery' then 'direct' else null end,case when kind='delivery' then 15000 else 0 end,10000);
   insert into kitchen_order_items(id,kitchen_order_id,product_id,product_name,quantity,unit_price,modifier_selections)
   values(line1,parent,'00000000-0000-0000-0000-000000000010','Coffee',4,30000,'[{"name":"80%"}]'),
    (line2,parent,'00000000-0000-0000-0000-000000000010','Coconut',2,40000,'[{"name":"100%"}]'),
    (line3,parent,'00000000-0000-0000-0000-000000000060','Cup',4,0,'[]');
   if mode='partial' then
    request:=gen_random_uuid();
    selection:=jsonb_build_array(jsonb_build_object('item_id',line2,'quantity',1,'expected_quantity',2));
    r:=split_kitchen_order_quantities_20261020(parent,selection,request);
    replay:=split_kitchen_order_quantities_20261020(parent,selection,request);
    if r is distinct from replay then raise exception 'Retry differs: %',kind; end if;
   elsif mode='whole' then r:=split_kitchen_order_atomic(parent,'items',array[line2],null);
   else r:=split_kitchen_order_atomic(parent,'equal',null,2); end if;
   if (select count(*) from kitchen_orders where parent_order_id=parent)<>1 then raise exception 'Wrong children: % %',kind,mode; end if;
   if exists(select 1 from kitchen_orders where parent_order_id=parent and (order_type is distinct from kind or table_id is distinct from table_ref or delivery_fee<>0))
    then raise exception 'Lost type/table or duplicated fee: % %',kind,mode; end if;
   if (select sum(discount_amount) from kitchen_orders where id=parent or parent_order_id=parent)<>10000
    or (select sum(delivery_fee) from kitchen_orders where id=parent or parent_order_id=parent)<>(case when kind='delivery' then 15000 else 0 end)
    then raise exception 'Discount/fee not conserved: % %',kind,mode; end if;
   if (select sum(i.quantity) from kitchen_order_items i join kitchen_orders k on k.id=i.kitchen_order_id where k.id=parent or k.parent_order_id=parent)<>10
    or (select sum(i.quantity*i.unit_price) from kitchen_order_items i join kitchen_orders k on k.id=i.kitchen_order_id where k.id=parent or k.parent_order_id=parent)<>200000
    then raise exception 'Quantity/amount not conserved: % %',kind,mode; end if;
   if table_ref is not null and not exists(select 1 from restaurant_tables where id=table_ref and status='occupied' and current_order_id=parent)
    then raise exception 'Table released or reassigned by split'; end if;
  end loop;
 end loop;
 select jsonb_agg(to_jsonb(s) order by s.branch_id,s.product_id) into after_stock from branch_stock s;
 if before_stock is distinct from after_stock then raise exception 'Split matrix changed stock'; end if;
end $matrix$;
create or replace function public.user_has_permission(uuid,text) returns boolean language sql as $$select false$$;
do $test$ begin
 begin perform split_kitchen_order_atomic('00000000-0000-0000-0000-000000000071','equal',null,2); raise exception 'Unauthorized split allowed'; exception when insufficient_privilege then null; end;
 begin perform split_kitchen_order_quantities_20261020('00000000-0000-0000-0000-000000000071','[]',gen_random_uuid()); raise exception 'Unauthorized partial split allowed'; exception when insufficient_privilege then null; end;
end $test$;
select 'PASS direct delivery split: quantities, snapshots, fees, discounts, retry, checkout, BOM, platform/delivered/permission guards' as result;
