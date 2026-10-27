// Disposable PostgreSQL engine only; never connects to the live project.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const { PGlite } = createRequire(process.argv[2] || import.meta.url)('@electric-sql/pglite');
const db = new PGlite();
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const [tenant,other,actor,template,product,zero,raw,menu]=[1,2,3,4,5,6,7,8].map(id);
await db.exec(`
create role anon;create role authenticated;create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
create table tenants(id uuid primary key);
create table profiles(id uuid primary key,tenant_id uuid,is_active boolean);
create table branches(id uuid primary key default gen_random_uuid(),tenant_id uuid,name text,code text,branch_type text,cascade_mode text,is_active boolean default true,is_default boolean default false,address text,phone text,price_tier_id uuid,legal_entity_type text,legal_entity_name text,legal_tax_code text,legal_registration_no text,shift_cutoff_hour integer,settings jsonb default '{}',updated_at timestamptz default now());
create table price_tiers(id uuid,tenant_id uuid,is_active boolean);
create table products(id uuid primary key,tenant_id uuid,code text,name text,unit text,sell_price numeric,is_active boolean,product_type text,channel text,inventory_role text);
create table tenant_settings(tenant_id uuid,key text,value jsonb,description text,updated_by uuid,updated_at timestamptz default now(),unique(tenant_id,key));
create table fnb_supply_catalog(tenant_id uuid,branch_id uuid references branches(id),product_id uuid,created_by uuid,unique(tenant_id,branch_id,product_id));
create table fnb_supply_catalog_audit(tenant_id uuid,branch_id uuid,product_id uuid,action text,actor_id uuid);
create table fnb_supply_branch_scopes(tenant_id uuid,branch_id uuid references branches(id),enforcement_enabled boolean,updated_by uuid,note text,unique(tenant_id,branch_id));
create table fnb_supply_branch_scope_audit(tenant_id uuid,branch_id uuid,enforcement_enabled boolean,note text,actor_id uuid);
create table audit_log(tenant_id uuid,user_id uuid,action text,entity_type text,entity_id uuid,old_data jsonb,new_data jsonb);
create function user_has_permission(uuid,text) returns boolean language sql stable set search_path=public as $$select coalesce(current_setting('test.denied',true),'')<>$2$$;
create function user_has_branch_access(uuid,uuid) returns boolean language sql stable set search_path=public as $$select exists(select 1 from branches b join profiles p on p.tenant_id=b.tenant_id where p.id=$1 and b.id=$2) and coalesce(current_setting('test.branch_denied',true),'')<>$2::text$$;
create function _fnb_branch_cost_tracking_enabled_00390(uuid,uuid) returns boolean language sql stable set search_path=public as $$select exists(select 1 from fnb_supply_branch_scopes where tenant_id=$1 and branch_id=$2 and enforcement_enabled)$$;
insert into tenants values('${tenant}'),('${other}');insert into profiles values('${actor}','${tenant}',true);
insert into branches(id,tenant_id,name,code,branch_type,cascade_mode) values('${template}','${tenant}','Mẫu','A','store','outlet');
insert into fnb_supply_branch_scopes values('${tenant}','${template}',true,'${actor}',null);
insert into products values('${product}','${tenant}','SKU-A','Sữa','Hộp',32500.1234567,true,'sku','retail','retail_stock_item'),('${zero}','${tenant}','SKU-B','BTP','G',0,true,'sku','retail','fnb_stock_item'),('${raw}','${other}','OTHER','Khác','Kg',100,true,'sku','retail',null),('${menu}','${tenant}','MENU','Món','Ly',100,true,'sku','fnb','fnb_menu_item');
insert into fnb_supply_catalog values('${tenant}','${template}','${product}','${actor}');
set test.actor='${actor}';
`);
// Exercise the real branch creation function, not a simulated insert wrapper.
await db.exec(readFileSync('supabase/migrations/00277_atomic_branch_management.sql','utf8'));
await db.exec(readFileSync('supabase/migrations/20261027154149_fnb_opening_cost_defaults.sql','utf8'));
const value=async(sql)=>(await db.query(sql)).rows[0];
let checks=0;
async function rejects(sql,code){await assert.rejects(db.query(sql),e=>e.message.includes(code));checks++;}
const quote=await value(`select get_inventory_opening_warehouse_prices('${template}',array['${product}','${product}','${zero}']::uuid[]) q`);
assert.equal(quote.q.length,2);assert.equal(quote.q.find(x=>x.productId===product).costPrice,32500.123457);assert.equal(quote.q.find(x=>x.productId===zero).costPrice,null);checks+=3;
await rejects(`select get_inventory_opening_warehouse_prices('${template}',array['${raw}']::uuid[])`,'OPENING_PRODUCT_NOT_FOUND');
await rejects(`select get_inventory_opening_warehouse_prices('${template}',array['${menu}']::uuid[])`,'OPENING_PRODUCT_NOT_FOUND');
await rejects(`select get_inventory_opening_warehouse_prices('${template}','{}'::uuid[])`,'OPENING_ROWS_LIMIT');
await db.exec(`set test.denied='inventory.adjust'`);
await rejects(`select get_inventory_opening_warehouse_prices('${template}',array['${product}']::uuid[])`,'OPENING_PERMISSION_DENIED');
await db.exec(`set test.denied=''`);
await rejects(`select set_fnb_new_store_cost_default(true,'${raw}','reason')`,'FNB_DEFAULT_TEMPLATE_REQUIRED');
await rejects(`select set_fnb_new_store_cost_default(true,'${template}','')`,'FNB_DEFAULT_INPUT_INVALID');
await db.exec(`set test.denied='products.edit'`);await rejects(`select set_fnb_new_store_cost_default(true,'${template}','reason')`,'FNB_SUPPLY_PERMISSION_DENIED');await db.exec(`set test.denied=''`);
assert.equal((await value(`select get_fnb_new_store_cost_default() q`)).q.enabled,false);checks++;
await db.query(`select set_fnb_new_store_cost_default(true,'${template}','test explicit opt-in')`);
const created=(await value(`select save_branch_atomic(null,'{"name":"New store","code":"NEW","branch_type":"store"}') q`)).q;
assert.equal((await value(`select count(*)::int n from fnb_supply_catalog where branch_id='${created.id}'`)).n,1);checks++;
assert.equal((await value(`select enforcement_enabled from fnb_supply_branch_scopes where branch_id='${created.id}'`)).enforcement_enabled,true);checks++;
assert.equal((await value(`select count(*)::int n from fnb_supply_branch_scope_audit where branch_id='${created.id}'`)).n,1);checks++;
// Editing a live branch must not re-apply defaults or copy its template again.
await db.query(`select save_branch_atomic('${created.id}','{"name":"Renamed"}')`);
assert.equal((await value(`select count(*)::int n from fnb_supply_catalog_audit where branch_id='${created.id}'`)).n,1);checks++;
for(const type of ['warehouse','factory','office']){
 const b=(await value(`select save_branch_atomic(null,'{"name":"${type}","branch_type":"${type}"}') q`)).q;
 assert.equal((await value(`select count(*)::int n from fnb_supply_branch_scopes where branch_id='${b.id}'`)).n,0);checks++;
}
const otherStore=id(20);await db.exec(`insert into branches(id,tenant_id,name,branch_type,cascade_mode) values('${otherStore}','${other}','Other','store','outlet')`);
assert.equal((await value(`select count(*)::int n from fnb_supply_branch_scopes where branch_id='${otherStore}'`)).n,0);checks++;
// Stale template fails atomically: no half-created branch or audit.
await db.exec(`update branches set is_active=false where id='${template}'`);
const before=(await value(`select count(*)::int n from branches`)).n;
await rejects(`select save_branch_atomic(null,'{"name":"Must rollback","code":"BAD","branch_type":"store"}')`,'FNB_DEFAULT_TEMPLATE_REQUIRED');
assert.equal((await value(`select count(*)::int n from branches`)).n,before);checks++;
await db.query(`select set_fnb_new_store_cost_default(false,null,'Disable future defaults')`);
const plain=(await value(`select save_branch_atomic(null,'{"name":"Plain","branch_type":"store"}') q`)).q;
assert.equal((await value(`select count(*)::int n from fnb_supply_branch_scopes where branch_id='${plain.id}'`)).n,0);checks++;
assert.equal((await value(`select has_function_privilege('anon','public.get_inventory_opening_warehouse_prices(uuid,uuid[])','execute') ok`)).ok,false);checks++;
assert.equal((await value(`select has_function_privilege('authenticated','public._initialize_fnb_new_store_cost_default()','execute') ok`)).ok,false);checks++;
await db.close();console.log(`FNB opening quotes and future defaults: ${checks} PostgreSQL checks passed`);
