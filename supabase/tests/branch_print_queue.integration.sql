\set ON_ERROR_STOP on
create schema extensions;
create extension pgcrypto with schema extensions;
do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if; if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; end $$;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.actor',true),'')::uuid $$;
create table public.tenants(id uuid primary key);
create table public.branches(id uuid primary key,tenant_id uuid,is_active boolean default true);
create table public.profiles(id uuid primary key,tenant_id uuid,full_name text,is_active boolean default true);
create table public.kitchen_stations(id uuid primary key,branch_id uuid,tenant_id uuid);
create function public.user_has_permission(p_actor uuid,p_permission text) returns boolean language sql stable as $$
 select current_setting('test.permission',true)='manager' or (current_setting('test.permission',true)='kitchen' and p_permission='pos_fnb.send_kitchen') or (current_setting('test.permission',true)='cashier' and p_permission in ('pos_fnb.checkout','pos_fnb.view_orders'))
$$;
create function public.user_has_branch_access(p_actor uuid,p_branch uuid) returns boolean language sql stable as $$ select p_branch::text=current_setting('test.branch',true) $$;
insert into tenants values('10000000-0000-0000-0000-000000000001');
insert into branches values('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',true);
insert into profiles values('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Nhân viên',true);
\ir ../migrations/20261006110000_fnb_branch_print_queue.sql
select set_config('test.actor','30000000-0000-0000-0000-000000000001',false);
select set_config('test.branch','20000000-0000-0000-0000-000000000001',false);
select set_config('test.permission','manager',false);
do $$
declare branch uuid:='20000000-0000-0000-0000-000000000001'; point jsonb; creds jsonb; claimed jsonb; job uuid:='40000000-0000-0000-0000-000000000001'; payload text:=encode(decode('1b401b61011d76300030000100'||repeat('00',48)||'1b64031d5601','hex'),'base64');
begin
  point:=public.fnb_print_manage_v1(branch,'save','{"name":"Quầy","enabled":true,"routes":[{"key":"kitchen","label":"Bếp","printer":"Kitchen printer","paper":"58mm"},{"key":"cashier","label":"Quầy","printer":"Bill printer","paper":"80mm"}]}'::jsonb);
  creds:=public.fnb_print_manage_v1(branch,'rotate','{}');
  if public.fnb_print_state_v1(branch)->'point' ? 'token_hash' then raise exception 'Credential exposed'; end if;
  perform set_config('test.permission','kitchen',false);
  begin perform public.fnb_print_manage_v1(branch,'rotate','{}'); raise exception 'Manager guard missing'; exception when insufficient_privilege then null; end;
  begin perform public.fnb_print_enqueue_v1(branch,job,'cashier','Bill','80mm',payload); raise exception 'Cashier guard missing'; exception when insufficient_privilege then null; end;
  perform public.fnb_print_enqueue_v1(branch,job,'kitchen','Bếp bàn 1','58mm',payload);
  perform public.fnb_print_enqueue_v1(branch,job,'kitchen','Bếp bàn 1','58mm',payload);
  if (select count(*) from fnb_print_jobs)<>1 then raise exception 'Idempotency broken'; end if;
  begin perform public.fnb_print_state_v1('20000000-0000-0000-0000-000000000002'); raise exception 'Branch guard missing'; exception when insufficient_privilege then null; end;
  begin perform public.fnb_print_agent_v1((creds->>'id')::uuid,repeat('0',64),'claim'); raise exception 'Token guard missing'; exception when insufficient_privilege then null; end;
  claimed:=public.fnb_print_agent_v1((creds->>'id')::uuid,creds->>'token','claim');
  if claimed->>'id'<>job::text or claimed->>'printer'<>'Kitchen printer' then raise exception 'Route snapshot wrong'; end if;
  if public.fnb_print_agent_v1((creds->>'id')::uuid,creds->>'token','claim') is not null then raise exception 'Claim duplicated'; end if;
  perform public.fnb_print_agent_v1((creds->>'id')::uuid,creds->>'token','finish',jsonb_build_object('id',job,'claim_id',claimed->>'claim_id','status','handed_off','message','Windows received'));
  if (select status from fnb_print_jobs where id=job)<>'handed_off' then raise exception 'Finish failed'; end if;
  perform public.fnb_print_enqueue_v1(branch,'40000000-0000-0000-0000-000000000002','kitchen','Bổ sung','58mm',payload);
  claimed:=public.fnb_print_agent_v1((creds->>'id')::uuid,creds->>'token','claim');
  update fnb_print_jobs set claimed_at=now()-interval '3 minutes' where id=(claimed->>'id')::uuid;
  if not exists(select 1 from jsonb_array_elements(public.fnb_print_state_v1(branch)->'jobs') j where j->>'id'=claimed->>'id' and j->>'status'='unknown') then raise exception 'Expired send hidden'; end if;
  if public.fnb_print_agent_v1((creds->>'id')::uuid,creds->>'token','claim') is not null then raise exception 'Ambiguous send retried'; end if;
  perform set_config('test.permission','manager',false);
  perform public.fnb_print_manage_v1(branch,'retry',jsonb_build_object('id',claimed->>'id'));
  if (select count(*) from fnb_print_jobs)<>3 then raise exception 'Reprint not audited'; end if;
  if not exists(select 1 from fnb_print_jobs where status='queued' and label like 'IN LẠI%') then raise exception 'Reprint not marked'; end if;
  point:=public.fnb_print_manage_v1(branch,'rotate','{}');
  begin perform public.fnb_print_agent_v1((creds->>'id')::uuid,creds->>'token','claim'); raise exception 'Rotated credential still valid'; exception when insufficient_privilege then null; end;
  update profiles set is_active=false;
  begin perform public.fnb_print_state_v1(branch); raise exception 'Inactive user allowed'; exception when insufficient_privilege then null; end;
end $$;
-- API roles cannot bypass the RPCs or inspect device secrets / print payloads.
set role authenticated;
do $$ begin begin perform * from public.fnb_print_points; raise exception 'Table exposed'; exception when insufficient_privilege then null; end; end $$;
reset role;
set role anon;
do $$ begin begin perform public.fnb_print_state_v1('20000000-0000-0000-0000-000000000001'); raise exception 'Anonymous business access'; exception when insufficient_privilege then null; end; end $$;
reset role;
select 'Branch print queue integration passed';
