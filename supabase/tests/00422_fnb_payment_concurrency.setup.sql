-- Disposable contract schema: real payment/BOM/lot functions; auth/settings
-- adapters and unused return stubs come from the existing snapshot fixture.
-- No complete Supabase RLS, cost-ledger trigger or production parity claim.
\set ON_ERROR_STOP on
do $$ begin
  if current_database() not in ('fnb_payment_concurrency_test', 'fnb_payment_cost_test', 'fnb_payment_return_cost_test') or to_regclass('public.products') is not null then
    raise exception 'Requires a fresh dedicated payment concurrency database';
  end if;
end $$;
\ir 00410_fnb_invoice_item_bom_return_snapshot.setup.sql
create schema auth;
create schema extensions;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.actor', true), '')::uuid $$;
create function public.user_has_permission(uuid,text) returns boolean language sql as $$ select true $$;
create function public.user_has_branch_access(uuid,uuid) returns boolean language sql as $$ select true $$;
create function public.get_tenant_setting(uuid,text,jsonb) returns jsonb language sql as $$ select 'false'::jsonb $$;
create sequence test_document_code;
create function public.next_code(uuid,text) returns text language sql as $$ select $2 || nextval('public.test_document_code')::text $$;
create table profiles(id uuid primary key, tenant_id uuid, is_active boolean);
create table customers(id uuid primary key,tenant_id uuid);
create table branches(id uuid primary key, cascade_mode text);
create table promotions(id uuid primary key);
create table coupons(id uuid primary key);
create table shifts(id uuid primary key,tenant_id uuid,branch_id uuid,cashier_id uuid,status text);
create table kitchen_orders(id uuid primary key,tenant_id uuid,branch_id uuid,invoice_id uuid,status text,table_id uuid,discount_amount numeric default 0,delivery_fee numeric default 0,platform_commission_percent numeric default 0,platform_commission_amount numeric,order_number text,created_at timestamptz default now(),updated_at timestamptz);
create table kitchen_order_items(kitchen_order_id uuid,product_id uuid,variant_id uuid,product_name text,variant_label text,quantity numeric,unit_price numeric,toppings jsonb,modifier_selections jsonb);
create table restaurant_tables(id uuid primary key,tenant_id uuid,status text,current_order_id uuid,updated_at timestamptz);
create table audit_log(tenant_id uuid,user_id uuid,action text,entity_type text,entity_id uuid,new_data jsonb);
create table cash_transactions(id uuid primary key default gen_random_uuid(),tenant_id uuid,branch_id uuid,code text,type text,category text,amount numeric,counterparty text,payment_method text,reference_type text,reference_id uuid,note text,created_by uuid,shift_id uuid);
alter table products add tenant_id uuid, add code text, add name text, add bom_code text, add stock numeric default 0, add vat_rate numeric default 0, add has_bom boolean default false, add inventory_role text, add product_type text, add channel text, add is_active boolean default true, add sell_price numeric;
alter table invoices alter id set default gen_random_uuid();
alter table invoices add code text, add customer_id uuid, add customer_name text, add subtotal numeric, add discount_amount numeric, add tax_amount numeric, add total numeric, add paid numeric, add debt numeric, add delivery_fee numeric, add platform_commission numeric, add platform_commission_percent numeric, add payment_method text, add note text, add created_by uuid, add shift_id uuid, add tip_amount numeric;
alter table invoice_items add unit_cost numeric;
create table product_variants(id uuid primary key,product_id uuid,tenant_id uuid,bom_code text);
create table bom(id uuid primary key,tenant_id uuid,product_id uuid,branch_id uuid,code text,name text,version integer default 1,is_active boolean default true);
create table bom_items(id uuid primary key default gen_random_uuid(),bom_id uuid,material_id uuid,unit text,quantity numeric,waste_percent numeric default 0,modifier_scale_target uuid,sort_order integer default 0);
create table modifier_options(id uuid primary key,group_id uuid);
create table bom_modifier_option_quantities(bom_id uuid,material_id uuid,modifier_option_id uuid,quantity numeric);
create table branch_stock(tenant_id uuid,branch_id uuid,product_id uuid,variant_id uuid,quantity numeric,reserved numeric default 0,updated_at timestamptz default now());
create unique index test_base_stock_unique on branch_stock(tenant_id,branch_id,product_id) where variant_id is null;
create table product_lots(id uuid primary key default gen_random_uuid(),tenant_id uuid,product_id uuid,branch_id uuid,lot_number text,current_qty numeric,expiry_date date,manufactured_date date,received_date date default current_date,created_at timestamptz default now(),updated_at timestamptz,status text default 'active');
create table lot_allocations(tenant_id uuid,lot_id uuid,source_type text,source_id uuid,quantity numeric,allocated_by uuid);
create table test_payment_results(client text primary key,result jsonb);
\i /tmp/fnb-payment-posting-chain.sql
\ir ../migrations/00304_fnb_topping_gia_server.sql
\i /tmp/fnb-payment-replay-chain.sql
\ir ../migrations/00410_fnb_invoice_item_bom_return_snapshot.sql
\ir ../migrations/00412_fnb_invoice_line_branch_bom_cost.sql

insert into profiles values ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002',true);
insert into branches values ('00000000-0000-0000-0000-000000000003','outlet');
insert into shifts values ('00000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','open');
insert into products(id,tenant_id,code,name,bom_code,has_bom,inventory_role,stock) values
('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000002','UAT-MENU','UAT drink','UAT-BOM',true,'fnb_menu_item',0),
('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000002','UAT-RAW1','UAT raw 1',null,false,'stock_item',510),
('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000002','UAT-RAW2','UAT raw 2',null,false,'stock_item',510);
insert into bom(id,tenant_id,product_id,code,name) values ('00000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000010','UAT-BOM','UAT drink BOM');
insert into bom_items(bom_id,material_id,unit,quantity,sort_order) values
('00000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000011','kg',0.02,1),
('00000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000012','kg',0.1,2);
insert into branch_stock(tenant_id,branch_id,product_id,quantity)
select tenant_id, b.id, p.id, b.qty from products p cross join (values
('00000000-0000-0000-0000-000000000003'::uuid,10),
('00000000-0000-0000-0000-000000000009'::uuid,500)) b(id,qty) where p.code in ('UAT-RAW1','UAT-RAW2');
insert into product_lots(tenant_id,product_id,branch_id,lot_number,current_qty)
select tenant_id,id,'00000000-0000-0000-0000-000000000003','UAT-LOT-' || code,10 from products where code in ('UAT-RAW1','UAT-RAW2');
insert into kitchen_orders(id,tenant_id,branch_id,status,order_number) values ('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','pending','UAT-CONCURRENT');
insert into kitchen_order_items(kitchen_order_id,product_id,product_name,variant_label,quantity,unit_price) values ('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000010','UAT drink','M',1,30000);
create function public.test_pay(p_order uuid default '00000000-0000-0000-0000-000000000005') returns jsonb language sql as $$
select public.fnb_complete_payment_atomic_v3($1,null,'UAT','cash',null,50000,false,0,null,null,null,'00000000-0000-0000-0000-000000000007')
$$;
