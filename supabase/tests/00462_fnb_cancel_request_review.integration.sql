\set ON_ERROR_STOP on
\ir 00455_fnb_cancel_requests.integration.sql
create table audit_log(id uuid primary key default gen_random_uuid(),tenant_id uuid,user_id uuid,action text,entity_type text,entity_id uuid,new_data jsonb);
\ir ../migrations/00462_fnb_cancel_request_review.sql
\ir ../migrations/00462_fnb_cancel_request_review.sql
update kitchen_orders set status='ready' where id=test_id(10);
update kitchen_order_items set quantity=3,cancelled_qty=0,toppings='[{"price":2000,"quantity":1}]' where id=test_id(20);
update kitchen_orders set discount_amount=3000 where id=test_id(10);
do $$ declare r jsonb; otp uuid; before_rows jsonb; begin
 perform set_config('test.actor',test_id(4)::text,false);
 r:=fnb_request_cancel_00455(test_id(10),jsonb_build_array(jsonb_build_object('id',test_id(20),'quantity',1)),'Khách đổi món',false);
 perform test_reject(format('select fnb_reject_cancel_request_00462(%L,%L)',r->>'id','Không đồng ý'),'PERMISSION_DENIED');
 perform set_config('test.actor',test_id(5)::text,false);
 perform test_reject(format('select fnb_reject_cancel_request_00462(%L,%L)',r->>'id','Không đồng ý'),'PERMISSION_DENIED');
 perform set_config('test.actor',test_id(1)::text,false);
 perform test_assert((select (v->>'cancel_net_amount')::numeric=11000 from jsonb_array_elements(fnb_pending_cancel_requests_00455()) v where v->>'id'=r->>'id'),'approval amount includes toppings and proportional discount');
 otp:=(fnb_issue_cancel_otp_00455((r->>'id')::uuid)->>'otp_id')::uuid;
 select to_jsonb(k) into before_rows from kitchen_orders k where id=test_id(10);
 perform fnb_reject_cancel_request_00462((r->>'id')::uuid,'Chưa xác nhận với khách');
 perform fnb_reject_cancel_request_00462((r->>'id')::uuid,'Chưa xác nhận với khách');
 perform test_assert((select count(*)=1 from audit_log where action='fnb_cancel_request_reject'),'reject replay creates one audit record');
 perform test_assert((select to_jsonb(k)=before_rows from kitchen_orders k where id=test_id(10)),'reject changes no bill');
 perform test_assert((select cancelled_qty=0 from kitchen_order_items where id=test_id(20)),'reject cancels no items');
 perform test_assert(not exists(select 1 from jsonb_array_elements(fnb_pending_cancel_requests_00455()) v where v->>'id'=r->>'id'),'rejected request leaves pending inbox');
 perform test_reject(format('select fnb_issue_cancel_otp_00455(%L)',r->>'id'),'FNB_CANCEL_REQUEST_REJECTED');
 perform set_config('test.actor',test_id(4)::text,false);
 perform test_reject(format('select fnb_execute_cancel_request_00455(%L,%L)',r->>'id',otp),'FNB_CANCEL_REQUEST_REJECTED');
 r:=fnb_request_cancel_00455(test_id(10),'[]','Hủy toàn bill',true);
 perform set_config('test.actor',test_id(1)::text,false);
 perform test_assert((select (v->>'cancel_net_amount')::numeric=33000 from jsonb_array_elements(fnb_pending_cancel_requests_00455()) v where v->>'id'=r->>'id'),'whole bill net amount');
 perform test_assert(not has_table_privilege('authenticated','fnb_cancel_requests','UPDATE'),'no direct status changes');
end $$;
