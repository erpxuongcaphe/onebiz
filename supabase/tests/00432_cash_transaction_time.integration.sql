\set ON_ERROR_STOP on
-- Run only on a fresh, disposable database. No production connections.
do $$ begin
  if current_database()<>'cash_time_test' or to_regclass('public.profiles') is not null then
    raise exception 'Fresh isolated cash_time_test required';
  end if;
end $$;
create schema auth;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
end $$;
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
create table profiles(id uuid primary key, tenant_id uuid, is_active boolean);
create table branches(id uuid primary key, tenant_id uuid, is_active boolean);
create function user_has_permission(uuid,text) returns boolean language sql as $$select coalesce(current_setting('test.permission',true),'yes')<>'no'$$;
create function user_has_branch_access(uuid,uuid) returns boolean language sql as $$select $2='00000000-0000-0000-0000-000000000003'::uuid and coalesce(current_setting('test.branch',true),'yes')<>'no'$$;
create sequence cash_code_seq;
create function next_cash_code(uuid,text) returns text language sql as $$select 'CASH-'||nextval('cash_code_seq')$$;
create function next_code(uuid,text) returns text language sql as $$select 'CASH-'||nextval('cash_code_seq')$$;
create table cash_transactions(id uuid primary key default gen_random_uuid(),tenant_id uuid,branch_id uuid,code text,type text,category text,amount numeric,counterparty text,payment_method text,reference_type text,reference_id uuid,customer_id uuid,supplier_id uuid,note text,created_by uuid,status text,transaction_date date default current_date,created_at timestamptz default now(),shift_id uuid);
create table invoices(id uuid primary key,tenant_id uuid,branch_id uuid,code text,customer_id uuid,customer_name text,total numeric,paid numeric,debt numeric,status text,updated_at timestamptz,created_at timestamptz);
create table purchase_orders(id uuid primary key,tenant_id uuid,branch_id uuid,code text,supplier_id uuid,supplier_name text,total numeric,paid numeric,debt numeric,status text,updated_at timestamptz);
create table audit_log(id uuid default gen_random_uuid(),tenant_id uuid,user_id uuid,action text,entity_type text,entity_id uuid,new_data jsonb);
create table shifts(id uuid,tenant_id uuid,branch_id uuid,cashier_id uuid,status text,opened_at timestamptz);
create table customers(id uuid primary key,tenant_id uuid,name text);
create table suppliers(id uuid primary key,tenant_id uuid,name text);
create table supplier_advances(id uuid default gen_random_uuid(),tenant_id uuid,branch_id uuid,supplier_id uuid,cash_transaction_id uuid,source_purchase_order_id uuid,original_amount numeric,remaining_amount numeric,note text,created_by uuid);
create table customer_debt_adjustments(id uuid default gen_random_uuid(),tenant_id uuid,branch_id uuid,customer_id uuid,amount numeric,reason text,idempotency_key text,cash_transaction_id uuid,created_by uuid);
create table customer_advances(id uuid default gen_random_uuid(),tenant_id uuid,branch_id uuid,customer_id uuid,cash_transaction_id uuid,adjustment_id uuid,original_amount numeric,remaining_amount numeric,note text,created_by uuid);
insert into profiles values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002',true);
insert into branches values('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000002',true);
insert into customers values('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000002','Customer');
insert into suppliers values('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000002','Supplier');
insert into invoices values('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','OLD-INVOICE','00000000-0000-0000-0000-000000000004','Customer',1000,0,1000,'completed',now(),now()-interval '30 days');
insert into invoices select '00000000-0000-0000-0000-000000000011'::uuid,'00000000-0000-0000-0000-000000000099'::uuid,branch_id,'FOREIGN',customer_id,customer_name,total,paid,debt,status,updated_at,created_at from invoices;
insert into purchase_orders values('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','PO','00000000-0000-0000-0000-000000000005','Supplier',1000,0,1000,'completed',now());
insert into cash_transactions(id,created_at,transaction_date,amount) values('00000000-0000-0000-0000-000000000030','2025-01-01T12:34:56Z','2024-12-30',77);
\ir ../migrations/00428_cash_transaction_occurrence_time.sql
-- Applying twice must preserve historic unknown timestamps.
\ir ../migrations/00428_cash_transaction_occurrence_time.sql
select set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
create function test_assert(boolean,text) returns void language plpgsql as $$begin if $1 is distinct from true then raise exception 'ASSERT: %',$2; end if; end$$;
select test_assert((select occurred_at is null and time_source is null and created_at='2025-01-01T12:34:56Z' and transaction_date='2024-12-30' from cash_transactions where id='00000000-0000-0000-0000-000000000030'),'legacy untouched');
select test_assert(('2026-10-04T17:30:00Z'::timestamptz at time zone 'Asia/Ho_Chi_Minh')::date='2026-10-05','Vietnam midnight');
select test_assert(not has_function_privilege('anon','public.record_cash_transaction_timed(text,jsonb,timestamptz,date,text)','execute'),'anonymous blocked');
select test_assert(has_function_privilege('authenticated','public.record_cash_transaction_timed(text,jsonb,timestamptz,date,text)','execute'),'authenticated wrapper ACL');
do $$ declare r jsonb; c cash_transactions%rowtype; at_time timestamptz:=now()-interval '2 days'; begin
  r:=record_cash_transaction_timed('invoice','{"referenceId":"00000000-0000-0000-0000-000000000010","amount":100,"paymentMethod":"cash"}',at_time,null,'Thu từ hôm trước');
  select * into c from cash_transactions where id=(r->>'cash_transaction_id')::uuid;
  perform test_assert(c.occurred_at=at_time and c.time_source='entered' and c.created_at<>at_time,'occurrence independent from creation');
  perform test_assert(c.transaction_date=(at_time at time zone 'Asia/Ho_Chi_Minh')::date,'book day follows actual cash, not invoice');
  perform test_assert((select paid=100 and debt=900 from invoices where id='00000000-0000-0000-0000-000000000010'),'debt amount unchanged semantics');
  r:=record_cash_transaction_timed('purchase_order','{"referenceId":"00000000-0000-0000-0000-000000000020","amount":100,"paymentMethod":"transfer"}',now(),null,null);
  perform test_assert((select amount=100 and type='payment' from cash_transactions where id=(r->>'cash_transaction_id')::uuid),'purchase cash linked');
  r:=record_cash_transaction_timed('customer_advance','{"partyId":"00000000-0000-0000-0000-000000000004","branchId":"00000000-0000-0000-0000-000000000003","amount":100,"paymentMethod":"cash","note":"Ứng trước"}',now(),null,null);
  perform test_assert((select occurred_at is not null from cash_transactions where id=(r->>'cash_transaction_id')::uuid),'customer advance timing');
  r:=record_cash_transaction_timed('supplier_advance','{"partyId":"00000000-0000-0000-0000-000000000005","branchId":"00000000-0000-0000-0000-000000000003","amount":100,"paymentMethod":"cash","note":"Ứng trước"}',now(),null,null);
  perform test_assert((select occurred_at is not null from cash_transactions where id=(r->>'cash_transaction_id')::uuid),'supplier advance timing');
  r:=record_cash_transaction_timed('manual','{"branchId":"00000000-0000-0000-0000-000000000003","type":"receipt","category":"other","amount":100,"paymentMethod":"cash"}',null,(now() at time zone 'Asia/Ho_Chi_Minh')::date-2,'Import ngày cũ');
  perform test_assert(r->>'occurred_at' is null and r->>'time_source'='date_only','date-only import never invents time');
end $$;
-- Any failed metadata/audit write must roll back cash AND the debt update.
create function reject_time_audit() returns trigger language plpgsql as $$begin if new.action='cash_time_recorded' then raise exception 'TEST_AUDIT_FAILURE'; end if; return new; end$$;
create trigger test_audit_failure before insert on audit_log for each row execute function reject_time_audit();
do $$ declare n bigint; p numeric; begin
  select count(*) into n from cash_transactions; select paid into p from invoices where id='00000000-0000-0000-0000-000000000010';
  begin
    perform record_cash_transaction_timed('invoice','{"referenceId":"00000000-0000-0000-0000-000000000010","amount":10,"paymentMethod":"cash"}',now(),null,null);
    raise exception 'EXPECTED_AUDIT_FAILURE';
  exception when others then if sqlerrm<>'TEST_AUDIT_FAILURE' then raise; end if; end;
  perform test_assert((select count(*)=n from cash_transactions),'audit failure rolls cash back');
  perform test_assert((select paid=p from invoices where id='00000000-0000-0000-0000-000000000010'),'audit failure rolls debt back');
end $$;
drop trigger test_audit_failure on audit_log;
do $$ declare n bigint; payload jsonb:='{"referenceId":"00000000-0000-0000-0000-000000000010","amount":10,"paymentMethod":"cash"}'; begin
  select count(*) into n from cash_transactions;
  begin perform record_cash_transaction_timed('invoice',payload,now()+interval '1 hour',null,null); raise exception 'EXPECTED'; exception when sqlstate '22023' then null; end;
  begin perform record_cash_transaction_timed('invoice',payload,now()-interval '1 day',null,null); raise exception 'EXPECTED'; exception when sqlstate '22023' then null; end;
  begin perform record_cash_transaction_timed('invoice',jsonb_set(payload,'{referenceId}','"00000000-0000-0000-0000-000000000011"'),now(),null,null); raise exception 'EXPECTED'; exception when others then if sqlerrm<>'INVOICE_NOT_FOUND' then raise; end if; end;
  perform set_config('test.permission','no',false);
  begin perform record_cash_transaction_timed('invoice',payload,now(),null,null); raise exception 'EXPECTED'; exception when others then if sqlerrm<>'INSUFFICIENT_PERMISSION' then raise; end if; end;
  perform set_config('test.permission','yes',false); perform set_config('test.branch','no',false);
  begin perform record_cash_transaction_timed('invoice',payload,now(),null,null); raise exception 'EXPECTED'; exception when others then if sqlerrm<>'BRANCH_ACCESS_DENIED' then raise; end if; end;
  perform set_config('test.branch','yes',false);
  perform test_assert((select count(*)=n from cash_transactions),'rejected requests leave no cash rows');
end $$;
select 'cash timing: legacy, five flows, timezone, auth, tenant, branch, rollback PASS';
