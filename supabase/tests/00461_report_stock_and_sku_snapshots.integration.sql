-- Dedicated disposable PostgreSQL only.
\set ON_ERROR_STOP on
do $$ begin
 if to_regclass('public.profiles') is not null or to_regclass('public.invoices') is not null then
  raise exception 'Fixture requires an empty disposable database';
 end if;
end $$;
create schema auth;
do $$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
end $$;
create function auth.uid() returns uuid language sql stable as $$ select '00000000-0000-0000-0000-000000000001'::uuid $$;
create table public.profiles(id uuid,tenant_id uuid,is_active boolean);
create table public.products(id uuid,tenant_id uuid,code text,name text,stock_unit text,unit text,category_id uuid,cost_price numeric);
create table public.categories(id uuid,tenant_id uuid,name text);
create table public.branches(id uuid,tenant_id uuid,name text);
create table public.customers(id uuid,tenant_id uuid,code text,name text);
create table public.stock_movements(id uuid,tenant_id uuid,branch_id uuid,product_id uuid,quantity numeric,type text,reference_type text,created_at timestamptz,unit_cost numeric);
create table public.fnb_branch_product_cost_events(id uuid,tenant_id uuid,branch_id uuid,product_id uuid,source_stock_movement_id uuid,quantity numeric,direction text,total_cost numeric);
create table public.invoices(id uuid,tenant_id uuid,branch_id uuid,customer_id uuid,status text,issued_at timestamptz,created_at timestamptz,subtotal numeric,discount_amount numeric);
create table public.invoice_items(id uuid,invoice_id uuid,product_id uuid,unit text,quantity numeric,total numeric,unit_cost numeric);
create table public.sales_returns(id uuid,tenant_id uuid,branch_id uuid,invoice_id uuid,status text,created_at timestamptz);
create table public.return_items(id uuid,return_id uuid,product_id uuid,invoice_item_id uuid,unit text,quantity numeric,total numeric);
create function public.assert_report_access(text,uuid) returns void language plpgsql as $$ begin if current_setting('test.deny',true)='yes' then raise exception using errcode='42501',message='REPORT_DENIED'; end if; end $$;
create function public._fnb_branch_cost_tracking_enabled_00390(uuid,uuid) returns boolean language sql as $$ select $2='00000000-0000-0000-0000-000000000002'::uuid $$;
create function public.resolve_sales_return_source_line(uuid) returns table(invoice_item_id uuid,unit_cost numeric,resolution text) language sql as $$ select ii.id,ii.unit_cost,'exact'::text from public.return_items ri join public.invoice_items ii on ii.id=ri.invoice_item_id where ri.id=$1 $$;
insert into public.profiles values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',true);
insert into public.branches values('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','FNB');
insert into public.products values('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','SKU-01','Coffee','G','G',null,9999);
insert into public.products values('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001','SKU-02','Tea','G','G',null,9999);
insert into public.customers values('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000001','KLE-001','A');
insert into public.stock_movements values('00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003',100,'out','bom_consume','2026-10-09 00:01+07',1);
insert into public.fnb_branch_product_cost_events values('00000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000006',100,'out',41000);
insert into public.stock_movements values('00000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000004',100,'out','bom_consume','2026-10-09 23:59+07',1);
insert into public.invoices values('00000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000005','completed','2026-10-09 00:01+07','2026-10-08 10:00+07',300,30);
insert into public.invoice_items values('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000003','Ly',2,100,30);
insert into public.invoice_items values('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000004','Ly',1,200,null);
insert into public.sales_returns values('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000009','completed','2026-10-09 12:00+07');
insert into public.return_items values('00000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000010','Ly',1,45);
\ir ../migrations/00461_report_stock_and_sku_snapshots.sql
do $$ declare result jsonb; row jsonb; begin
 if (select total_cost from public.report_nvl_consumption_by_branch('2026-10-09','2026-10-09',null) where material_code='SKU-01')<>41000 then raise exception 'immutable branch event not used'; end if;
 if (select total_cost from public.report_nvl_consumption_by_branch('2026-10-09','2026-10-09',null) where material_code='SKU-02') is not null then raise exception 'missing FNB cost collapsed'; end if;
 result:=public.get_sku_financial_report('2026-10-09 00:00+07','2026-10-10 00:00+07',null,null);
 if jsonb_array_length(result->'rows')<>2 or jsonb_array_length(result->'customers')<>1 then raise exception 'all SKU/customer scope incomplete'; end if;
 select value into row from jsonb_array_elements(result->'rows') where value->>'code'='SKU-01';
 if (row->>'net_revenue')::numeric<>45 or (row->>'cogs')::numeric<>30 or (row->>'gross_profit')::numeric<>15 then raise exception 'discount/return snapshot wrong: %',row; end if;
 select value into row from jsonb_array_elements(result->'rows') where value->>'code'='SKU-02';
 if row->>'cogs' is not null or row->>'gross_profit' is not null then raise exception 'missing snapshot hidden'; end if;
 result:=public.get_sku_financial_report('2026-10-10 00:00+07','2026-10-11 00:00+07',null,null);
 if jsonb_array_length(result->'rows')<>0 then raise exception 'date boundary wrong'; end if;
 perform set_config('test.deny','yes',true);
 begin perform public.get_sku_financial_report('2026-10-09','2026-10-10',null,null); raise exception 'permission missing'; exception when insufficient_privilege then null; end;
 perform set_config('test.deny','no',true);
 begin perform public.get_sku_financial_report('2026-10-09','2026-10-10',null,'ffffffff-ffff-ffff-ffff-ffffffffffff'); raise exception 'cross tenant customer accepted'; exception when insufficient_privilege then null; end;
end $$;
insert into public.sales_returns values('00000000-0000-0000-0000-000000000014','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000009','completed','2026-10-10 12:00+07');
insert into public.return_items values('00000000-0000-0000-0000-000000000015','00000000-0000-0000-0000-000000000014','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000010','Ly',1,45);
insert into public.invoices values('00000000-0000-0000-0000-000000000016','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002',null,'completed','2026-10-11 12:00+07','2026-10-11 12:00+07',0,0);
insert into public.invoice_items values('00000000-0000-0000-0000-000000000017','00000000-0000-0000-0000-000000000016','00000000-0000-0000-0000-000000000003','Ly',1,0,30);
do $$ declare result jsonb; row jsonb; begin
 result:=public.get_sku_financial_report('2026-10-10 00:00+07','2026-10-11 00:00+07',null,'00000000-0000-0000-0000-000000000005');
 row:=result->'rows'->0;
 if (row->>'sold_qty')::numeric<>0 or (row->>'net_revenue')::numeric<>-45 or (row->>'cogs')::numeric<>-30 or (row->>'gross_profit')::numeric<>-15 then
  raise exception 'Cross-period return lost: %',row;
 end if;
 result:=public.get_sku_financial_report('2026-10-11 00:00+07','2026-10-12 00:00+07',null,null);
 row:=result->'rows'->0;
 if (row->>'net_revenue')::numeric<>0 or (row->>'cogs')::numeric<>30 or (row->>'gross_profit')::numeric<>-30 or (row->>'customer_count')::numeric<>0 then
  raise exception 'Free anonymous sale lost cost: %',row;
 end if;
 result:=public.get_sku_financial_report('2026-10-11 00:00+07','2026-10-12 00:00+07',null,'00000000-0000-0000-0000-000000000005');
 if jsonb_array_length(result->'rows')<>0 then raise exception 'Customer filter leaked anonymous sale'; end if;
end $$;
select 'PASS: historical event, null cost, date, discount, return, customer and ACL';
