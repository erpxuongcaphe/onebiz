\set ON_ERROR_STOP on
do $$ begin
  if current_database()<>'fnb_modifier_order_test' or to_regclass('public.profiles') is not null then raise exception 'Fresh isolated fnb_modifier_order_test required'; end if;
end $$;
create schema auth;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
end $$;
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
create function user_has_permission(uuid,text) returns boolean language sql as $$select current_setting('test.permission',true)='edit'$$;
create table profiles(id uuid primary key,tenant_id uuid,is_active boolean);
create table products(id uuid primary key,tenant_id uuid,product_type text,channel text,price numeric);
create table categories(id uuid primary key,tenant_id uuid,scope text,channel text);
create table modifier_groups(id uuid primary key,tenant_id uuid,name text,sort_order integer,is_active boolean,channel text,rule text,updated_at timestamptz);
create table modifier_options(id uuid primary key,group_id uuid,label text,sort_order integer,is_active boolean,price_delta numeric,is_default boolean,scale_factor numeric);
create table product_modifier_groups(id uuid default gen_random_uuid() primary key,tenant_id uuid,product_id uuid,modifier_group_id uuid,sort_order integer,rule_override text,unique(product_id,modifier_group_id));
create table category_modifier_groups(id uuid default gen_random_uuid() primary key,tenant_id uuid,category_id uuid,modifier_group_id uuid,sort_order integer,unique(category_id,modifier_group_id));
insert into profiles values
('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002',true),
('00000000-0000-0000-0000-000000000090','00000000-0000-0000-0000-000000000002',false),
('00000000-0000-0000-0000-000000000099','00000000-0000-0000-0000-000000000098',true);
insert into products values
('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000002','sku','fnb',25000),
('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000002','sku','retail',35000),
('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000098','sku','fnb',45000);
insert into categories values
('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000002','sku','fnb'),
('00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000098','sku','fnb');
insert into modifier_groups values
('00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000002','Sugar',10,true,'fnb','single',now()),
('00000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000002','Ice',20,true,'all','single',now()),
('00000000-0000-0000-0000-000000000032','00000000-0000-0000-0000-000000000002','Disabled',30,false,'fnb','single',now()),
('00000000-0000-0000-0000-000000000033','00000000-0000-0000-0000-000000000098','Foreign',40,true,'fnb','single',now()),
('00000000-0000-0000-0000-000000000034','00000000-0000-0000-0000-000000000002','Retail',50,true,'retail','single',now());
insert into modifier_options values
('00000000-0000-0000-0000-000000000040','00000000-0000-0000-0000-000000000030','Normal',1,true,5000,true,1),
('00000000-0000-0000-0000-000000000041','00000000-0000-0000-0000-000000000030','Less',2,true,0,false,0.5),
('00000000-0000-0000-0000-000000000042','00000000-0000-0000-0000-000000000030','Disabled',7,false,0,false,0),
('00000000-0000-0000-0000-000000000043','00000000-0000-0000-0000-000000000033','Foreign',8,true,9999,true,1);
insert into product_modifier_groups(tenant_id,product_id,modifier_group_id,sort_order,rule_override) values
('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000030',8,'single_required');
insert into category_modifier_groups(tenant_id,category_id,modifier_group_id,sort_order) values
('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000030',5),
('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000031',9);
\ir ../migrations/00426_fnb_modifier_display_order.sql
\ir ../migrations/00426_fnb_modifier_display_order.sql
create function test_expect_error(statement text,wanted text) returns void language plpgsql as $$
declare got text;
begin
  begin execute statement; exception when others then got:=sqlerrm; end;
  if got is distinct from wanted then raise exception 'Expected %, got % for %',wanted,got,statement; end if;
end $$;
create function test_modifier_snapshot(kind text,parent uuid default null) returns jsonb language sql as $$
select case when kind='groups' then
 (select coalesce(jsonb_agg(jsonb_build_object('id',id,'sort_order',sort_order) order by id),'[]') from modifier_groups where tenant_id='00000000-0000-0000-0000-000000000002' and is_active)
else
 (select coalesce(jsonb_agg(jsonb_build_object('id',id,'sort_order',sort_order) order by id),'[]') from modifier_options where group_id=parent and is_active) end
$$;
select set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
select set_config('test.permission','edit',false);
do $$ declare
  g1 uuid:='00000000-0000-0000-0000-000000000030'; g2 uuid:='00000000-0000-0000-0000-000000000031';
  gr uuid:='00000000-0000-0000-0000-000000000034';
  p uuid:='00000000-0000-0000-0000-000000000010'; c uuid:='00000000-0000-0000-0000-000000000020';
  before_options jsonb; before_groups jsonb; snap jsonb; previous_link uuid;
begin
  if exists(select 1 from product_modifier_groups where use_common_order or sort_order<>8) or
     exists(select 1 from category_modifier_groups where use_common_order) then raise exception 'Migration changed business order'; end if;
  select id into previous_link from product_modifier_groups where product_id=p and modifier_group_id=g1;
  perform save_fnb_modifier_links_atomic('product',p,array[g2,g1],true);
  if not exists(select 1 from product_modifier_groups where id=previous_link and rule_override='single_required' and sort_order=1 and use_common_order) then raise exception 'Rule or identity lost'; end if;
  if (select price from products where id=p)<>25000 then raise exception 'Price changed'; end if;
  perform save_fnb_modifier_links_atomic('product',p,array[g1,g2],false);
  if not exists(select 1 from product_modifier_groups where modifier_group_id=g1 and sort_order=0 and not use_common_order) then raise exception 'Custom order not saved'; end if;
  perform save_fnb_modifier_links_atomic('category',c,array[g2,g1],true);
  if not exists(select 1 from category_modifier_groups where modifier_group_id=g2 and sort_order=0 and use_common_order) then raise exception 'Existing category rank not updated'; end if;
  perform test_expect_error(format('select save_fnb_modifier_links_atomic(''product'',%L,array[%L::uuid,%L::uuid],true)',p,g1,g1),'MODIFIER_ORDER_INVALID');
  perform test_expect_error(format('select save_fnb_modifier_links_atomic(''product'',%L,array[null::uuid],true)',p),'MODIFIER_ORDER_INVALID');
  foreach gr in array array['00000000-0000-0000-0000-000000000032','00000000-0000-0000-0000-000000000033','00000000-0000-0000-0000-000000000034']::uuid[] loop
    perform test_expect_error(format('select save_fnb_modifier_links_atomic(''product'',%L,array[%L::uuid],true)',p,gr),'MODIFIER_ORDER_GROUP_INVALID');
  end loop;
  perform test_expect_error('select save_fnb_modifier_links_atomic(''product'',''00000000-0000-0000-0000-000000000011'',array[]::uuid[],true)','MODIFIER_ORDER_TARGET_INVALID');
  perform test_expect_error('select save_fnb_modifier_links_atomic(''product'',''00000000-0000-0000-0000-000000000012'',array[]::uuid[],true)','MODIFIER_ORDER_TARGET_INVALID');
  perform test_expect_error('select save_fnb_modifier_links_atomic(''category'',''00000000-0000-0000-0000-000000000021'',array[]::uuid[],true)','MODIFIER_ORDER_TARGET_INVALID');
  gr:='00000000-0000-0000-0000-000000000034';
  select jsonb_agg(to_jsonb(o)-'sort_order' order by id) into before_options from modifier_options o;
  snap:=test_modifier_snapshot('options',g1);
  perform save_fnb_modifier_display_order_atomic('options',g1,array['00000000-0000-0000-0000-000000000041','00000000-0000-0000-0000-000000000040']::uuid[],snap);
  if before_options is distinct from (select jsonb_agg(to_jsonb(o)-'sort_order' order by id) from modifier_options o) then raise exception 'Defaults or prices changed'; end if;
  if (select sort_order from modifier_options where id='00000000-0000-0000-0000-000000000042')<>7 or
     (select sort_order from modifier_options where id='00000000-0000-0000-0000-000000000043')<>8 then raise exception 'Option boundary violated'; end if;
  perform test_expect_error(format('select save_fnb_modifier_display_order_atomic(''options'',%L,array[]::uuid[],%L::jsonb)',g1,snap),'MODIFIER_ORDER_CONFLICT');
  snap:=test_modifier_snapshot('groups');
  select jsonb_agg(to_jsonb(g)-'sort_order'-'updated_at' order by id) into before_groups from modifier_groups g;
  perform save_fnb_modifier_display_order_atomic('groups',null,array[g2,g1,gr],snap);
  if before_groups is distinct from (select jsonb_agg(to_jsonb(g)-'sort_order'-'updated_at' order by id) from modifier_groups g) then raise exception 'Group rules changed'; end if;
  if (select sort_order from modifier_groups where name='Foreign')<>40 or (select sort_order from modifier_groups where name='Disabled')<>30 then raise exception 'Group boundary violated'; end if;
  snap:=test_modifier_snapshot('groups');
  perform test_expect_error(format('select save_fnb_modifier_display_order_atomic(''groups'',null,array[%L::uuid,%L::uuid,%L::uuid],%L::jsonb)',g1,g1,gr,snap),'MODIFIER_ORDER_INVALID');
  perform test_expect_error(format('select save_fnb_modifier_display_order_atomic(''groups'',null,array[%L::uuid,null::uuid,%L::uuid],%L::jsonb)',g1,gr,snap),'MODIFIER_ORDER_INVALID');
  perform test_expect_error(format('select save_fnb_modifier_display_order_atomic(''groups'',null,array[%L::uuid,%L::uuid,''00000000-0000-0000-0000-000000000033''::uuid],%L::jsonb)',g1,g2,snap),'MODIFIER_ORDER_INVALID');
  perform set_config('test.permission','none',false);
  perform test_expect_error(format('select save_fnb_modifier_links_atomic(''product'',%L,array[]::uuid[],true)',p),'MODIFIER_ORDER_PERMISSION_DENIED');
  perform test_expect_error(format('select save_fnb_modifier_display_order_atomic(''groups'',null,array[]::uuid[],%L::jsonb)',snap),'MODIFIER_ORDER_PERMISSION_DENIED');
  perform set_config('test.permission','edit',false);
  perform set_config('test.actor','00000000-0000-0000-0000-000000000090',false);
  perform test_expect_error(format('select save_fnb_modifier_links_atomic(''product'',%L,array[]::uuid[],true)',p),'MODIFIER_ORDER_PERMISSION_DENIED');
  perform set_config('test.actor','00000000-0000-0000-0000-000000000099',false);
  perform test_expect_error(format('select save_fnb_modifier_links_atomic(''product'',%L,array[]::uuid[],true)',p),'MODIFIER_ORDER_TARGET_INVALID');
  perform test_expect_error(format('select save_fnb_modifier_display_order_atomic(''options'',%L,array[]::uuid[],''[]''::jsonb)',g1),'MODIFIER_ORDER_GROUP_INVALID');
  perform set_config('test.actor','',false);
  perform test_expect_error(format('select save_fnb_modifier_links_atomic(''product'',%L,array[]::uuid[],true)',p),'AUTH_REQUIRED');
  perform set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
  perform save_fnb_modifier_links_atomic('product',p,'{}',true);
  if exists(select 1 from product_modifier_groups where product_id=p) then raise exception 'Clear did not restore category inheritance'; end if;
  if has_function_privilege('anon','public.save_fnb_modifier_links_atomic(text,uuid,uuid[],boolean)','execute') or
     has_function_privilege('anon','public.save_fnb_modifier_display_order_atomic(text,uuid,uuid[],jsonb)','execute') then raise exception 'Anonymous ACL violated'; end if;
  if not has_function_privilege('authenticated','public.save_fnb_modifier_links_atomic(text,uuid,uuid[],boolean)','execute') then raise exception 'Authenticated ACL missing'; end if;
  raise notice 'FNB_MODIFIER_ORDER_INTEGRATION_PASS';
end $$;
