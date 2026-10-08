\set ON_ERROR_STOP on
\ir 00452_fnb_cancel.setup.sql
select test_fixture();
create function _current_caller_tenant() returns uuid language sql as $$select tenant_id from profiles where id=auth.uid()$$;
create table invoices(id uuid primary key,tenant_id uuid,code text,status text,paid numeric,shift_id uuid,void_reason text,voided_at timestamptz,voided_by uuid);
create table stock_movements(id uuid default gen_random_uuid(),tenant_id uuid,branch_id uuid,product_id uuid,type text,quantity numeric,reference_type text,reference_id uuid,note text,created_by uuid);
create table product_lots(id uuid primary key,tenant_id uuid,product_id uuid,current_qty numeric,status text,updated_at timestamptz);
create table lot_allocations(id uuid,lot_id uuid,quantity numeric,source_type text,source_id uuid,reverted_at timestamptz,reverted_reason text);
create table sales_returns(id uuid,invoice_id uuid,tenant_id uuid,status text);
create table cash_transactions(id uuid default gen_random_uuid(),tenant_id uuid,branch_id uuid,code text,type text,category text,amount numeric,counterparty text,payment_method text,reference_type text,reference_id uuid,note text,created_by uuid,shift_id uuid,status text default 'completed');
create table audit_log(tenant_id uuid,user_id uuid,action text,entity_type text,entity_id uuid,new_data jsonb);
create sequence test_cash_codes;
create function next_code(uuid,text) returns text language sql as $$select 'PC'||lpad(nextval('test_cash_codes')::text,6,'0')$$;
create function increment_product_stock(uuid,numeric) returns void language plpgsql as $$begin return; end$$;
create function upsert_branch_stock(uuid,uuid,uuid,numeric) returns void language plpgsql as $$begin return; end$$;
\i /tmp/fnb-void-core.sql
\ir ../migrations/00456_fnb_void_original_payment_methods.sql
\ir ../migrations/00456_fnb_void_original_payment_methods.sql
insert into invoices values(test_id(50),test_id(2),'HD000050','completed',50000,test_id(30),null,null,null);
insert into cash_transactions(tenant_id,branch_id,type,amount,payment_method,reference_type,reference_id) values
(test_id(2),test_id(3),'receipt',20000,'cash','invoice',test_id(50)),(test_id(2),test_id(3),'receipt',30000,'transfer','invoice',test_id(50));
select _fnb_void_invoice_impl_00165(test_id(50),test_id(10),'Nhập sai',test_id(1),test_id(2),test_id(3),test_id(30),null);
select test_assert((select count(*)=2 and sum(amount)=50000 from cash_transactions where type='payment' and reference_type='invoice_void'),'mixed refund uses two exact original receipt methods');
select test_assert((select sum(amount)=20000 from cash_transactions where type='payment' and payment_method='cash'),'cash drawer loses only original cash leg');
select test_assert((select sum(amount)=30000 from cash_transactions where type='payment' and payment_method='transfer'),'transfer refund retained');
select test_reject(format('select _fnb_void_invoice_impl_00165(%L,%L,%L,%L,%L,%L)',test_id(50),test_id(10),'Nhập sai',test_id(1),test_id(2),test_id(3)),'already voided');
insert into invoices values(test_id(51),test_id(2),'HD000051','completed',10000,test_id(30),null,null,null);
select test_reject(format('select _fnb_void_invoice_impl_00165(%L,%L,%L,%L,%L,%L)',test_id(51),test_id(11),'Nhập sai',test_id(1),test_id(2),test_id(3)),'FNB_VOID_RECEIPTS_MISMATCH');
select test_assert((select status='completed' from invoices where id=test_id(51)),'receipt mismatch rolls invoice back');
insert into sales_returns values(test_id(70),test_id(51),test_id(2),'completed');
select test_reject(format('select _fnb_void_invoice_impl_00165(%L,%L,%L,%L,%L,%L)',test_id(51),test_id(11),'Nhập sai',test_id(1),test_id(2),test_id(3)),'FNB_VOID_HAS_RETURNS');
