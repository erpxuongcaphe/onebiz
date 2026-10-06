\set ON_ERROR_STOP on
-- Runs after the 00438 fixture in the same isolated database.
\ir ../migrations/00440_management_finance_cash_flow_sources.sql
-- Session settings do not survive the separate psql process used by CI.
select set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
do $$ declare v_category uuid; v_event jsonb; v_cash jsonb; v_payload jsonb; v_result jsonb; v_count bigint; begin
 select id into v_category from public.management_finance_categories where tenant_id='10000000-0000-0000-0000-000000000001' and code='CP-VH-DIEN';
 if (public.get_management_finance_cash_links('2026-09-01','2026-09-30')->>'total')::integer<>0 then raise exception 'recognition mistaken for cash'; end if;
 v_payload:=jsonb_build_object('categoryId',v_category,'businessDate','2026-09-30','amount',100,'counterparty','Test utility',
  'allocations',jsonb_build_array(jsonb_build_object('branchId','30000000-0000-0000-0000-000000000001','recognitionDate','2026-09-30','amount',100)));
 v_event:=public.post_management_finance_event(gen_random_uuid(),v_payload);
 v_cash:=public.settle_management_finance_event((v_event->>'id')::uuid,gen_random_uuid(),jsonb_build_object('amount',40,'branchId','30000000-0000-0000-0000-000000000002',
  'performedBy','00000000-0000-0000-0000-000000000001','transactionDate','2026-10-05','paymentMethod','cash','timeReason','Test prior date'));
 v_result:=public.get_management_finance_cash_links('2026-10-01','2026-10-31','30000000-0000-0000-0000-000000000002');
 if (v_result->>'total')::integer<>1 or v_result#>>'{items,0,cash_flow_activity}'<>'operating' or v_result#>>'{items,0,cash_id}'<>v_cash->>'id'
 or v_result#>>'{items,0,event_code}'<>v_event->>'code' then raise exception 'source link or classification wrong'; end if;
 if (public.get_management_finance_cash_links('2026-10-01','2026-10-31','30000000-0000-0000-0000-000000000001')->>'total')::integer<>0 then raise exception 'cash branch replaced by recognition branch'; end if;
 if (public.get_management_finance_cash_links('2026-10-01','2026-10-31',null,1,1)->>'items')<>'[]' then raise exception 'paging duplicate'; end if;
 begin perform public.get_management_finance_cash_links('infinity','infinity'); raise exception 'infinite dates allowed'; exception when sqlstate '22023' then null; end;
 begin perform public.get_management_finance_cash_links('2026-10-01','2026-10-31','30000000-0000-0000-0000-000000000003'); raise exception 'foreign branch allowed'; exception when insufficient_privilege then null; end;
 perform set_config('test.denied_branch','30000000-0000-0000-0000-000000000001',true);
 if (public.get_management_finance_cash_links('2026-10-01','2026-10-31')->>'total')::integer<>0 then raise exception 'restricted source exposed'; end if;
 perform set_config('test.denied_branch','',true);
 select count(*) into v_count from public.management_finance_categories;
 begin perform public.save_management_finance_category_with_cash_flow('TEST-BAD','Bad','expense',(select parent_id from public.management_finance_categories where id=v_category),'wrong'); raise exception 'bad activity accepted'; exception when sqlstate '22023' then null; end;
 if (select count(*) from public.management_finance_categories)<>v_count then raise exception 'invalid category persisted'; end if;
 v_result:=public.save_management_finance_category_with_cash_flow('TEST-GOOD','Custom','expense',(select parent_id from public.management_finance_categories where id=v_category),'investing');
 if v_result->>'cash_flow_activity'<>'investing' then raise exception 'custom activity lost'; end if;
 update public.cash_transactions set status='cancelled' where id=(v_cash->>'id')::uuid;
 if (public.get_management_finance_cash_links('2026-10-01','2026-10-31')->>'total')::integer<>0 then raise exception 'cancelled cash counted'; end if;
 perform set_config('test.deny_permission','finance.view_cash_book',true);
 begin perform public.get_management_finance_cash_links('2026-10-01','2026-10-31'); raise exception 'permission bypass'; exception when insufficient_privilege then null; end;
 perform set_config('test.deny_permission','',true);
 if has_function_privilege('anon','public.get_management_finance_cash_links(date,date,uuid,integer,integer)','execute') then raise exception 'anonymous access'; end if;
 if not exists(select 1 from public.cash_transactions where code='HISTORIC' and amount=17 and status='completed') then raise exception 'historic cash changed'; end if;
end; $$;
