\set ON_ERROR_STOP on
do $$ begin
  if current_database() <> 'kds_exact_return_test' or to_regclass('public.profiles') is not null then
    raise exception 'Requires fresh isolated kds_exact_return_test database';
  end if;
end $$;
create schema auth;
create schema extensions;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
end $$;
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.actor',true),'')::uuid; $$;
create function user_has_permission(uuid,text) returns boolean language sql as $$ select current_setting('test.permission',true)='true'; $$;
create function user_has_branch_access(uuid,uuid) returns boolean language sql as $$ select $2='00000000-0000-0000-0000-000000000003'::uuid; $$;
create table profiles(id uuid primary key, tenant_id uuid, is_active boolean);
create table invoices(id uuid primary key, tenant_id uuid, branch_id uuid, source text, status text);
create table invoice_items(id uuid primary key, invoice_id uuid, quantity numeric, returned_qty numeric);
create table kitchen_orders(id uuid primary key, invoice_id uuid, tenant_id uuid, branch_id uuid, status text, updated_at timestamptz);
create table kitchen_order_items(id uuid primary key, kitchen_order_id uuid, quantity numeric, cancelled_qty numeric,
  status text, started_at timestamptz, completed_at timestamptz);
create table fnb_invoice_kitchen_line_sources(invoice_item_id uuid primary key, kitchen_order_item_id uuid unique);
create table audit_log(tenant_id uuid,user_id uuid,action text,entity_type text,entity_id uuid,old_data jsonb,new_data jsonb);
-- Load the real KDS functions, rather than approximating their readiness behavior.
create function fnb_update_kitchen_item_status_v2(uuid,text) returns jsonb language sql as $$ select '{}'::jsonb; $$;
create function fnb_update_kitchen_order_status_v2(uuid,text) returns jsonb language sql as $$ select '{}'::jsonb; $$;
\ir ../migrations/00379_allow_paid_kitchen_orders_to_progress.sql
\ir ../migrations/00424_fnb_kds_exact_return_quantities.sql
insert into profiles values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002',true);
insert into invoices values
 ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','fnb','completed'),
 ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','pos','completed'),
 ('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000099','00000000-0000-0000-0000-000000000003','fnb','completed');
insert into kitchen_orders select id,id,tenant_id,branch_id,'pending','2000-01-01' from invoices;
insert into invoice_items values
 ('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000010',2,0),
 ('00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000010',2,0),
 ('00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000011',2,0),
 ('00000000-0000-0000-0000-000000000023','00000000-0000-0000-0000-000000000012',2,0);
insert into kitchen_order_items(id,kitchen_order_id,quantity,cancelled_qty,status)
 select id,invoice_id,quantity,0,'pending' from invoice_items;
insert into fnb_invoice_kitchen_line_sources select id,id from invoice_items;
select set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
select set_config('test.permission','true',false);
do $$ declare n integer; msg text; r record; before_state jsonb; begin
  select count(*) into n from fnb_kitchen_return_lines('00000000-0000-0000-0000-000000000003');
  if n<>2 then raise exception 'Tenant/Retail boundary failed'; end if;
  select jsonb_agg(to_jsonb(ii) order by id) into before_state from invoice_items ii;
  perform fnb_kitchen_return_lines('00000000-0000-0000-0000-000000000003');
  if before_state is distinct from (select jsonb_agg(to_jsonb(ii) order by id) from invoice_items ii) then
    raise exception 'Read changed invoice data'; end if;
  update invoice_items set returned_qty=1 where id='00000000-0000-0000-0000-000000000020';
  select * into r from fnb_kitchen_return_lines('00000000-0000-0000-0000-000000000003')
    where kitchen_order_item_id='00000000-0000-0000-0000-000000000020';
  if r.remaining_quantity<>1 or r.returned_quantity<>1 then raise exception 'Partial projection failed'; end if;
  if _fnb_kitchen_remaining_00424('00000000-0000-0000-0000-000000000021')<>2 then raise exception 'Sibling changed'; end if;
  if (select updated_at from kitchen_orders where id='00000000-0000-0000-0000-000000000010')='2000-01-01' then
    raise exception 'Partial return did not touch parent'; end if;
  update invoice_items set returned_qty=2 where id='00000000-0000-0000-0000-000000000020';
  begin perform fnb_update_kitchen_item_status_v2('00000000-0000-0000-0000-000000000020','ready');
  exception when others then msg:=sqlerrm; end;
  if msg is distinct from 'KITCHEN_ITEM_NO_REMAINING_QUANTITY' then raise exception 'Returned item mutable'; end if;
  perform fnb_update_kitchen_item_status_v2('00000000-0000-0000-0000-000000000021','ready');
  if (select status from kitchen_orders where id='00000000-0000-0000-0000-000000000010')<>'ready' then
    raise exception 'Returned line blocks ready status'; end if;
  perform fnb_update_kitchen_order_status_v2('00000000-0000-0000-0000-000000000010','served');
  if (select status from kitchen_order_items where id='00000000-0000-0000-0000-000000000020')<>'pending' then
    raise exception 'Return silently changed item status'; end if;
  update invoice_items set returned_qty=1 where id='00000000-0000-0000-0000-000000000022';
  if (select updated_at from kitchen_orders where id='00000000-0000-0000-0000-000000000011')<>'2000-01-01' then
    raise exception 'Retail parent touched'; end if;
  delete from fnb_invoice_kitchen_line_sources where invoice_item_id='00000000-0000-0000-0000-000000000020';
  if _fnb_kitchen_remaining_00424('00000000-0000-0000-0000-000000000020')<>2 then raise exception 'Legacy guessed'; end if;
  perform set_config('test.permission','false',false); msg:=null;
  begin perform fnb_kitchen_return_lines('00000000-0000-0000-0000-000000000003'); exception when others then msg:=sqlerrm; end;
  if msg is distinct from 'INSUFFICIENT_PERMISSION' then raise exception 'Permission bypass'; end if;
  perform set_config('test.permission','true',false); msg:=null;
  begin perform fnb_kitchen_return_lines('00000000-0000-0000-0000-000000000099'); exception when others then msg:=sqlerrm; end;
  if msg is distinct from 'BRANCH_ACCESS_DENIED' then raise exception 'Branch bypass'; end if;
  perform set_config('test.actor','',false); msg:=null;
  begin perform fnb_kitchen_return_lines('00000000-0000-0000-0000-000000000003'); exception when others then msg:=sqlerrm; end;
  if msg is distinct from 'UNAUTHENTICATED' then raise exception 'Anonymous bypass'; end if;
  if has_function_privilege('authenticated','_fnb_kitchen_remaining_00424(uuid)','EXECUTE')
    or has_function_privilege('anon','fnb_kitchen_return_lines(uuid)','EXECUTE')
    or has_function_privilege('authenticated','fnb_touch_kitchen_return_00424()','EXECUTE') then
    raise exception 'Private helper exposed'; end if;
end $$;
select 'KDS exact quantities, readiness, realtime touch and boundaries passed' as result;
