\set ON_ERROR_STOP on
create schema auth;
do $$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
end; $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.actor',true),'')::uuid $$;
create table public.tenants(id uuid primary key);
create table public.profiles(id uuid primary key,tenant_id uuid,is_active boolean,full_name text);
create table public.branches(id uuid primary key,tenant_id uuid,is_active boolean,name text);
create table public.cash_transactions(id uuid primary key default gen_random_uuid(),tenant_id uuid,branch_id uuid,created_by uuid,code text,type text,category text,amount numeric,
 status text,transaction_date date,occurred_at timestamptz,performed_by_name text,payment_method text,created_at timestamptz default now());
create table public.audit_log(id uuid default gen_random_uuid(),tenant_id uuid,user_id uuid,action text,entity_type text,entity_id uuid,new_data jsonb);
create function public.user_has_permission(p_actor uuid,p_permission text) returns boolean language sql stable as $$
 select coalesce(current_setting('test.deny_permission',true),'')<>p_permission $$;
create function public.user_has_branch_access(p_actor uuid,p_branch uuid) returns boolean language sql stable as $$
 select p_branch is not null and exists(select 1 from public.branches b join public.profiles p on p.tenant_id=b.tenant_id where p.id=p_actor and b.id=p_branch)
 and coalesce(current_setting('test.denied_branch',true),'')<>p_branch::text $$;
create function public.record_cash_transaction_timed(p_operation text,p_payload jsonb,p_occurred_at timestamptz,p_transaction_date date,p_time_reason text)
returns jsonb language plpgsql as $$ declare v_row public.cash_transactions; v_tenant uuid; begin
 select tenant_id into v_tenant from public.profiles where id=auth.uid();
 if not public.user_has_branch_access(auth.uid(),(p_payload->>'branchId')::uuid) then raise exception 'CASH_BRANCH_DENIED' using errcode='42501'; end if;
 if p_operation<>'manual' or p_payload->>'type' not in ('receipt','payment') then raise exception 'CASH_TYPE_INVALID' using errcode='22023'; end if;
 insert into public.cash_transactions(tenant_id,branch_id,created_by,code,type,category,amount,status,transaction_date,occurred_at,payment_method)
 values(v_tenant,(p_payload->>'branchId')::uuid,auth.uid(),'PC-test',p_payload->>'type',p_payload->>'category',(p_payload->>'amount')::numeric,'completed',
 coalesce(p_transaction_date,(now() at time zone 'Asia/Ho_Chi_Minh')::date),p_occurred_at,p_payload->>'paymentMethod') returning * into v_row;
 return to_jsonb(v_row);
end; $$;
insert into public.tenants values('10000000-0000-0000-0000-000000000001'),('10000000-0000-0000-0000-000000000002');
insert into public.profiles values('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',true,'Admin'),
 ('00000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002',true,'Other tenant');
insert into public.branches values('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',true,'XTB'),
 ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001',true,'Retail'),
 ('30000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002',true,'Foreign');
insert into public.cash_transactions(tenant_id,branch_id,code,type,amount,status,transaction_date) values
 ('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','HISTORIC','receipt',17,'completed','2026-01-01');
\ir ../migrations/00435_cash_performer_context.sql
\ir ../migrations/00438_management_income_expense_ledger.sql
select set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
do $$ declare v_category uuid; v_group uuid; v_payload jsonb; v_result jsonb; v_id uuid; v_cash jsonb; v_payment jsonb; v_report jsonb; v_count bigint; begin
 select id into v_category from public.management_finance_categories where tenant_id='10000000-0000-0000-0000-000000000001' and code='CP-VH-DIEN';
 select id into v_group from public.management_finance_categories where tenant_id='10000000-0000-0000-0000-000000000001' and code='CP-VH';
 v_payload:=jsonb_build_object('categoryId',v_category,'amount',1000,'businessDate','2026-09-30','counterparty','Electric utility','allocations',
  jsonb_build_array(jsonb_build_object('branchId','30000000-0000-0000-0000-000000000001','recognitionDate','2026-09-30','amount',600),
  jsonb_build_object('branchId','30000000-0000-0000-0000-000000000002','recognitionDate','2026-09-30','amount',400)));
 v_result:=public.post_management_finance_event('40000000-0000-0000-0000-000000000001',v_payload); v_id:=(v_result->>'id')::uuid;
 if v_result->>'code'<>'CP000001' then raise exception 'first code not sequential'; end if;
 if (public.post_management_finance_event('40000000-0000-0000-0000-000000000001',v_payload)->>'id')::uuid<>v_id then raise exception 'replay duplicated'; end if;
 begin perform public.post_management_finance_event('40000000-0000-0000-0000-000000000001',v_payload||'{"note":"changed"}'); raise exception 'changed replay allowed'; exception when sqlstate 'PT409' then null; end;
 begin perform public.post_management_finance_event(gen_random_uuid(),v_payload||jsonb_build_object('categoryId',v_group)); raise exception 'group posting allowed'; exception when sqlstate '22023' then null; end;
 begin perform public.post_management_finance_event(gen_random_uuid(),v_payload||'{"amount":999}'); raise exception 'unbalanced allowed'; exception when sqlstate '22023' then null; end;
 if (select next_value from public.management_finance_counters where kind='expense')<>2 then raise exception 'invalid requests consumed counter'; end if;
 v_payment:=jsonb_build_object('amount',300,'branchId','30000000-0000-0000-0000-000000000001','performedBy','00000000-0000-0000-0000-000000000001',
  'transactionDate','2026-10-05','paymentMethod','cash','timeReason','Test backdated payment');
 v_cash:=public.settle_management_finance_event(v_id,'50000000-0000-0000-0000-000000000001',v_payment);
 perform public.settle_management_finance_event(v_id,'50000000-0000-0000-0000-000000000001',v_payment);
 if (select count(*) from public.management_finance_settlements)<>1 then raise exception 'settlement replay duplicated'; end if;
 if v_cash->>'performed_by_name'<>'Admin' or v_cash->>'created_by'<>'00000000-0000-0000-0000-000000000001' then raise exception 'actual cash context metadata missing'; end if;
 begin perform public.settle_management_finance_event(v_id,gen_random_uuid(),v_payment||'{"performedBy":"00000000-0000-0000-0000-000000000002"}'); raise exception 'foreign performer accepted'; exception when sqlstate '22023' then null; end;
 if (select count(*) from public.management_finance_settlements)<>1 then raise exception 'rejected performer left settlement'; end if;
 v_report:=public.get_management_finance_workspace('2026-09-01','2026-09-30');
 if (v_report#>>'{summary,expense}')::numeric<>1000 or (v_report#>>'{items,0,settled_amount}')::numeric<>0 then raise exception 'recognition/payment periods mixed'; end if;
 if (public.get_management_finance_workspace('2026-09-01','2026-09-30','30000000-0000-0000-0000-000000000001')#>>'{summary,expense}')::numeric<>600 then raise exception 'branch allocation wrong'; end if;
 if (public.get_management_finance_workspace('2026-10-01','2026-10-31')#>>'{summary,expense}')::numeric<>0 then raise exception 'cash counted again as expense'; end if;
 begin perform public.settle_management_finance_event(v_id,gen_random_uuid(),v_payment||'{"amount":701}'); raise exception 'overpayment allowed'; exception when sqlstate '22023' then null; end;
 begin perform public.cancel_management_finance_event(v_id,'Test cancellation'); raise exception 'active cash event cancelled'; exception when sqlstate 'PT409' then null; end;
 update public.cash_transactions set status='cancelled' where id=(v_cash->>'id')::uuid;
 if (public.get_management_finance_workspace('2026-09-01','2026-10-31')#>>'{items,0,settled_amount}')::numeric<>0 then raise exception 'cancelled cash retained'; end if;
 perform public.cancel_management_finance_event(v_id,'Test cancellation');
 if (public.get_management_finance_workspace('2026-09-01','2026-09-30')#>>'{summary,expense}')::numeric<>0 then raise exception 'cancelled expense retained'; end if;
 select count(*) into v_count from public.management_finance_events;
 begin perform public.save_management_finance_document(gen_random_uuid(),v_payload||jsonb_build_object('payment',v_payment||'{"amount":1001}')); raise exception 'invalid immediate payment accepted'; exception when sqlstate '22023' then null; end;
 if (select count(*) from public.management_finance_events)<>v_count then raise exception 'failed immediate settlement left event'; end if;
 perform set_config('test.denied_branch','30000000-0000-0000-0000-000000000002',true);
 if (public.get_management_finance_workspace('2026-09-01','2026-09-30')->>'total')::integer<>0 then raise exception 'shared document exposed foreign branch'; end if;
 begin perform public.post_management_finance_event(gen_random_uuid(),v_payload); raise exception 'denied branch write allowed'; exception when insufficient_privilege then null; end;
 begin perform public.post_management_finance_event('40000000-0000-0000-0000-000000000001',v_payload); raise exception 'denied branch replay exposed event'; exception when insufficient_privilege then null; end;
 perform set_config('test.denied_branch','',true);
 perform set_config('test.actor','00000000-0000-0000-0000-000000000002',true);
 begin perform public.settle_management_finance_event(v_id,gen_random_uuid(),v_payment); raise exception 'cross tenant event exposed'; exception when insufficient_privilege then null; end;
 perform set_config('test.actor','00000000-0000-0000-0000-000000000001',true);
 perform set_config('test.deny_permission','finance.create_transaction',true);
 begin perform public.post_management_finance_event(gen_random_uuid(),v_payload); raise exception 'permission bypass'; exception when insufficient_privilege then null; end;
 perform set_config('test.deny_permission','',true);
 if not exists(select 1 from public.cash_transactions where code='HISTORIC' and amount=17 and status='completed') then raise exception 'historical cash changed'; end if;
 if has_table_privilege('authenticated','public.management_finance_events','SELECT') or has_function_privilege('anon','public.get_management_finance_categories()','EXECUTE') then raise exception 'private data exposed'; end if;
end; $$;
