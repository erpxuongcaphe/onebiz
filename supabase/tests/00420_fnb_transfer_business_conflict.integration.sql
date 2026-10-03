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
  order_number text, updated_at timestamptz
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
\ir ../migrations/00321_harden_fnb_transfer_table.sql
create temporary table original_definition as
select pg_get_functiondef('public.fnb_transfer_table_atomic(uuid,uuid,uuid,uuid)'::regprocedure) as definition,
       proacl, proconfig, prosecdef
from pg_proc where oid='public.fnb_transfer_table_atomic(uuid,uuid,uuid,uuid)'::regprocedure;
\ir ../migrations/00420_fnb_transfer_business_conflict.sql
\ir ../migrations/00420_fnb_transfer_business_conflict.sql
do $$
declare v_original record; v_current record;
begin
  select * into v_original from original_definition;
  select pg_get_functiondef(oid) as definition, proacl, proconfig, prosecdef
  into v_current from pg_proc where oid='public.fnb_transfer_table_atomic(uuid,uuid,uuid,uuid)'::regprocedure;
  if v_current.definition <> replace(v_original.definition,
     'raise exception using errcode = ''40001'', message = ''FNB_TRANSFER_SOURCE_STALE'';',
     'raise exception using errcode = ''PT409'', message = ''FNB_TRANSFER_SOURCE_STALE'';')
     or v_current.proacl is distinct from v_original.proacl
     or v_current.proconfig is distinct from v_original.proconfig
     or v_current.prosecdef is distinct from v_original.prosecdef then
    raise exception 'Patch changed more than the two business SQLSTATEs';
  end if;
end $$;
insert into profiles values('10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',true);
insert into kitchen_orders(id,tenant_id,branch_id,table_id,order_type,status,order_number)
values('10000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000005','dine_in','pending','UAT-ONLY');
insert into restaurant_tables values
('10000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000003','occupied','10000000-0000-0000-0000-000000000004',true,1,'Test 1',null),
('10000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000003','available',null,true,2,'Test 2',null);
select set_config('test.actor','10000000-0000-0000-0000-000000000001',true);
do $$
declare
  v_tenant uuid := '10000000-0000-0000-0000-000000000002';
  v_order uuid := '10000000-0000-0000-0000-000000000004';
  v_from uuid := '10000000-0000-0000-0000-000000000005';
  v_to uuid := '10000000-0000-0000-0000-000000000006';
begin
  -- Wrong source reference must be a finite business conflict.
  begin
    perform public.fnb_transfer_table_atomic(v_tenant,v_order,v_to,v_from);
    raise exception 'Expected stale source rejection';
  exception when sqlstate 'PT409' then
    if sqlerrm <> 'FNB_TRANSFER_SOURCE_STALE' then raise; end if;
  end;
  -- A split child can reference a table owned by another order.
  update restaurant_tables set current_order_id='10000000-0000-0000-0000-000000000099' where id=v_from;
  begin
    perform public.fnb_transfer_table_atomic(v_tenant,v_order,v_from,v_to);
    raise exception 'Expected non-owner rejection';
  exception when sqlstate 'PT409' then
    if sqlerrm <> 'FNB_TRANSFER_SOURCE_STALE' then raise; end if;
  end;
  update restaurant_tables set current_order_id=v_order where id=v_from;
  perform set_config('test.permission','false',true);
  begin
    perform public.fnb_transfer_table_atomic(v_tenant,v_order,v_from,v_to);
    raise exception 'Expected permission rejection';
  exception when insufficient_privilege then
    if sqlerrm <> 'FNB_TRANSFER_PERMISSION_REQUIRED' then raise; end if;
  end;
  perform set_config('test.permission','true',true);
  perform set_config('test.branch_access','false',true);
  begin
    perform public.fnb_transfer_table_atomic(v_tenant,v_order,v_from,v_to);
    raise exception 'Expected branch rejection';
  exception when insufficient_privilege then
    if sqlerrm <> 'FNB_TRANSFER_BRANCH_DENIED' then raise; end if;
  end;
  perform set_config('test.branch_access','true',true);
  if exists(select 1 from audit_log) or exists(select 1 from kitchen_orders where table_id<>v_from)
     or exists(select 1 from restaurant_tables where id=v_to and current_order_id is not null) then
    raise exception 'Rejected transfer changed order/table/audit';
  end if;
  perform public.fnb_transfer_table_atomic(v_tenant,v_order,v_from,v_to);
  if not exists(select 1 from kitchen_orders where id=v_order and table_id=v_to and original_table_id=v_from)
     or not exists(select 1 from restaurant_tables where id=v_from and status='available' and current_order_id is null)
     or not exists(select 1 from restaurant_tables where id=v_to and status='occupied' and current_order_id=v_order)
     or (select count(*) from audit_log)<>1 then
    raise exception 'Valid transfer failed ownership/audit assertions';
  end if;
end $$;
rollback;
