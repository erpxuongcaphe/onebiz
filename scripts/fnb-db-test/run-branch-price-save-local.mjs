// Actual kitchen send + actual shared resolver, synthetic PostgreSQL only.
import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';import assert from 'node:assert/strict';
const {PGlite}=await import(pathToFileURL(path.resolve(process.argv[2])).href);const db=new PGlite();
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
function extract(file,name){const source=fs.readFileSync('supabase/migrations/'+file,'utf8');const start=source.search(new RegExp('create or replace function public\\.'+name+'\\(','i'));const tail=source.slice(start),tag=/\bas\s+(\$[a-z_]*\$)/i.exec(tail);if(start<0||!tag)throw Error(name);return tail.slice(0,tail.indexOf(tag[1]+';',tag.index+tag[0].length)+tag[1].length+1);}
try{
 const fixture=fs.readFileSync('scripts/fnb-db-test/run-multiple-bills-local.mjs','utf8');const start=fixture.indexOf('await db.exec(`')+15;let sql=fixture.slice(start,fixture.indexOf('`);',start));sql=sql.replace(/\$\{id\((\d+)\)\}/g,(_,n)=>id(Number(n)));await db.exec(sql);
 await db.exec(`alter table branches add column price_tier_id uuid;
 alter table products add column allow_free_sale boolean default false;
 create function get_user_tenant_id() returns uuid language sql stable as $$select tenant_id from profiles where id=auth.uid() and is_active$$;
 create or replace function user_has_permission(uuid,text) returns boolean language sql stable as $$select case when $2='pos_fnb.edit_price' then false else coalesce(current_setting('test.permission',true),'true')='true' end$$;
 create table product_variants(id uuid,tenant_id uuid,product_id uuid,name text,sell_price numeric,is_active boolean default true);
 create table price_tiers(id uuid,tenant_id uuid,is_active boolean,scope text);
 create table price_tier_items(id uuid default gen_random_uuid(),price_tier_id uuid,product_id uuid,variant_id uuid,price numeric,min_qty numeric default 1,created_at timestamptz default now());
 create table branch_price_tier_assignments(tenant_id uuid,branch_id uuid,price_tier_id uuid,starts_at timestamptz,ends_at timestamptz,created_at timestamptz default now());
 create table customers(id uuid,tenant_id uuid,price_tier_id uuid);
 create table product_platform_prices(id uuid default gen_random_uuid(),tenant_id uuid,product_id uuid,variant_id uuid,platform text,override_price numeric,set_at timestamptz default now());
 insert into price_tiers values('${id(10)}','${id(2)}',true,'fnb');
 insert into branch_price_tier_assignments values('${id(2)}','${id(3)}','${id(10)}',now()-interval '1 day',null,now());
 insert into price_tier_items(price_tier_id,product_id,price) values('${id(10)}','${id(7)}',25000);
 `);
 await db.exec(extract('00377_fnb_variant_satisfies_legacy_size_modifier.sql','_fnb_send_to_kitchen_impl_00303'));
 await db.exec(fs.readFileSync('supabase/migrations/00449_fnb_effective_modifier_inheritance.sql','utf8'));
 await db.exec(extract('00363_unified_sale_pricing.sql','resolve_branch_price_tier_00363'));
 let resolver=extract('00363_unified_sale_pricing.sql','resolve_sale_price_00363').replace('select p.id, p.sell_price into v_product','select p.id, p.sell_price, p.allow_free_sale into v_product').replace("p_channel = 'fnb' and coalesce(v_unit_price, 0) <= 0","p_channel = 'fnb' and (v_unit_price is null or v_unit_price < 0 or (v_unit_price = 0 and not v_product.allow_free_sale))");await db.exec(resolver);
 let sequence=0;const send=async(price,variant=null,type='takeaway',platform='direct',quantity=1)=>{const lines=[{productId:id(7),quantity,unitPrice:price,...(variant?{variantId:variant}:{})}];return (await db.query('select _fnb_send_to_kitchen_impl_00303($1,null,$2,null,$3,$4::jsonb,$5) result',[id(3),type,'price-'+sequence++,JSON.stringify(lines),platform])).rows[0].result;};
 await assert.rejects(()=>send(25000),/PRICE_CHANGED:Coffee:25000:22000/); // reproduces Premium defect
 const legacy=await send(22000);
 if(process.argv.includes('--initialized')){
   resolver=resolver.replaceAll('\r\n','\n').replace('begin\n  if auth.uid() is null',`begin\n  select null::uuid as id, null::numeric as sell_price into v_variant;\n  select null::uuid as id, null::numeric as price, null::uuid as variant_id, null::numeric as min_qty into v_tier_item;\n  select null::uuid as id, null::numeric as override_price, null::uuid as variant_id into v_platform_price;\n  if auth.uid() is null`);
   await db.exec(resolver);
 }
 const resolverBefore=(await db.query("select pg_get_functiondef('public.resolve_sale_price_00363(uuid,uuid,uuid,uuid,text,text,numeric,timestamptz)'::regprocedure) d")).rows[0].d;
 const before=(await db.query('select count(*) n from kitchen_orders')).rows[0].n;
 const migration=fs.readFileSync('supabase/migrations/20261028091648_fnb_branch_price_at_kitchen_save.sql','utf8');await db.exec(migration);await db.exec(migration);
 if(process.argv.includes('--initialized')) assert.equal((await db.query("select pg_get_functiondef('public.resolve_sale_price_00363(uuid,uuid,uuid,uuid,text,text,numeric,timestamptz)'::regprocedure) d")).rows[0].d,resolverBefore,'preserves an already fixed concurrent resolver byte-for-byte');
 assert.equal((await db.query('select count(*) n from kitchen_orders')).rows[0].n,before);
 const stored=async(result)=>Number((await db.query('select unit_price from kitchen_order_items where kitchen_order_id=$1',[result.kitchen_order_id])).rows[0].unit_price);
 assert.equal(await stored(await send(25000)),25000);
 assert.equal(await stored(legacy),22000); // never reprice a previously saved bill
 assert.equal(await stored(await send(25000,null,'takeaway','direct',2)),25000);
 await assert.rejects(()=>send(22000),/PRICE_CHANGED:Coffee:22000:25000/);
 await db.exec(`insert into product_variants values('${id(11)}','${id(2)}','${id(7)}','Size L',27000,true);`);
 assert.equal(await stored(await send(25000,id(11))),25000); // product tier applies to variant
 await db.exec(`insert into price_tier_items(price_tier_id,product_id,variant_id,price) values('${id(10)}','${id(7)}','${id(11)}',30000);`);
 assert.equal(await stored(await send(30000,id(11))),30000);
 await db.exec(`insert into product_platform_prices(tenant_id,product_id,platform,override_price) values('${id(2)}','${id(7)}','grab_food',35000);`);
 assert.equal(await stored(await send(35000,id(11),'delivery','grab_food')),35000);
 await db.exec(`insert into product_platform_prices(tenant_id,product_id,variant_id,platform,override_price) values('${id(2)}','${id(7)}','${id(11)}','grab_food',38000);`);
 assert.equal(await stored(await send(38000,id(11),'delivery','grab_food')),38000);
 assert.equal(await stored(await send(30000,id(11),'delivery','shopee_food')),30000); // missing platform -> tier
 await db.exec('delete from branch_price_tier_assignments');
 const retail=(await db.query("select resolve_sale_price_00363($1,null,null,null,'retail','direct',1,now()) result",[id(7)])).rows[0].result;
 assert.equal(Number(retail.unit_price),22000);
 assert.equal(await stored(await send(22000)),22000); // Tư Búa/no-tier retains catalog
 assert.equal(await stored(await send(27000,id(11))),27000);
 await db.exec(`update products set sell_price=0,allow_free_sale=true where id='${id(7)}'`);assert.equal(await stored(await send(0)),0);
 await db.exec(`update products set allow_free_sale=false where id='${id(7)}'`);await assert.rejects(()=>send(0),/SALE_PRICE_FNB_NOT_POSITIVE/);
 await db.exec("set test.permission='false'");await assert.rejects(()=>send(22000),/INSUFFICIENT_PERMISSION/);
 assert.equal((await db.query("select has_function_privilege('authenticated','public._fnb_send_to_kitchen_before_branch_price_20261028(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)','EXECUTE') allowed")).rows[0].allowed,false);
 const definition=(await db.query("select pg_get_functiondef('public._fnb_send_to_kitchen_impl_00303(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)'::regprocedure) d")).rows[0].d;
 assert.ok(definition.includes('00449_PRODUCT_MODIFIERS_REPLACE_CATEGORY'));assert.ok(definition.includes('00377_VARIANT_SATISFIES_LEGACY_SIZE'));
 console.log('PASS branch-price save: reproduced 25k->22k; fixed product/variant/platform precedence; no-tier catalog; zero opt-in; stale price and permission guards; inheritance/size logic; idempotent migration; private backup; no old bill rewrite.');
}catch(error){console.error(error.message,error.where??'');process.exitCode=1;}finally{await db.close();}
