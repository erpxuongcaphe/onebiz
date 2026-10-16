\set ON_ERROR_STOP on
set timezone = 'Asia/Ho_Chi_Minh';
-- Disposable fixture only; no production connection is accepted by its runner.
do $$ begin if to_regclass('public.profiles') is not null then raise exception 'Fresh isolated database required'; end if; end $$;
create schema auth;
do $$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
create function test_id(integer) returns uuid language sql immutable as $$select ('00000000-0000-0000-0000-'||lpad($1::text,12,'0'))::uuid$$;
create table tenants(id uuid primary key);
create table profiles(id uuid primary key,tenant_id uuid,is_active boolean,full_name text);
create table branches(id uuid primary key,tenant_id uuid,is_active boolean,name text);
create function user_has_permission(uuid,text) returns boolean language sql stable as $$select coalesce(current_setting('test.denied',true),'')<>$2$$;
create function user_has_branch_access(uuid,uuid) returns boolean language sql stable as $$select $2=public.test_id(3) and coalesce(current_setting('test.branch_denied',true),'')<>'yes'$$;
create function get_user_tenant_id() returns uuid language sql stable as $$select tenant_id from public.profiles where id=auth.uid() and is_active$$;
create function assert_report_access(text,uuid) returns void language plpgsql as $$begin if not public.user_has_permission(auth.uid(),$1) then raise exception 'REPORT_DENIED';end if;end$$;
create sequence cash_code_seq;
create function next_cash_code(uuid,text) returns text language sql as $$select case when $2='receipt' then 'PT-' else 'PC-' end||nextval('public.cash_code_seq')$$;
create function next_code(uuid,text) returns text language sql as $$select 'CASH-'||nextval('public.cash_code_seq')$$;
create table customers(id uuid primary key,tenant_id uuid,name text,debt numeric default 0);
create table suppliers(id uuid primary key,tenant_id uuid,name text,debt numeric default 0);
create table cash_transactions(id uuid primary key default gen_random_uuid(),tenant_id uuid,branch_id uuid,code text,type text,category text,amount numeric,counterparty text,payment_method text,reference_type text,reference_id uuid,customer_id uuid,supplier_id uuid,note text,created_by uuid,status text,transaction_date date default current_date,created_at timestamptz default now(),updated_at timestamptz default now(),shift_id uuid);
create table invoices(id uuid primary key,tenant_id uuid,branch_id uuid,code text,customer_id uuid,customer_name text,total numeric,paid numeric,debt numeric,status text,updated_at timestamptz,created_at timestamptz,ngay_chung_tu timestamptz);
alter table invoices add column deleted_at timestamptz;
create table purchase_orders(id uuid primary key,tenant_id uuid,branch_id uuid,code text,supplier_id uuid,supplier_name text,total numeric,paid numeric,debt numeric,status text,updated_at timestamptz,created_at timestamptz default now());
create table audit_log(id uuid default gen_random_uuid(),tenant_id uuid,user_id uuid,action text,entity_type text,entity_id uuid,old_data jsonb,new_data jsonb);
create table shifts(id uuid,tenant_id uuid,branch_id uuid,cashier_id uuid,status text,opened_at timestamptz);
create table customer_debt_adjustments(id uuid primary key default gen_random_uuid(),tenant_id uuid,branch_id uuid,customer_id uuid,invoice_id uuid,amount numeric,reason text,idempotency_key text,cash_transaction_id uuid,created_by uuid,created_at timestamptz default now());
create table debt_opening_balances(id uuid default gen_random_uuid(),tenant_id uuid,branch_id uuid,party_type text,customer_id uuid,supplier_id uuid,amount numeric,opening_date date);
create table sales_returns(id uuid,tenant_id uuid,branch_id uuid,customer_id uuid);
create table supplier_returns(id uuid,tenant_id uuid,branch_id uuid,supplier_id uuid);
create table stock_movements(id uuid,tenant_id uuid,branch_id uuid,reference_type text,reference_id uuid,type text,created_at timestamptz);
insert into tenants values(test_id(2)),(test_id(99));
insert into profiles values(test_id(1),test_id(2),true,'Test administrator'),(test_id(98),test_id(99),true,'Foreign actor');
insert into branches values(test_id(3),test_id(2),true,'Test branch'),(test_id(4),test_id(2),true,'Denied branch');
insert into customers values(test_id(5),test_id(2),'Test customer',0);
insert into suppliers values(test_id(6),test_id(2),'Test supplier',0);
alter table suppliers add column updated_at timestamptz;
alter table customers add column updated_at timestamptz;
\ir ../migrations/00267_harden_cash_book_atomic.sql
\ir ../migrations/00383_supplier_advance_payment.sql
\ir ../migrations/00384_counterparty_advance_balances.sql
\ir ../migrations/00385_counterparty_advance_allocation.sql
\ir ../migrations/00428_cash_transaction_occurrence_time.sql
\ir ../migrations/00435_cash_performer_context.sql
\ir ../migrations/00438_management_income_expense_ledger.sql
\ir ../migrations/00523_party_cash_history_sources.sql
\ir ../migrations/00552_money_account_register.sql
\ir ../migrations/00553_party_cash_amendments.sql
\ir ../migrations/00554_gross_open_debt_aging.sql
select set_config('test.actor',test_id(1)::text,false);
create function test_assert(boolean,text) returns void language plpgsql as $$begin if $1 is distinct from true then raise exception 'ASSERT: %',$2;end if;end$$;
