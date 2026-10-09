-- Dedicated disposable PostgreSQL only; never run this fixture on production.
\set ON_ERROR_STOP on
\ir 00461_report_stock_and_sku_snapshots.integration.sql
alter table public.products add column inventory_role text;
alter table public.stock_movements add column unit_price numeric;
alter table public.stock_movements add column reference_id uuid;
update public.stock_movements set reference_id='00000000-0000-0000-0000-000000000009' where id='00000000-0000-0000-0000-000000000006';
insert into public.stock_movements(id,tenant_id,branch_id,product_id,quantity,type,reference_type,created_at,unit_cost,reference_id) values
 ('00000000-0000-0000-0000-000000000018','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003',20,'in','return_bom_restore','2026-10-09 12:00+07',9999,null),
 ('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003',30,'in','invoice_void','2026-10-10 12:00+07',9999,'00000000-0000-0000-0000-000000000009'),
 ('00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000004',10,'in','invoice_void','2026-10-10 12:00+07',9999,'00000000-0000-0000-0000-000000000016');
insert into public.fnb_branch_product_cost_events values
 ('00000000-0000-0000-0000-000000000019','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000018',20,'in',8200),
 ('00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000020',30,'in',12300);
\ir ../migrations/00464_report_movement_values_and_net_bom.sql
\ir ../migrations/00464_report_movement_values_and_net_bom.sql
do $$ declare result jsonb; r jsonb; begin
 result:=public.report_nvl_consumption_net('2026-10-09','2026-10-09',null);
 select value into r from jsonb_array_elements(result) where value->>'material_code'='SKU-01';
 if (r->>'issue_qty')::numeric<>100 or (r->>'restore_qty')::numeric<>20 or (r->>'total_qty')::numeric<>80 or (r->>'total_cost')::numeric<>32800 then raise exception 'Net BOM incorrect: %',r; end if;
 select value into r from jsonb_array_elements(result) where value->>'material_code'='SKU-02';
 if r->>'issue_cost' is not null or (r->>'restore_cost')::numeric<>0 or r->>'total_cost' is not null then raise exception 'Missing cost hidden: %',r; end if;
 result:=public.report_nvl_consumption_net('2026-10-10','2026-10-10',null);
 if jsonb_array_length(result)<>1 or (result->0->>'total_qty')::numeric<>-30 or (result->0->>'total_cost')::numeric<>-12300 then raise exception 'Cross-period/void scope incorrect: %',result; end if;
 result:=public.get_xnt_movement_values('2026-10-09 00:00+07','2026-10-10 00:00+07',null);
 select value into r from jsonb_array_elements(result) where value->>'product_id'='00000000-0000-0000-0000-000000000003' and value->>'bucket'='outSale';
 if (r->>'amount')::numeric<>41000 then raise exception 'Issue historical amount incorrect: %',r; end if;
 select value into r from jsonb_array_elements(result) where value->>'bucket'='inReturn';
 if (r->>'amount')::numeric<>8200 then raise exception 'Return value incorrect: %',r; end if;
 perform set_config('test.deny','yes',true);
 begin perform public.report_nvl_consumption_net('2026-10-09','2026-10-09',null); raise exception 'ACL missing'; exception when insufficient_privilege then null; end;
 begin perform public.get_xnt_movement_values('2026-10-09','2026-10-10',null); raise exception 'ACL missing'; exception when insufficient_privilege then null; end;
 perform set_config('test.deny','no',true);
 begin perform public.report_nvl_consumption_net('2026-10-10','2026-10-09',null); raise exception 'Date guard missing'; exception when invalid_parameter_value then null; end;
 if has_function_privilege('authenticated','public._report_movement_values_00464(timestamptz,timestamptz,uuid,uuid)','execute') or has_function_privilege('anon','public.report_nvl_consumption_net(date,date,uuid)','execute') then raise exception 'Private helper or anonymous report exposed'; end if;
end $$;
select 'PASS: gross/restored/net BOM, cross-period void, historical bucket amount, null cost, ACL and idempotency';
