\set ON_ERROR_STOP on
\ir ../migrations/00521_management_finance_external_import.sql
create table public.invoices(id uuid,tenant_id uuid,branch_id uuid,code text,status text,deleted_at timestamptz);
create table public.purchase_orders(id uuid,tenant_id uuid,branch_id uuid,code text,status text);
select set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
do $$ declare v_category uuid; v_row jsonb; v_other jsonb; v_result jsonb; v_before bigint; begin
 select id into v_category from public.management_finance_categories where tenant_id='10000000-0000-0000-0000-000000000001' and code='CP-VH-DIEN';
 v_row:=jsonb_build_object('sourceSystem','TEST','sourceCode','EXTERNAL-001','branchId','30000000-0000-0000-0000-000000000001','operation','record',
  'payload',jsonb_build_object('categoryId',v_category,'amount',100,'businessDate','2026-09-01','counterparty','External utility',
    'allocations',jsonb_build_array(jsonb_build_object('branchId','30000000-0000-0000-0000-000000000001','recognitionDate','2026-09-30','amount',100))));
 select count(*) into v_before from public.management_finance_events;
 if public.preview_management_finance_import(jsonb_build_array(v_row))#>>'{0,state}'<>'new' then raise exception 'preview state'; end if;
 if (select count(*) from public.management_finance_events)<>v_before then raise exception 'preview wrote events'; end if;
 v_result:=public.commit_management_finance_import(jsonb_build_array(v_row));
 if (select count(*) from public.management_finance_events)<>v_before+1 then raise exception 'missing event'; end if;
 if public.commit_management_finance_import(jsonb_build_array(v_row))#>'{0,result}' is distinct from v_result#>'{0,result}' then raise exception 'retry result changed'; end if;
 if (select count(*) from public.management_finance_events)<>v_before+1 then raise exception 'retry duplicated'; end if;
 v_other:=jsonb_set(v_row,'{payload,amount}','101');
 if public.preview_management_finance_import(jsonb_build_array(v_other))#>>'{0,state}'<>'conflict' then raise exception 'changed source not detected'; end if;
 begin perform public.commit_management_finance_import(jsonb_build_array(v_other)); raise exception 'changed source accepted'; exception when sqlstate 'PT409' then null; end;
 begin perform public.commit_management_finance_import(jsonb_build_array(v_row,v_row)); raise exception 'duplicate file accepted'; exception when sqlstate '22023' then null; end;
 v_other:=v_row||'{"sourceCode":"EXTERNAL-ROLLBACK"}';
 begin perform public.commit_management_finance_import(jsonb_build_array(v_other,jsonb_set(v_row||'{"sourceCode":"EXTERNAL-BAD"}','{payload,amount}','0'))); raise exception 'invalid batch accepted'; exception when sqlstate '22023' then null; end;
 if exists(select 1 from public.management_finance_import_sources where source_code='EXTERNAL-ROLLBACK') or (select count(*) from public.management_finance_events)<>v_before+1 then raise exception 'partial batch persisted'; end if;
 perform set_config('test.denied_branch','30000000-0000-0000-0000-000000000001',true);
 begin perform public.commit_management_finance_import(jsonb_build_array(v_row)); raise exception 'denied branch replayed'; exception when insufficient_privilege then null; end;
 perform set_config('test.denied_branch','',true);
 begin perform public.preview_management_finance_import(jsonb_build_array(v_row||'{"sourceCode":"MISSING-HD","operation":"invoice","referenceCode":"HD-missing"}')); raise exception 'missing reference accepted'; exception when sqlstate '22023' then null; end;
 perform set_config('test.deny_permission','finance.create_transaction',true);
 begin perform public.preview_management_finance_import(jsonb_build_array(v_row)); raise exception 'permission bypass'; exception when insufficient_privilege then null; end;
 perform set_config('test.deny_permission','',true);
 if has_table_privilege('authenticated','public.management_finance_import_sources','insert') or has_function_privilege('anon','public.commit_management_finance_import(jsonb)','execute') then raise exception 'unsafe ACL'; end if;
 if not exists(select 1 from public.cash_transactions where code='HISTORIC' and amount=17 and status='completed') then raise exception 'historic cash changed'; end if;
end; $$;
