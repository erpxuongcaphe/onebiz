\set ON_ERROR_STOP on
\ir 00462_fnb_cancel_request_review.integration.sql
\ir ../migrations/00472_fnb_cancel_toppings_json_null.sql
\ir ../migrations/00472_fnb_cancel_toppings_json_null.sql
update kitchen_order_items set toppings='null'::jsonb,quantity=3,cancelled_qty=0 where id=test_id(20);
update kitchen_orders set discount_amount=3000,status='ready' where id=test_id(10);
do $$ declare r jsonb; otp uuid; result jsonb; begin
 perform set_config('test.actor',test_id(4)::text,false);
 r:=fnb_request_cancel_00455(test_id(10),jsonb_build_array(jsonb_build_object('id',test_id(20),'quantity',1)),'Không lấy món',false);
 perform set_config('test.actor',test_id(1)::text,false);
 perform test_assert((select (v->>'cancel_net_amount')::numeric=9000 from jsonb_array_elements(fnb_pending_cancel_requests_00455()) v where v->>'id'=r->>'id'),'JSON null toppings inbox computes exact net amount');
 otp:=(fnb_issue_cancel_otp_00455((r->>'id')::uuid)->>'otp_id')::uuid;
 update manager_otp_codes set used_at=now(),used_by=test_id(4) where id=otp;
 perform set_config('test.actor',test_id(4)::text,false);
 result:=fnb_execute_cancel_request_00455((r->>'id')::uuid,otp);
 perform test_assert((select cancelled_qty=1 from kitchen_order_items where id=test_id(20)),'JSON null delegated cancellation executes');
 perform test_assert(fnb_execute_cancel_request_00455((r->>'id')::uuid,otp)=result,'JSON null cancellation replay idempotent');
 perform test_assert((select discount_amount=2000 from kitchen_orders where id=test_id(10)),'JSON null preserves proportional discount');
end $$;
