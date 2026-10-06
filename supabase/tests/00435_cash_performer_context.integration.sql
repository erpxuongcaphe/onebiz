\set ON_ERROR_STOP on
create schema auth;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
end; $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.actor',true),'')::uuid $$;
create table public.profiles(id uuid primary key,tenant_id uuid,full_name text,is_active boolean);
create table public.branches(id uuid primary key,tenant_id uuid,is_active boolean);
create table public.test_access(user_id uuid,branch_id uuid);
create function public.user_has_branch_access(p_user uuid,p_branch uuid) returns boolean language sql stable as $$ select exists(select 1 from public.test_access where user_id=p_user and branch_id=p_branch) $$;
create function public.user_has_permission(p_user uuid,p_permission text) returns boolean language sql stable as $$ select p_user='00000000-0000-0000-0000-000000000001'::uuid $$;
create table public.cash_transactions(id uuid primary key default gen_random_uuid(),tenant_id uuid,branch_id uuid,created_by uuid,amount numeric);
create table public.audit_log(tenant_id uuid,user_id uuid,action text,entity_type text,entity_id uuid,new_data jsonb);
create function public.record_cash_transaction_timed(p_operation text,p_payload jsonb,p_occurred_at timestamptz,p_transaction_date date,p_time_reason text)
returns jsonb language plpgsql as $$ declare v_id uuid; begin
  insert into public.cash_transactions(tenant_id,branch_id,created_by,amount) values(
    '10000000-0000-0000-0000-000000000001',(p_payload->>'branchId')::uuid,auth.uid(),10) returning id into v_id;
  return jsonb_build_object('id',v_id);
end; $$;
create function public.allocate_invoice_code(uuid) returns text language sql as $$ select 'internal-only'::text $$;
grant execute on function public.allocate_invoice_code(uuid) to anon,authenticated;
\ir ../migrations/00436_invoice_code_helper_acl.sql
do $$ begin
  if has_function_privilege('anon','public.allocate_invoice_code(uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.allocate_invoice_code(uuid)','EXECUTE') then
    raise exception 'internal invoice helper exposed';
  end if;
end; $$;
insert into public.profiles values
('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Creator',true),
('00000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','Actual payer',true),
('00000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002','Other tenant',true),
('00000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','Inactive',false);
insert into public.branches values ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',true);
insert into public.test_access values
('00000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001'),
('00000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001');
insert into public.cash_transactions(tenant_id,branch_id,created_by,amount) values('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',99);
\ir ../migrations/00435_cash_performer_context.sql
select set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
do $$ declare v_result jsonb; v_count integer; v_id uuid; begin
  if (select performed_by from public.cash_transactions where amount=99) is not null then raise exception 'historical data changed'; end if;
  if jsonb_array_length(public.get_cash_performers('20000000-0000-0000-0000-000000000001'))<>2 then raise exception 'performer scope incorrect'; end if;
  v_result:=public.record_cash_transaction_context('manual','{"branchId":"20000000-0000-0000-0000-000000000001"}','00000000-0000-0000-0000-000000000002');
  v_id:=(v_result->>'id')::uuid;
  if v_result->>'performed_by_name'<>'Actual payer' or v_result->>'created_by'<>'00000000-0000-0000-0000-000000000001' then raise exception 'creator and performer conflated'; end if;
  select count(*) into v_count from public.cash_transactions;
  begin update public.cash_transactions set performed_by_name='Invented payer' where id=v_id; raise exception 'direct metadata change accepted'; exception when insufficient_privilege then null; end;
  begin perform public.record_cash_transaction_context('manual','{"branchId":"20000000-0000-0000-0000-000000000001"}','00000000-0000-0000-0000-000000000003'); raise exception 'cross tenant accepted'; exception when sqlstate '22023' then null; end;
  begin perform public.record_cash_transaction_context('manual','{"branchId":"20000000-0000-0000-0000-000000000001"}','00000000-0000-0000-0000-000000000004'); raise exception 'inactive accepted'; exception when sqlstate '22023' then null; end;
  delete from public.test_access where user_id='00000000-0000-0000-0000-000000000002';
  begin perform public.record_cash_transaction_context('manual','{"branchId":"20000000-0000-0000-0000-000000000001"}','00000000-0000-0000-0000-000000000002'); raise exception 'wrong branch accepted'; exception when insufficient_privilege then null; end;
  if (select count(*) from public.cash_transactions)<>v_count then raise exception 'metadata failure did not roll back cash'; end if;
  if has_function_privilege('anon','public.get_cash_performers(uuid)','EXECUTE') then raise exception 'anonymous access'; end if;
  if not exists(select 1 from public.audit_log where entity_id=v_id and action='cash_performer_recorded') then raise exception 'missing audit'; end if;
end; $$;
select set_config('test.actor','00000000-0000-0000-0000-000000000003',false);
do $$ begin
  begin perform public.get_cash_performers('20000000-0000-0000-0000-000000000001'); raise exception 'wrong tenant read allowed'; exception when insufficient_privilege then null; end;
end; $$;
