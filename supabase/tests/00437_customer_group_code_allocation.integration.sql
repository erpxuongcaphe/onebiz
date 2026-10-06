\set ON_ERROR_STOP on
create schema auth;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
end; $$;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
create table public.tenants(id uuid primary key);
create table public.profiles(id uuid primary key,tenant_id uuid,is_active boolean);
create table public.branches(id uuid primary key,tenant_id uuid,code text);
create table public.customer_groups(id uuid primary key,tenant_id uuid,name text,note text);
create table public.customers(id uuid primary key default gen_random_uuid(),tenant_id uuid,code text not null,name text check(name<>'FAIL'),group_id uuid,is_internal boolean default false,branch_id uuid,unique(tenant_id,code));
insert into public.tenants values('10000000-0000-0000-0000-000000000001'),('10000000-0000-0000-0000-000000000002');
insert into public.profiles values('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',true),('00000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002',true);
insert into public.customer_groups values('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Retail','KLE'),('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','Other tenant','KSI');
insert into public.branches values('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','XTB');
insert into public.customers(tenant_id,code,name) values('10000000-0000-0000-0000-000000000001','KHA-KLE-001','Historical'),('10000000-0000-0000-0000-000000000001','OLD-CODE','Ungrouped historical');
\ir ../migrations/00437_customer_group_code_allocation.sql
select set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
do $$ declare v_code text; v_counter bigint; begin
  if (select code from public.customer_groups where name='Retail')<>'KLE' then raise exception 'explicit prefix not migrated'; end if;
  if not exists(select 1 from public.customers where code='OLD-CODE' and group_id is null) then raise exception 'historical customer changed'; end if;
  insert into public.customers(tenant_id,code,name,group_id) values('10000000-0000-0000-0000-000000000001','CLIENT-CODE','New','20000000-0000-0000-0000-000000000001') returning code into v_code;
  if v_code<>'KHA-KLE-002' then raise exception 'collision not skipped or client code retained: %',v_code; end if;
  select next_value into v_counter from public.customer_group_code_counters;
  begin
    insert into public.customers(tenant_id,code,name,group_id) values('10000000-0000-0000-0000-000000000001','','FAIL','20000000-0000-0000-0000-000000000001');
    raise exception 'failed insert unexpectedly accepted';
  exception when check_violation then null; end;
  if (select next_value from public.customer_group_code_counters)<>v_counter then raise exception 'allocation not rolled back'; end if;
  begin
    insert into public.customers(tenant_id,code,name) values('10000000-0000-0000-0000-000000000001','','No group');
    raise exception 'missing group accepted';
  exception when sqlstate '22023' then null; end;
  begin
    insert into public.customers(tenant_id,code,name,group_id) values('10000000-0000-0000-0000-000000000001','','Wrong group','20000000-0000-0000-0000-000000000002');
    raise exception 'foreign group accepted';
  exception when sqlstate '22023' then null; end;
  begin
    insert into public.customers(tenant_id,code,name,group_id) values('10000000-0000-0000-0000-000000000002','','Wrong tenant','20000000-0000-0000-0000-000000000002');
    raise exception 'foreign tenant accepted';
  exception when insufficient_privilege then null; end;
  insert into public.customers(tenant_id,code,name) values('10000000-0000-0000-0000-000000000001','KL-VL','Khách lẻ');
  insert into public.customers(tenant_id,code,name,is_internal,branch_id) values('10000000-0000-0000-0000-000000000001','KH-NB-XTB','NB: XTB',true,'30000000-0000-0000-0000-000000000001');
  if has_table_privilege('authenticated','public.customer_group_code_counters','SELECT') or has_function_privilege('authenticated','public.assign_group_customer_code()','EXECUTE') then raise exception 'private allocator exposed'; end if;
end; $$;
create function public.test_concurrent_customer(p_name text) returns text language plpgsql as $$ declare v_code text; begin
  perform set_config('test.actor','00000000-0000-0000-0000-000000000001',true);
  insert into public.customers(tenant_id,code,name,group_id) values('10000000-0000-0000-0000-000000000001','',p_name,'20000000-0000-0000-0000-000000000001') returning code into v_code;
  return v_code;
end; $$;
