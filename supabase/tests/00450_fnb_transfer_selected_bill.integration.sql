-- Disposable database only: real transfer function, synthetic scope and rows.
\set ON_ERROR_STOP on
begin;
create schema auth;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
end $$;
create function auth.uid() returns uuid language sql as $$
  select nullif(current_setting('test.actor', true), '')::uuid
$$;
create function public.user_has_permission(uuid, text) returns boolean language sql as $$
  select coalesce(current_setting('test.permission', true), 'true') = 'true'
$$;
create function public.user_has_branch_access(uuid, uuid) returns boolean language sql as $$
  select coalesce(current_setting('test.branch_access', true), 'true') = 'true'
$$;
create table public.profiles(id uuid primary key, tenant_id uuid, is_active boolean);
create table public.kitchen_orders(
  id uuid primary key, tenant_id uuid, branch_id uuid, table_id uuid,
  order_type text, status text, invoice_id uuid, original_table_id uuid,
  merged_into_id uuid, parent_order_id uuid, order_number text, updated_at timestamptz
);
create table public.restaurant_tables(
  id uuid primary key, tenant_id uuid, branch_id uuid, status text,
  current_order_id uuid, is_active boolean, table_number integer, name text,
  updated_at timestamptz
);
create table public.audit_log(
  tenant_id uuid, user_id uuid, action text, entity_type text, entity_id uuid,
  old_data jsonb, new_data jsonb
);
\ir ../migrations/00450_fnb_transfer_selected_bill.sql
insert into profiles values('10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',true);
insert into kitchen_orders(id,tenant_id,branch_id,table_id,order_type,status,order_number,parent_order_id) values
('10000000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000005','dine_in','served','TEST-A',null),
('10000000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000005','dine_in','served','TEST-B','10000000-0000-0000-0000-000000000010');
insert into restaurant_tables(id,tenant_id,branch_id,status,current_order_id,is_active,table_number,name) values
('10000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000003','occupied','10000000-0000-0000-0000-000000000010',true,9,'Test 9'),
('10000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000003','available',null,true,1,'Test 1');
select set_config('test.actor','10000000-0000-0000-0000-000000000001',true);
select fnb_transfer_table_atomic('10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000006');
do $$ begin
 if (select table_id from kitchen_orders where order_number='TEST-A') <> '10000000-0000-0000-0000-000000000005' then raise exception 'Sibling bill moved'; end if;
 if (select table_id from kitchen_orders where order_number='TEST-B') <> '10000000-0000-0000-0000-000000000006' then raise exception 'Selected bill did not move'; end if;
 if not exists(select 1 from restaurant_tables where table_number=9 and status='occupied' and current_order_id='10000000-0000-0000-0000-000000000010') then raise exception 'Source lost remaining bill'; end if;
 if not exists(select 1 from restaurant_tables where table_number=1 and status='occupied' and current_order_id='10000000-0000-0000-0000-000000000011') then raise exception 'Destination lost selected bill'; end if;
end $$;
rollback;
