\set ON_ERROR_STOP on
\ir 00437_customer_group_code_allocation.integration.sql
alter table profiles add column role text default 'owner';
alter table customers add column is_active boolean default true;
alter table customers add column customer_type text;
alter table customers add column updated_at timestamptz;
alter table customers add column debt numeric default 0;
create table audit_log(tenant_id uuid,user_id uuid,action text,entity_type text,entity_id uuid,old_data jsonb,new_data jsonb);
create function user_has_permission(uuid,text) returns boolean language sql as $$
  select coalesce(current_setting('test.allow',true),'true')='true'
$$;
\ir ../migrations/00307_atomic_customer_code_change.sql
\ir ../migrations/00537_walk_in_customer_identity.sql
create table test_invoices(customer_id uuid references customers(id),total numeric,paid numeric);
insert into test_invoices select id,205000,0 from customers where code='KL-VL';
update customers set debt=205000 where code='KL-VL';

do $$ declare v_id uuid; v_result jsonb; v_code text; v_count bigint; v_audits bigint; begin
  select id into v_id from customers where code='KL-VL';
  select count(*) into v_count from customers;
  v_result:=get_or_create_walk_in_customer();
  if (v_result->>'id')::uuid<>v_id or not (v_result->>'is_walk_in')::boolean then raise exception 'legacy identity not adopted'; end if;
  v_result:=standardize_walk_in_customer_code(v_id);
  v_code:=v_result->>'new_code';
  if v_code<>'KHA-KLE-003' then raise exception 'wrong next group code: %',v_code; end if;
  if (select count(*) from customers)<>v_count then raise exception 'customer duplicated'; end if;
  if (select debt from customers where id=v_id)<>205000 or (select customer_id from test_invoices)<>v_id then raise exception 'document/debt changed'; end if;
  if (select group_id from customers where id=v_id)<>'20000000-0000-0000-0000-000000000001'::uuid then raise exception 'wrong group'; end if;
  v_result:=get_or_create_walk_in_customer();
  if (v_result->>'id')::uuid<>v_id or v_result->>'code'<>v_code then raise exception 'lookup relies on legacy code'; end if;
  select count(*) into v_audits from audit_log;
  v_result:=standardize_walk_in_customer_code(v_id);
  if (v_result->>'changed')::boolean or (select count(*) from audit_log)<>v_audits then raise exception 'retry allocated another code'; end if;
  begin
    insert into customers(tenant_id,code,name) values('10000000-0000-0000-0000-000000000001','KL-VL','Khách lẻ');
    raise exception 'old client recreated walk-in';
  exception when sqlstate 'PT409' then null; end;
  begin
    perform change_customer_code_atomic(v_id,'OTHER');
    raise exception 'ordinary rename unlocked system customer';
  exception when insufficient_privilege then null; end;
  perform set_config('test.actor','00000000-0000-0000-0000-000000000002',true);
  begin
    perform standardize_walk_in_customer_code(v_id);
    raise exception 'cross-tenant action accepted';
  exception when sqlstate '22023' then null; end;
  perform set_config('test.actor','00000000-0000-0000-0000-000000000001',true);
  update profiles set role='employee' where id=auth.uid();
  perform set_config('test.allow','false',true);
  begin
    perform standardize_walk_in_customer_code(v_id);
    raise exception 'missing edit permission accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform get_or_create_walk_in_customer();
    raise exception 'missing checkout permission accepted';
  exception when insufficient_privilege then null; end;
end; $$;

-- New tenant: create through the group allocator, then always reuse the UUID.
insert into customer_groups(id,tenant_id,name,code) values
  ('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002','Retail 2','KLE');
select set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
do $$ declare a jsonb; b jsonb; begin
  a:=get_or_create_walk_in_customer(); b:=get_or_create_walk_in_customer();
  if a->>'code'<>'KHA-KLE-001' or a->>'id'<>b->>'id' then raise exception 'new singleton wrong'; end if;
end; $$;

grant usage on schema auth to authenticated;
grant select,update,insert on public.customers to authenticated;
set role authenticated;
do $$ begin
  begin
    update public.customers set is_walk_in=false where is_walk_in;
    raise exception 'direct identity edit accepted';
  exception when insufficient_privilege then null; end;
end; $$;
reset role;

create function public.test_concurrent_walk_in() returns uuid language plpgsql as $$ begin
  perform set_config('test.actor','00000000-0000-0000-0000-000000000001',true);
  perform set_config('test.allow','true',true);
  return (get_or_create_walk_in_customer()->>'id')::uuid;
end; $$;
