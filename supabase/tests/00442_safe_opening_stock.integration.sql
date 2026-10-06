-- Disposable database only. Exercises the real migration and real stock/cost helpers.
\set ON_ERROR_STOP on
select 'create role anon nologin' where not exists(select 1 from pg_roles where rolname='anon') \gexec
select 'create role authenticated nologin' where not exists(select 1 from pg_roles where rolname='authenticated') \gexec
create schema auth;
create schema extensions;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table tenants(id uuid primary key);
create table profiles(id uuid primary key,tenant_id uuid,is_active boolean default true);
create table branches(id uuid primary key,tenant_id uuid,code text,cascade_mode text);
create table products(id uuid primary key,tenant_id uuid,code text,name text,unit text,stock numeric default 0,cost_price numeric default 0,
 product_type text,channel text,has_bom boolean default false,inventory_role text,updated_at timestamptz default now());
create table branch_stock(tenant_id uuid,branch_id uuid,product_id uuid,variant_id uuid,quantity numeric,reserved numeric default 0,updated_at timestamptz default now());
create unique index branch_stock_base_unique on branch_stock(tenant_id,branch_id,product_id) where variant_id is null;
create table stock_movements(id uuid primary key default gen_random_uuid(),tenant_id uuid,branch_id uuid,product_id uuid,type text,quantity numeric,unit_cost numeric,
reference_type text,reference_id uuid,note text,created_by uuid,created_at timestamptz default now());
create table fnb_supply_branch_scopes(tenant_id uuid,branch_id uuid,enforcement_enabled boolean);
create table fnb_branch_product_cost_balances(tenant_id uuid,branch_id uuid,product_id uuid,costed_quantity numeric default 0,total_cost numeric default 0,
unit_cost numeric default 0,opening_cost_confirmed boolean default false,updated_by uuid,updated_at timestamptz default now(),primary key(tenant_id,branch_id,product_id));
create table fnb_branch_product_cost_events(id uuid primary key default gen_random_uuid(),tenant_id uuid,branch_id uuid,product_id uuid,direction text,source_type text,
source_reference_type text,source_reference_id uuid,source_stock_movement_id uuid,quantity numeric,unit_cost numeric,total_cost numeric,note text,created_by uuid,created_at timestamptz default now());
create unique index cost_movement_unique on fnb_branch_product_cost_events(source_stock_movement_id) where source_stock_movement_id is not null;
create table audit_log(tenant_id uuid,user_id uuid,action text,entity_type text,entity_id uuid,new_data jsonb);
create table product_lots(tenant_id uuid,branch_id uuid,product_id uuid,variant_id uuid,lot_number text,source_type text,received_date date,
 expiry_date date,initial_qty numeric,current_qty numeric,status text,note text);
create function user_has_permission(uuid,text) returns boolean language sql stable as $$ select coalesce(current_setting('test.denied',true),'')<>'yes' $$;
create function user_has_branch_access(uuid,uuid) returns boolean language sql stable as $$select coalesce(current_setting('test.denied_branch',true),'')<>'yes' and exists(select 1 from branches b join profiles p on p.tenant_id=b.tenant_id where b.id=$2 and p.id=$1)$$;
create function get_tenant_setting(uuid,text,jsonb) returns jsonb language sql stable as $$select $3$$;
-- The production wrapper is extracted verbatim; its delegated implementation
-- is inert here so we can prove only opening resets are rejected by the guard.
create function _apply_manual_stock_movement_auth_impl_00246(uuid,uuid,uuid,jsonb) returns jsonb language sql as $$select '{"ok":true}'::jsonb$$;
create function _reconcile_product_lots_to_branch_00284(uuid,uuid,uuid,text,uuid,uuid,text) returns void language plpgsql as $$begin return;end$$;
\i /tmp/opening-stock-helpers.sql
\ir ../migrations/00442_safe_opening_stock_batches.sql
\ir ../migrations/00443_opening_stock_history_and_business_date.sql

insert into tenants values('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
insert into profiles values('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000010',false);
do $$begin
 begin
  perform apply_manual_stock_movement_atomic(null,null,null,'[{"reference_type":"initial_stock_reset"}]');
  raise exception 'LEGACY_RESET_NOT_BLOCKED';
 exception when others then if sqlerrm not like '%OPENING_WORKFLOW_REQUIRED%' then raise;end if;end;
 if apply_manual_stock_movement_atomic(null,null,null,'[]')->>'ok'<>'true' then raise exception 'REGULAR_ADJUSTMENT_CHANGED';end if;
end$$;
insert into branches values('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001','QUAN','outlet');
insert into fnb_supply_branch_scopes values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000020',true);
insert into products(id,tenant_id,code,name,unit,cost_price,product_type,channel,inventory_role) values
('00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000001','SUA','Sữa','Chai',999,'sku','retail','stockable'),
('00000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000001','TRA','Trà','G',777,'sku','retail','stockable'),
('00000000-0000-0000-0000-000000000032','00000000-0000-0000-0000-000000000001','MENU','Món','Ly',888,'sku','fnb','fnb_menu_item');

set timezone='Pacific/Kiritimati';
do $$declare r jsonb; p jsonb; result jsonb; source_at timestamptz:=now(); begin
 r:=jsonb_build_array(jsonb_build_object('productCode','SUA','branchCode','QUAN','quantity',10,'costPrice',25,'unit','Chai','expiryDate',(now() at time zone 'Asia/Ho_Chi_Minh')::date));
 p:=preview_inventory_opening_00442(r);
 result:=commit_inventory_opening_00442('00000000-0000-0000-0000-000000000050',r,p,'migration',source_at,'Chuyển phần mềm','ton.xlsx');
 if (select quantity from branch_stock where product_id='00000000-0000-0000-0000-000000000030')<>10 then raise exception 'QUANTITY_FAILED';end if;
 if (select total_cost from fnb_branch_product_cost_balances where product_id='00000000-0000-0000-0000-000000000030')<>250 then raise exception 'VALUE_FAILED';end if;
 if (select current_qty from product_lots where product_id='00000000-0000-0000-0000-000000000030')<>10 then raise exception 'LOT_FAILED';end if;
 if not exists(select 1 from product_lots where product_id='00000000-0000-0000-0000-000000000030'
  and received_date=(now() at time zone 'Asia/Ho_Chi_Minh')::date and status='active') then raise exception 'BUSINESS_DATE_FAILED';end if;
 if (select cost_price from products where code='SUA')<>999 then raise exception 'RETAIL_CHANGED';end if;
 result:=commit_inventory_opening_00442('00000000-0000-0000-0000-000000000050',r,p,'migration',source_at,'Chuyển phần mềm','ton.xlsx');
 if not (result->>'replayed')::boolean or (select count(*) from stock_movements)<>1 then raise exception 'REPLAY_DUPLICATED';end if;
 begin
   perform commit_inventory_opening_00442('00000000-0000-0000-0000-000000000050',r,p,'migration',source_at,'Khác','ton.xlsx');
   raise exception 'REPLAY_MUST_REJECT';
 exception when others then if sqlerrm not like '%OPENING_REPLAY_CONFLICT%' then raise;end if;end;
 r:='[{"productCode":"TRA","branchCode":"QUAN","quantity":20,"costPrice":2}]';p:=preview_inventory_opening_00442(r);
 insert into stock_movements(tenant_id,branch_id,product_id,type,quantity,reference_type) values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000031','in',0,'initial_stock_reset');
 begin
   perform commit_inventory_opening_00442(gen_random_uuid(),r,p,'migration',source_at,'Nguồn','ton.xlsx');raise exception 'STALE_MUST_REJECT';
 exception when others then if sqlerrm not like '%OPENING_PREVIEW_CHANGED%' then raise;end if;end;
 if exists(select 1 from branch_stock where product_id='00000000-0000-0000-0000-000000000031') then raise exception 'STALE_MUTATED';end if;
 begin
   perform preview_inventory_opening_00442('[{"productCode":"MENU","branchCode":"QUAN","quantity":1,"costPrice":1}]');raise exception 'MENU_MUST_REJECT';
 exception when others then if sqlerrm not like '%OPENING_STOCK_COMPONENT_REQUIRED%' then raise;end if;end;
 begin
   perform preview_inventory_opening_00442('[{"productCode":"TRA","branchCode":"QUAN","quantity":1,"costPrice":1,"unit":"Kg"}]');raise exception 'UNIT_MUST_REJECT';
 exception when others then if sqlerrm not like '%OPENING_UNIT_MISMATCH%' then raise;end if;end;
 perform set_config('test.denied','yes',true);
 begin perform preview_inventory_opening_00442(r);raise exception 'PERMISSION_MUST_REJECT';
 exception when others then if sqlerrm not like '%OPENING_PERMISSION_DENIED%' then raise;end if;end;
 perform set_config('test.denied','no',true);
end $$;

-- A real server failure on the second line must undo the first line as well.
create function fail_test_product() returns trigger language plpgsql as $$ begin
 if new.product_id='00000000-0000-0000-0000-000000000031' then raise exception 'TEST_SECOND_ROW_FAILED';end if;return new;end $$;
create trigger fail_second before insert on stock_movements for each row execute function fail_test_product();
insert into products(id,tenant_id,code,name,unit,product_type,channel) values('00000000-0000-0000-0000-000000000033','00000000-0000-0000-0000-000000000001','CAFE','Cà phê','G','sku','retail');
do $$declare r jsonb; p jsonb; before_batches int; begin
 r:='[{"productCode":"CAFE","branchCode":"QUAN","quantity":5,"costPrice":3},{"productCode":"TRA","branchCode":"QUAN","quantity":6,"costPrice":4}]';p:=preview_inventory_opening_00442(r);
 select count(*) into before_batches from inventory_opening_batches;
 begin perform commit_inventory_opening_00442(gen_random_uuid(),r,p,'new_branch',now(),'Thử rollback','test.xlsx');raise exception 'MUST_FAIL';
 exception when others then if sqlerrm not like '%TEST_SECOND_ROW_FAILED%' then raise;end if;end;
 if (select stock from products where code='CAFE')<>0 or exists(select 1 from branch_stock where product_id='00000000-0000-0000-0000-000000000033')
 or exists(select 1 from fnb_branch_product_cost_events where product_id='00000000-0000-0000-0000-000000000033')
 or exists(select 1 from product_lots where product_id='00000000-0000-0000-0000-000000000033')
 or (select count(*) from inventory_opening_batches)<>before_batches then raise exception 'BATCH_NOT_ATOMIC';end if;
end $$;
drop trigger fail_second on stock_movements;
-- Existing unvalued stock: value only, quantity unchanged.
insert into branch_stock(tenant_id,branch_id,product_id,quantity) values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000033',5);
update products set stock=5 where code='CAFE';
do $$declare r jsonb; p jsonb; before_moves int;begin
 r:='[{"productCode":"CAFE","branchCode":"QUAN","quantity":5,"costPrice":3}]';p:=preview_inventory_opening_00442(r);select count(*) into before_moves from stock_movements;
 perform commit_inventory_opening_00442(gen_random_uuid(),r,p,'opening_cost',now(),'Bổ sung giá trị','gia.xlsx');
 if (select count(*) from stock_movements)<>before_moves or (select stock from products where code='CAFE')<>5
 or (select total_cost from fnb_branch_product_cost_balances where product_id='00000000-0000-0000-0000-000000000033')<>15 then raise exception 'VALUE_ONLY_FAILED';end if;
end $$;

-- Legacy records with no reference type still count as operational history.
insert into products(id,tenant_id,code,name,unit,product_type,channel) values
 ('00000000-0000-0000-0000-000000000034','00000000-0000-0000-0000-000000000001','OLD','Hàng cũ','G','sku','retail');
insert into stock_movements(tenant_id,branch_id,product_id,type,quantity,reference_type) values
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000034','out',1,null);
do $$begin
 begin perform preview_inventory_opening_00442('[{"productCode":"OLD","branchCode":"QUAN","quantity":1,"costPrice":2}]');raise exception 'UNKNOWN_HISTORY_MUST_REJECT';
 exception when others then if sqlerrm not like '%OPENING_USE_STOCKTAKE%' then raise;end if;end;
 perform set_config('test.denied_branch','yes',true);
 begin perform preview_inventory_opening_00442('[{"productCode":"SUA","branchCode":"QUAN","quantity":10,"costPrice":25}]');raise exception 'BRANCH_MUST_REJECT';
 exception when others then if sqlerrm not like '%OPENING_BRANCH_DENIED%' then raise;end if;end;
 perform set_config('test.denied_branch','no',true);
 begin perform preview_inventory_opening_00442('[{"productCode":"SUA","branchCode":"QUAN","quantity":10,"costPrice":25},{"productCode":"SUA","branchCode":"QUAN","quantity":10,"costPrice":25}]');raise exception 'DUPLICATE_MUST_REJECT';
 exception when others then if sqlerrm not like '%OPENING_DUPLICATE_PRODUCT%' then raise;end if;end;
end$$;

-- Exercise the actual RLS policy as authenticated, not as the schema owner.
insert into profiles values
 ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000002',true),
 ('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000001',false);
grant usage on schema auth to authenticated;
grant select on profiles,branches to authenticated;
set role authenticated;
do $$begin
 if (select count(*) from inventory_opening_batches)<>2 then raise exception 'OWN_HISTORY_NOT_VISIBLE';end if;
 perform set_config('test.denied_branch','yes',true);
 if exists(select 1 from inventory_opening_batches) then raise exception 'BRANCH_HISTORY_EXPOSED';end if;
 perform set_config('test.denied_branch','no',true);
 perform set_config('test.denied','yes',true);
 if exists(select 1 from inventory_opening_batches) then raise exception 'UNAUTHORIZED_HISTORY_EXPOSED';end if;
 perform set_config('test.denied','no',true);
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000011',true);
 if exists(select 1 from inventory_opening_batches) then raise exception 'OTHER_TENANT_HISTORY_EXPOSED';end if;
 begin perform preview_inventory_opening_00442('[{"productCode":"SUA","branchCode":"QUAN","quantity":10,"costPrice":25}]');raise exception 'OTHER_TENANT_PREVIEW_ALLOWED';
 exception when others then if sqlerrm not like '%OPENING_BRANCH_DENIED%' then raise;end if;end;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000012',true);
 if exists(select 1 from inventory_opening_batches) then raise exception 'INACTIVE_HISTORY_EXPOSED';end if;
 begin perform preview_inventory_opening_00442('[{"productCode":"SUA","branchCode":"QUAN","quantity":10,"costPrice":25}]');raise exception 'INACTIVE_PREVIEW_ALLOWED';
 exception when others then if sqlerrm not like '%OPENING_PERMISSION_DENIED%' then raise;end if;end;
end$$;
reset role;
select '00442/00443 opening stock: atomic, replay-safe, snapshot-safe, branch cost and history isolated, Vietnam lot date' as result;
