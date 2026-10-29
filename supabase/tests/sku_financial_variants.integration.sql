-- Disposable database only. Retain all historical report checks.
\ir 00461_report_stock_and_sku_snapshots.integration.sql
alter table public.invoice_items add column variant_id uuid;
create table public.product_variants(id uuid primary key,tenant_id uuid,product_id uuid,name text);
insert into public.product_variants values
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','250 gram'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','500 gram');
insert into public.invoices values
 ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000005','completed','2026-10-22 12:00+07','2026-10-22 12:00+07',780000,0);
insert into public.invoice_items values
 ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','Cái',1,80000,50000,'10000000-0000-0000-0000-000000000001'),
 ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','Cái',5,700000,100000,'10000000-0000-0000-0000-000000000002');
\ir ../migrations/20261029031409_sku_financial_report_variants.sql
-- Idempotent migration must not append the label or joins twice.
\ir ../migrations/20261029031409_sku_financial_report_variants.sql
do $$ declare result jsonb; small jsonb; large jsonb; begin
 result:=public.get_sku_financial_report('2026-10-22 00:00+07','2026-10-23 00:00+07',null,null);
 if jsonb_array_length(result->'rows')<>2 then raise exception 'Sizes merged: %',result; end if;
 select value into strict small from jsonb_array_elements(result->'rows') where value->>'variant_name'='250 gram';
 select value into strict large from jsonb_array_elements(result->'rows') where value->>'variant_name'='500 gram';
 if (small->>'sold_qty')::numeric<>1 or (small->>'average_sale_price')::numeric<>80000 or small->>'name'<>'Coffee · 250 gram' then raise exception '250g wrong: %',small; end if;
 if (large->>'sold_qty')::numeric<>5 or (large->>'average_sale_price')::numeric<>140000 or (large->>'cogs')::numeric<>500000 then raise exception '500g wrong: %',large; end if;
 if (select sum((value->>'sales_amount')::numeric) from jsonb_array_elements(result->'rows'))<>780000 then raise exception 'Revenue changed'; end if;
 if has_function_privilege('anon','public.get_sku_financial_report(timestamptz,timestamptz,uuid,uuid)','EXECUTE') then raise exception 'Anonymous ACL changed'; end if;
end $$;
-- Return a 500g bag in a later period, with no sale in that period.
insert into public.sales_returns values
 ('40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','completed','2026-10-24 12:00+07');
insert into public.return_items values
 ('50000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000002','Cái',1,140000);
do $$ declare r jsonb; begin
 r:=public.get_sku_financial_report('2026-10-24 00:00+07','2026-10-25 00:00+07',null,null)->'rows'->0;
 if r->>'variant_name'<>'500 gram' or (r->>'returned_qty')::numeric<>1 or (r->>'net_revenue')::numeric<>-140000 or (r->>'cogs')::numeric<>-100000 then raise exception 'Return attributed to wrong size: %',r; end if;
end $$;
-- Invoice-level discount must still allocate across BOTH sizes.
update public.invoices set discount_amount=78000 where id='20000000-0000-0000-0000-000000000001';
do $$ declare r jsonb; begin
 r:=public.get_sku_financial_report('2026-10-22 00:00+07','2026-10-23 00:00+07',null,null);
 if (select sum((value->>'sales_amount')::numeric) from jsonb_array_elements(r->'rows'))<>702000 then raise exception 'Discount allocation changed'; end if;
 if (select (value->>'average_sale_price')::numeric from jsonb_array_elements(r->'rows') where value->>'variant_name'='500 gram')<>126000 then raise exception 'Discount average wrong'; end if;
end $$;
-- Deleted variant remains distinct; never guess a missing size or leak another tenant's label.
update public.product_variants set tenant_id='ffffffff-ffff-ffff-ffff-ffffffffffff' where name='250 gram';
insert into public.invoice_items values
 ('30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','Cái',1,0,null,null);
do $$ declare r jsonb; begin
 r:=public.get_sku_financial_report('2026-10-22 00:00+07','2026-10-23 00:00+07',null,null);
 if jsonb_array_length(r->'rows')<>3 then raise exception 'Unassigned size merged'; end if;
 if exists(select 1 from jsonb_array_elements(r->'rows') where value->>'variant_name'='250 gram') then raise exception 'Foreign tenant variant name leaked'; end if;
 if not exists(select 1 from jsonb_array_elements(r->'rows') where value->>'variant_id' is null and value->>'cogs' is null) then raise exception 'Missing cost hidden'; end if;
 perform set_config('test.deny','yes',true);
 begin perform public.get_sku_financial_report('2026-10-22','2026-10-23',null,null); raise exception 'Permission bypass'; exception when insufficient_privilege then null; end;
 perform set_config('test.deny','no',true);
 begin perform public.get_sku_financial_report('2026-10-22','2026-10-23',null,'ffffffff-ffff-ffff-ffff-ffffffffffff'); raise exception 'Foreign customer accepted'; exception when insufficient_privilege then null; end;
end $$;
select 'PASS: separate sizes, returns, discounts, missing variants/cost, totals and permissions';
