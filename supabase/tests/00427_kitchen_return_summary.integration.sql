\set ON_ERROR_STOP on
do $$ begin
  if current_database() <> 'kitchen_return_summary_test' or to_regclass('public.profiles') is not null then
    raise exception 'Requires a fresh isolated kitchen_return_summary_test database';
  end if;
end $$;
create schema auth;
create schema extensions;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
end $$;
create function auth.uid() returns uuid language sql as $$
  select nullif(current_setting('test.actor', true), '')::uuid;
$$;
create table profiles(id uuid primary key, tenant_id uuid, is_active boolean);
create table kitchen_orders(id uuid primary key, invoice_id uuid, tenant_id uuid, branch_id uuid, status text);
create table invoices(id uuid primary key, tenant_id uuid, branch_id uuid, source text, status text);
create table invoice_items(id uuid primary key, invoice_id uuid, quantity numeric, returned_qty numeric);
create function user_has_permission(uuid,text) returns boolean language sql as $$
  select coalesce(current_setting('test.permission', true), '') = 'true';
$$;
create function user_has_branch_access(uuid,uuid) returns boolean language sql as $$
  select $2 = '00000000-0000-0000-0000-000000000003'::uuid;
$$;
insert into profiles values ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002',true);
insert into invoices values
 ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','fnb','completed'),
 ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','pos','completed'),
 ('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000099','00000000-0000-0000-0000-000000000003','fnb','completed');
insert into kitchen_orders select id, id, tenant_id, branch_id, 'preparing' from invoices;
insert into invoice_items values
 ('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000010',2,1),
 ('00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000010',1,0),
 ('00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000011',7,3),
 ('00000000-0000-0000-0000-000000000023','00000000-0000-0000-0000-000000000012',9,4);
\ir ../migrations/00422_fnb_kitchen_return_summary.sql
select set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
select set_config('test.permission','true',false);
do $$ declare r record; n integer; msg text; before_state jsonb; after_state jsonb; begin
  select jsonb_agg(to_jsonb(ii) order by id) into before_state from invoice_items ii;
  select count(*) into n from fnb_kitchen_return_summary('00000000-0000-0000-0000-000000000003');
  if n <> 1 then raise exception 'Tenant/Retail boundary failed'; end if;
  select * into r from fnb_kitchen_return_summary('00000000-0000-0000-0000-000000000003');
  if r.sold_quantity <> 3 or r.returned_quantity <> 1 then raise exception 'Partial count mismatch'; end if;
  select jsonb_agg(to_jsonb(ii) order by id) into after_state from invoice_items ii;
  if before_state is distinct from after_state then raise exception 'Read changed invoice lines'; end if;
  update invoice_items set returned_qty=quantity where invoice_id='00000000-0000-0000-0000-000000000010';
  select * into r from fnb_kitchen_return_summary('00000000-0000-0000-0000-000000000003');
  if r.returned_quantity <> 3 then raise exception 'Full return count mismatch'; end if;
  update kitchen_orders set status='cancelled' where id='00000000-0000-0000-0000-000000000010';
  select count(*) into n from fnb_kitchen_return_summary('00000000-0000-0000-0000-000000000003');
  if n <> 0 then raise exception 'Cancelled order remained visible'; end if;
  update kitchen_orders set status='preparing' where id='00000000-0000-0000-0000-000000000010';
  update invoice_items set returned_qty=0 where invoice_id='00000000-0000-0000-0000-000000000010';
  select count(*) into n from fnb_kitchen_return_summary('00000000-0000-0000-0000-000000000003');
  if n <> 0 then raise exception 'No-return order generated warning'; end if;
  perform set_config('test.permission','false',false);
  begin perform fnb_kitchen_return_summary('00000000-0000-0000-0000-000000000003');
  exception when others then msg:=sqlerrm; end;
  if msg is distinct from 'INSUFFICIENT_PERMISSION' then raise exception 'Permission guard failed'; end if;
  perform set_config('test.permission','true',false); msg:=null;
  begin perform fnb_kitchen_return_summary('00000000-0000-0000-0000-000000000004');
  exception when others then msg:=sqlerrm; end;
  if msg is distinct from 'BRANCH_ACCESS_DENIED' then raise exception 'Branch guard failed'; end if;
  update profiles set is_active=false; msg:=null;
  begin perform fnb_kitchen_return_summary('00000000-0000-0000-0000-000000000003');
  exception when others then msg:=sqlerrm; end;
  if msg is distinct from 'ACTIVE_PROFILE_REQUIRED' then raise exception 'Inactive profile allowed'; end if;
  perform set_config('test.actor','',false); msg:=null;
  begin perform fnb_kitchen_return_summary('00000000-0000-0000-0000-000000000003');
  exception when others then msg:=sqlerrm; end;
  if msg is distinct from 'UNAUTHENTICATED' then raise exception 'Auth guard failed'; end if;
end $$;
