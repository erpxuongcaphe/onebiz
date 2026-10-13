\set ON_ERROR_STOP on
-- Runs only after 00522's disposable fixture, never on production.
alter table public.profiles add column full_name text;
alter table public.branches add column name text;
alter table public.cash_transactions add column created_by uuid,add column payment_method text;
update public.profiles set full_name='Test actor';
update public.branches set name='Test branch';
insert into public.customers values('40000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001');
insert into public.cash_transactions(id,tenant_id,branch_id,reference_type,reference_id,type,code,transaction_date,created_at,status,amount,note,payment_method)
values('71000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','invoice','50000000-0000-0000-0000-000000000001','receipt','CA-OLD','2026-09-20','2026-09-20 00:00+07','cancelled',1234.56,'literal %_ note','transfer'),
('71000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','invoice','50000000-0000-0000-0000-000000000001','receipt','CA-WRONG','2026-09-20','2026-09-20 00:00+07','completed',999,'','cash');
update public.cash_transactions set customer_id='40000000-0000-0000-0000-000000000002' where code='CA-WRONG';
insert into public.suppliers values('41000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001');
insert into public.purchase_orders(id,tenant_id,branch_id,supplier_id,code) values('51000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000001','PO-OLD');
insert into public.cash_transactions(id,tenant_id,branch_id,reference_type,reference_id,type,code,transaction_date,created_at,status,amount)
values('71000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','purchase_order','51000000-0000-0000-0000-000000000001','payment','PC-OLD','2026-09-21','2026-09-21 00:00+07','draft',50);
\ir ../migrations/00523_party_cash_history_sources.sql
select set_config('test.denied_permission','',false);
do $$ declare r jsonb; before_count bigint; begin
 select count(*) into before_count from public.cash_transactions;
 r:=public.get_party_cash_history_sources('customer','40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001');
 if (r->>'total')::integer<>3 or not exists(select 1 from jsonb_array_elements(r->'items') x where x->>'code'='CA-OLD' and x->>'status'='cancelled') then raise exception 'legacy/cancelled missing: %',r; end if;
 if exists(select 1 from jsonb_array_elements(r->'items') x where x->>'code'='CA-WRONG') then raise exception 'conflicting explicit party included'; end if;
 r:=public.get_party_cash_history_sources('customer','40000000-0000-0000-0000-000000000001',null,1,2);
 if (r->>'total')::integer<>3 or jsonb_array_length(r->'items')<>1 then raise exception 'pagination dropped history'; end if;
 r:=public.get_party_cash_history_sources('customer','40000000-0000-0000-0000-000000000001',null,0,25,'{"search":"%_","dateFrom":"2026-09-01","dateTo":"2026-09-30","status":"cancelled","sortBy":"amount","ascending":true}');
 if (r->>'total')::integer<>1 or r#>>'{items,0,code}'<>'CA-OLD' then raise exception 'literal search/date/status filter failed'; end if;
 r:=public.get_party_cash_history_sources('supplier','41000000-0000-0000-0000-000000000001',null);
 if (r->>'total')::integer<>1 or r#>>'{items,0,code}'<>'PC-OLD' or r#>>'{items,0,status}'<>'draft' then raise exception 'supplier legacy/draft missing'; end if;
 begin perform public.get_party_cash_history_sources('customer','40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002'); raise exception 'foreign branch allowed'; exception when insufficient_privilege then null; end;
 perform set_config('test.denied_permission','finance.view_cash_book',true);
 begin perform public.get_party_cash_history_sources('customer','40000000-0000-0000-0000-000000000001'); raise exception 'finance permission bypass'; exception when insufficient_privilege then null; end;
 if has_function_privilege('anon','public.get_party_cash_history_sources(text,uuid,uuid,integer,integer,jsonb)','execute') then raise exception 'anon allowed'; end if;
 if (select count(*) from public.cash_transactions)<>before_count then raise exception 'read changed cash'; end if;
end $$;
