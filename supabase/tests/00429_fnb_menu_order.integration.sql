\set ON_ERROR_STOP on
do $$ begin
  if current_database() <> 'fnb_menu_order_test' or to_regclass('public.profiles') is not null then
    raise exception 'Requires a fresh isolated fnb_menu_order_test database';
  end if;
end $$;
create schema auth;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
end $$;
create function auth.uid() returns uuid language sql as $$
  select nullif(current_setting('test.actor', true),'')::uuid;
$$;
create table profiles(id uuid primary key, tenant_id uuid, is_active boolean);
create table categories(id uuid primary key,tenant_id uuid,name text,scope text,sort_order integer);
create table products(id uuid primary key,tenant_id uuid,name text,category_id uuid,channel text,
  product_type text,is_active boolean,allow_sale boolean,sort_order integer,price numeric);
create function user_has_permission(uuid,text) returns boolean language sql as $$
  select current_setting('test.permission',true)='edit'
    or (current_setting('test.permission',true)='send' and $2='pos_fnb.send_kitchen');
$$;
insert into profiles values
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002',true),
 ('00000000-0000-0000-0000-000000000090','00000000-0000-0000-0000-000000000002',false),
 ('00000000-0000-0000-0000-000000000099','00000000-0000-0000-0000-000000000098',true);
insert into categories values
 ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000002','Coffee','sku',0),
 ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000002','Tea','sku',0),
 ('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000098','Foreign','sku',7);
insert into products values
 ('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000002','Coffee A','00000000-0000-0000-0000-000000000010','fnb','sku',true,true,0,30000),
 ('00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000002','Coffee B','00000000-0000-0000-0000-000000000010','fnb','sku',true,true,0,40000),
 ('00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000002','Tea A','00000000-0000-0000-0000-000000000011','fnb','sku',true,true,0,35000),
 ('00000000-0000-0000-0000-000000000023','00000000-0000-0000-0000-000000000002','Retail','00000000-0000-0000-0000-000000000010','retail','sku',true,true,7,50000),
 ('00000000-0000-0000-0000-000000000024','00000000-0000-0000-0000-000000000098','Foreign','00000000-0000-0000-0000-000000000012','fnb','sku',true,true,7,60000),
 ('00000000-0000-0000-0000-000000000025','00000000-0000-0000-0000-000000000002','Inactive','00000000-0000-0000-0000-000000000010','fnb','sku',false,true,7,70000);
\ir ../migrations/00424_fnb_menu_display_order.sql
\ir ../migrations/00424_fnb_menu_display_order.sql
create function test_menu_snapshot() returns jsonb language sql as $$
 select jsonb_build_object(
  'categories',(select jsonb_agg(jsonb_build_object('id',id,'name',name,'sort_order',sort_order) order by id)
    from categories where tenant_id='00000000-0000-0000-0000-000000000002'),
  'products',(select jsonb_agg(jsonb_build_object('id',id,'name',name,'sort_order',sort_order,'category_id',category_id) order by id)
    from products where tenant_id='00000000-0000-0000-0000-000000000002' and channel='fnb' and is_active));
$$;
select set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
select set_config('test.permission','edit',false);
do $$ declare
 original jsonb:=test_menu_snapshot(); revision text; msg text; unchanged jsonb; after_state jsonb;
 cats uuid[]:=array['00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000010']::uuid[];
 items uuid[]:=array['00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000020']::uuid[];
begin
 select jsonb_agg(to_jsonb(p)-'sort_order' order by id) into unchanged from products p;
 revision:=get_fnb_menu_order_revision();
 perform save_fnb_menu_order_atomic(original,cats,items);
 if (select sort_order from products where name='Coffee B')<>1 or
    (select sort_order from products where name='Coffee A')<>2 or
    (select sort_order from products where name='Tea A')<>1 then raise exception 'Per-category ranking failed'; end if;
 if (select sort_order from categories where name='Tea')<>1 then raise exception 'Category ranking failed'; end if;
 if revision=get_fnb_menu_order_revision() then raise exception 'Revision did not change'; end if;
 if exists(select 1 from products where name in ('Retail','Foreign','Inactive') and sort_order<>7) then raise exception 'Boundary changed'; end if;
 select jsonb_agg(to_jsonb(p)-'sort_order' order by id) into after_state from products p;
 if unchanged is distinct from after_state then raise exception 'Non-order product data changed'; end if;
 msg:=null;
 begin perform save_fnb_menu_order_atomic(original,cats,items); exception when others then msg:=sqlerrm; end;
 if msg is distinct from 'MENU_ORDER_CONFLICT' then raise exception 'Stale edit accepted: %',msg; end if;
 original:=test_menu_snapshot();
 msg:=null;
 begin perform save_fnb_menu_order_atomic(original,cats,array[items[1],items[1],items[3]]); exception when others then msg:=sqlerrm; end;
 if msg is distinct from 'MENU_ORDER_INVALID' then raise exception 'Duplicate input accepted: %',msg; end if;
 msg:=null;
 begin perform save_fnb_menu_order_atomic(original,cats,array[items[1],null,items[3]]); exception when others then msg:=sqlerrm; end;
 if msg is distinct from 'MENU_ORDER_INVALID' then raise exception 'Null input accepted: %',msg; end if;
 msg:=null;
 begin perform save_fnb_menu_order_atomic(original,cats,array[items[1],items[2],'00000000-0000-0000-0000-000000000024'::uuid]); exception when others then msg:=sqlerrm; end;
 if msg is distinct from 'MENU_ORDER_CONFLICT' then raise exception 'Foreign product accepted: %',msg; end if;
 perform set_config('test.permission','send',false);
 perform get_fnb_menu_order_revision();
 msg:=null;
 begin perform save_fnb_menu_order_atomic(original,cats,items); exception when others then msg:=sqlerrm; end;
 if msg is distinct from 'MENU_ORDER_PERMISSION_DENIED' then raise exception 'Send-only edited: %',msg; end if;
 perform set_config('test.permission','none',false); msg:=null;
 begin perform get_fnb_menu_order_revision(); exception when others then msg:=sqlerrm; end;
 if msg is distinct from 'MENU_ORDER_PERMISSION_DENIED' then raise exception 'Read ACL failed: %',msg; end if;
 perform set_config('test.permission','edit',false);
 perform set_config('test.actor','00000000-0000-0000-0000-000000000090',false); msg:=null;
 begin perform save_fnb_menu_order_atomic(original,cats,items); exception when others then msg:=sqlerrm; end;
 if msg is distinct from 'MENU_ORDER_PERMISSION_DENIED' then raise exception 'Inactive actor accepted: %',msg; end if;
 perform set_config('test.actor','00000000-0000-0000-0000-000000000099',false); msg:=null;
 begin perform save_fnb_menu_order_atomic(original,cats,items); exception when others then msg:=sqlerrm; end;
 if msg is distinct from 'MENU_ORDER_CONFLICT' then raise exception 'Tenant boundary accepted: %',msg; end if;
 perform set_config('test.actor','',false); msg:=null;
 begin perform save_fnb_menu_order_atomic(original,cats,items); exception when others then msg:=sqlerrm; end;
 if msg is distinct from 'AUTH_REQUIRED' then raise exception 'Anonymous actor accepted: %',msg; end if;
 if has_function_privilege('anon','save_fnb_menu_order_atomic(jsonb,uuid[],uuid[])','EXECUTE')
    or has_function_privilege('anon','get_fnb_menu_order_revision()','EXECUTE') then raise exception 'Anon grant leaked'; end if;
end $$;
select set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
select set_config('test.permission','edit',false);
select test_menu_snapshot() as original \gset
set role authenticated;
select get_fnb_menu_order_revision();
select save_fnb_menu_order_atomic(
 :'original'::jsonb,
 array['00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000010']::uuid[],
 array['00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000020']::uuid[]);
reset role;
\echo FNB_MENU_ORDER_INTEGRATION_PASS
