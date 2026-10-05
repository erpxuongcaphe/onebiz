\set ON_ERROR_STOP on
-- Verify the production timed RPC on the disposable first-payment fixture.
-- Initial candidate was proven in CI run 37309814711 before client integration.
do $$ begin
  if current_database()<>'fnb_payment_concurrency_test' then raise exception 'Disposable concurrency database required'; end if;
end $$;
alter table cash_transactions add column created_at timestamptz;
alter table cash_transactions alter column created_at set default now();
alter table cash_transactions add column occurred_at timestamptz;
alter table cash_transactions add column transaction_date date;
alter table cash_transactions add column time_source text;
alter table cash_transactions add column time_reason text;
create or replace function public.user_has_permission(uuid,text) returns boolean language sql as $$select coalesce(current_setting('test.denied_permission',true),'')<>$2$$;
create or replace function public.user_has_branch_access(uuid,uuid) returns boolean language sql as $$select coalesce(current_setting('test.deny_branch',true),'')<>'yes'$$;

\ir ../migrations/00429_fnb_offline_cash_occurrence.sql
\ir ../migrations/00429_fnb_offline_cash_occurrence.sql

insert into kitchen_orders(id,tenant_id,branch_id,status,order_number)
select '00000000-0000-0000-0000-000000000008',tenant_id,branch_id,'pending','UAT-TIMED' from kitchen_orders limit 1;
insert into kitchen_order_items(kitchen_order_id,product_id,product_name,quantity,unit_price)
values('00000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000010','Timed drink',1,30000);
create function public.test_timed_pay(p_order uuid default '00000000-0000-0000-0000-000000000008',p_at timestamptz default now()-interval '2 days') returns jsonb language sql as $$
select fnb_complete_payment_timed_v1(jsonb_build_object('p_kitchen_order_id',$1,'p_customer_name','UAT','p_payment_method','cash','p_paid',50000,'p_shift_id','00000000-0000-0000-0000-000000000007'),$2)
$$;
select set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
create table test_cash_before as select * from cash_transactions;
do $$ declare r jsonb; at_time timestamptz:=now()-interval '2 days'; n bigint; a bigint; s numeric; begin
  r:=test_timed_pay(p_at=>at_time);
  perform test_assert((select count(*)=1 and min(occurred_at)=at_time and min(transaction_date)=(at_time at time zone 'Asia/Ho_Chi_Minh')::date and min(time_source)='offline' and min(created_at)>at_time from cash_transactions where reference_id=(r->>'invoice_id')::uuid),'first payment records original offline cash time');
  select count(*) into n from cash_transactions; select count(*) into a from audit_log; select sum(quantity) into s from stock_movements;
  r:=test_timed_pay(p_at=>now()-interval '4 days');
  perform test_assert(r->>'idempotent'='true','actual payment replay result preserved');
  perform test_assert((select min(occurred_at)=at_time from cash_transactions where reference_id=(r->>'invoice_id')::uuid),'replay does not rewrite receipt time');
  perform test_assert((select count(*)=n from cash_transactions) and (select count(*)=a from audit_log) and (select sum(quantity)=s from stock_movements),'replay has no cash, audit or stock writes');
end $$;
select test_assert(not exists(select 1 from test_cash_before b join cash_transactions c using(id) where to_jsonb(b) is distinct from to_jsonb(c)),'all historic receipts unchanged');
create function test_timed_error(p_expected text) returns void language plpgsql as $$declare msg text; begin
  begin perform test_timed_pay(); exception when others then msg:=sqlerrm; end;
  perform test_assert(msg=p_expected,'guard: '||p_expected);
end $$;
select set_config('test.denied_permission','pos_fnb.checkout',false);
select test_timed_error('FNB_CHECKOUT_DENIED');
select set_config('test.denied_permission','',false);
select set_config('test.deny_branch','yes',false);
select test_timed_error('BRANCH_ACCESS_DENIED');
select set_config('test.deny_branch','',false);
insert into profiles values('00000000-0000-0000-0000-000000000090','00000000-0000-0000-0000-000000000099',true);
select set_config('test.actor','00000000-0000-0000-0000-000000000090',false);
select test_timed_error('KITCHEN_ORDER_NOT_FOUND');
select set_config('test.actor','',false);
select test_timed_error('AUTH_REQUIRED');
select test_assert(not has_function_privilege('anon','public.fnb_complete_payment_timed_v1(jsonb,timestamptz)','execute'),'anon RPC denied');
select set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
do $$ declare msg text; begin
  begin perform test_timed_pay(p_at=>now()+interval '1 hour'); exception when others then msg:=sqlerrm; end;
  perform test_assert(msg='CASH_TIME_INVALID','future device clock rejected');
end $$;
insert into kitchen_orders(id,tenant_id,branch_id,status,order_number)
select '00000000-0000-0000-0000-000000000040',tenant_id,branch_id,'pending','UAT-TIMED-ROLLBACK' from kitchen_orders limit 1;
insert into kitchen_order_items(kitchen_order_id,product_id,product_name,quantity,unit_price)
values('00000000-0000-0000-0000-000000000040','00000000-0000-0000-0000-000000000010','Rollback drink',1,30000);
create function reject_timed_audit() returns trigger language plpgsql as $$begin if new.action='cash_time_recorded' then raise exception 'TEST_TIMED_AUDIT_FAILURE'; end if; return new; end$$;
create trigger reject_timed_audit before insert on audit_log for each row execute function reject_timed_audit();
do $$ declare n bigint; i bigint; a bigint; s numeric; msg text; begin
  select count(*) into n from cash_transactions; select count(*) into i from invoices;
  select count(*) into a from audit_log; select sum(quantity) into s from stock_movements;
  begin perform test_timed_pay('00000000-0000-0000-0000-000000000040'); exception when others then msg:=sqlerrm; end;
  perform test_assert(msg='TEST_TIMED_AUDIT_FAILURE','injected timing audit failure');
  perform test_assert((select count(*)=n from cash_transactions) and (select count(*)=i from invoices) and (select count(*)=a from audit_log) and (select sum(quantity)=s from stock_movements),'timing audit failure rolls back money, invoice, stock and audit');
  perform test_assert((select invoice_id is null from kitchen_orders where id='00000000-0000-0000-0000-000000000040'),'failed timing audit never links invoice');
end $$;
\echo 'PASS: offline time candidate with actual checkout chain, first payment, same-transaction replay, exact new receipt, historic sentinel, tenant/branch/auth guards.'
