-- Dedicated disposable database; fixture adapters never connect to production.
\set ON_ERROR_STOP on
\ir 00452_fnb_cancel.setup.sql
alter table profiles add full_name text;
create table branches(id uuid primary key,tenant_id uuid,name text);
alter table kitchen_order_items add cancelled_qty integer default 0;
alter table kitchen_orders add discount_amount numeric default 0;
\i /tmp/fnb-unpaid-cancel-chain.sql
\ir ../migrations/00452_fnb_cancel_preserve_sibling_bills.sql
create function issue_manager_otp(text,jsonb,uuid,text,text) returns jsonb language plpgsql as $$
declare otp uuid:=gen_random_uuid(); begin
 insert into manager_otp_codes values(otp,(select tenant_id from profiles where id=auth.uid()),$3,$1,$2,auth.uid(),null,null);
 return jsonb_build_object('success',true,'otp_id',otp,'code','123456','expires_at',now()+interval '2 minutes','action_code',$1);
end $$;
select test_fixture();
\ir ../migrations/00455_fnb_cancel_requests.sql
\ir ../migrations/00455_fnb_cancel_requests.sql
create or replace function user_has_permission(p_actor uuid,p_permission text) returns boolean language sql as $$
 select coalesce((select role='owner' or (role='cashier' and p_permission='pos_fnb.view_orders') from profiles where id=p_actor),false)
$$;
do $$ declare r jsonb; result jsonb; otp uuid; snapshot jsonb; begin
 update kitchen_order_items set quantity=3,toppings='[{"price":2000,"quantity":1}]' where id=test_id(20);
 update kitchen_orders set discount_amount=3000 where id=test_id(10);
 r:=fnb_request_cancel_00455(test_id(10),jsonb_build_array(jsonb_build_object('id',test_id(20),'quantity',1)),'Nhập nhầm',false);
 result:=fnb_execute_cancel_request_00455((r->>'id')::uuid);
 perform test_assert((select cancelled_qty=1 and quantity=3 from kitchen_order_items where id=test_id(20)),'retain sent quantity, record cancelled separately');
 perform test_assert((select discount_amount=2000 from kitchen_orders where id=test_id(10)),'proportional discount uses toppings and remaining quantity');
 perform test_assert((select amount=11000 from pos_exception_events where event_type='cancel_unpaid_item'),'net cancellation value and audit');
 perform test_assert(fnb_execute_cancel_request_00455((r->>'id')::uuid)=result,'retry returns committed result without another cancellation');
 perform test_assert((select count(*)=1 from pos_exception_events),'retry creates no duplicate event');
 perform test_reject(format('select fnb_request_cancel_00455(%L,%L::jsonb,%L,false)',test_id(10),'[{"id":"'||test_id(20)||'","quantity":2}]','Nhập nhầm'),'USE_WHOLE_BILL_CANCEL');
 perform set_config('test.actor',test_id(4)::text,false);
 r:=fnb_request_cancel_00455(test_id(10),jsonb_build_array(jsonb_build_object('id',test_id(20),'quantity',1)),'Khách đổi món',false);
 perform test_reject(format('select fnb_execute_cancel_request_00455(%L)',r->>'id'),'OTP_REQUIRED');
 perform set_config('test.actor',test_id(1)::text,false);
 perform test_assert(jsonb_array_length(fnb_pending_cancel_requests_00455())=1,'manager sees prefilled pending request');
 otp:=(fnb_issue_cancel_otp_00455((r->>'id')::uuid)->>'otp_id')::uuid;
 update manager_otp_codes set used_at=now(),used_by=test_id(4) where id=otp;
 perform set_config('test.actor',test_id(4)::text,false);
 perform test_reject(format('select fnb_execute_cancel_request_00455(%L,%L)',r->>'id',test_id(40)),'FNB_CANCEL_OTP_SCOPE_REQUIRED');
 perform fnb_execute_cancel_request_00455((r->>'id')::uuid,otp);
 perform test_assert((select cancelled_qty=2 from kitchen_order_items where id=test_id(20)),'delegated exact request executes once');
 perform test_assert((select approved_by=test_id(1) from pos_exception_events where reason_note='Khách đổi món'),'current manager recorded');
 r:=fnb_request_cancel_00455(test_id(10),'[]','Hủy toàn bill',true);
 perform set_config('test.actor',test_id(1)::text,false);
 otp:=(fnb_issue_cancel_otp_00455((r->>'id')::uuid)->>'otp_id')::uuid;
 update manager_otp_codes set used_at=now(),used_by=test_id(4) where id=otp;
 update kitchen_order_items set note='changed on other device' where id=test_id(20);
 perform set_config('test.actor',test_id(4)::text,false);
 perform test_reject(format('select fnb_execute_cancel_request_00455(%L,%L)',r->>'id',otp),'FNB_CANCEL_ORDER_CHANGED');
 perform test_assert((select status='ready' from kitchen_orders where id=test_id(10)),'stale request changes no bill');
 perform set_config('test.actor',test_id(5)::text,false);
 perform test_reject(format('select fnb_request_cancel_00455(%L,%L::jsonb,%L,true)',test_id(10),'[]','Hủy toàn bill'),'FNB_CANCEL_BRANCH_ACCESS_DENIED');
 perform test_assert(not has_table_privilege('authenticated','fnb_cancel_requests','INSERT'),'no direct request mutation');
 perform set_config('test.actor',test_id(1)::text,false);
 r:=fnb_request_cancel_00455(test_id(10),'[]','Hủy sau đối chiếu',true);
 perform fnb_execute_cancel_request_00455((r->>'id')::uuid);
 perform test_assert((select amount=11000 and metadata->>'request_id'=r->>'id' from pos_exception_events where event_type='unpaid_order_cancel'),'whole cancellation includes remaining toppings and net discount');
 perform test_assert((select status='occupied' and current_order_id=test_id(11) from restaurant_tables where id=test_id(9)),'whole cancellation preserves sibling bill');
end $$;
