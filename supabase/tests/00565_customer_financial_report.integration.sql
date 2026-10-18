-- Reuse the disposable SKU fixture to verify parity, not a second revenue formula.
\set ON_ERROR_STOP on
\ir 00461_report_stock_and_sku_snapshots.integration.sql
\ir ../migrations/00565_customer_financial_report.sql
do $$ declare r jsonb; s jsonb; begin
 r:=public.get_customer_financial_report('2026-10-09 00:00+07','2026-10-10 00:00+07',null)->'rows'->0;
 s:=public.get_sku_financial_report('2026-10-09 00:00+07','2026-10-10 00:00+07',null,null);
 if (r->>'sales_amount')::numeric<>270 or (r->>'return_amount')::numeric<>45
  or (r->>'net_revenue')::numeric<>225 or (r->>'order_count')::int<>1
  or (r->>'return_count')::int<>1 or (r->>'product_count')::int<>2
  or (r->>'average_order_value')::numeric<>270 then raise exception 'Customer totals wrong: %',r; end if;
 if (r->>'net_revenue')::numeric<>(select sum((value->>'net_revenue')::numeric) from jsonb_array_elements(s->'rows')) then raise exception 'SKU/customer mismatch'; end if;
 if r->>'cogs' is not null or r->>'gross_profit' is not null or (r->>'missing_cost_lines')::int<>1 then raise exception 'Missing cost hidden'; end if;
 r:=public.get_customer_financial_report('2026-10-10 00:00+07','2026-10-11 00:00+07',null)->'rows'->0;
 if (r->>'net_revenue')::numeric<>-45 or (r->>'cogs')::numeric<>-30 or (r->>'gross_profit')::numeric<>-15 or (r->>'order_count')::int<>0 or r->>'average_order_value' is not null then raise exception 'Cross-period return wrong'; end if;
 r:=public.get_customer_financial_report('2026-10-11 00:00+07','2026-10-12 00:00+07',null)->'rows'->0;
 if r->>'customer_id' is not null or (r->>'cogs')::numeric<>30 or (r->>'gross_profit')::numeric<>-30 then raise exception 'Anonymous free sale lost'; end if;
 if jsonb_array_length(public.get_customer_financial_report('2026-10-09','2026-10-12','ffffffff-ffff-ffff-ffff-ffffffffffff')->'rows')<>0 then raise exception 'Branch scope leaked'; end if;
 begin perform public.get_customer_financial_report('2026-10-12','2026-10-09',null); raise exception 'Invalid dates accepted'; exception when invalid_datetime_format then null; end;
 perform set_config('test.deny','yes',true);
 begin perform public.get_customer_financial_report('2026-10-09','2026-10-12',null); raise exception 'ACL missing'; exception when insufficient_privilege then null; end;
 perform set_config('test.deny','no',true);
 update public.profiles set is_active=false;
 begin perform public.get_customer_financial_report('2026-10-09','2026-10-12',null); raise exception 'Inactive profile accepted'; exception when insufficient_privilege then null; end;
 update public.profiles set is_active=true,tenant_id='ffffffff-ffff-ffff-ffff-ffffffffffff';
 if jsonb_array_length(public.get_customer_financial_report('2026-10-09','2026-10-12',null)->'rows')<>0 then raise exception 'Tenant scope leaked'; end if;
end $$;
select 'PASS: customer/SKU parity, returns, anonymous, missing cost, dates, tenant and ACL';
