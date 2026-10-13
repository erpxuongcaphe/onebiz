// Exercises the real legacy create function behind the gram wrapper, including
// inserts, audit and branch scope. No production connection or business data.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const db = new PGlite();
const read = name => fs.readFileSync(`supabase/migrations/${name}`, 'utf8');
const extract = (file, name) => {
  const source = read(file);
  const start = source.indexOf(`create or replace function public.${name}(`);
  const end = source.indexOf('\n$$;', start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end + 4);
};
const tenant='10000000-0000-0000-0000-000000000001';
const actor='20000000-0000-0000-0000-000000000001';
const retail='30000000-0000-0000-0000-000000000001';
const outlet='30000000-0000-0000-0000-000000000002';
const yaourt='40000000-0000-0000-0000-000000000001';
const btp='40000000-0000-0000-0000-000000000002';
const raw='40000000-0000-0000-0000-000000000003';
try {
  await db.exec(`create role anon;create role authenticated;create schema auth;create schema extensions;
    create function auth.uid() returns uuid language sql stable as $$select '${actor}'::uuid$$;
    create function user_has_permission(uuid,text) returns boolean language sql stable as $$select coalesce(current_setting('test.permission',true),'true')='true'$$;
    create function user_has_branch_access(uuid,uuid) returns boolean language sql stable as $$select coalesce(current_setting('test.branch',true),'true')='true'$$;
    create function next_code(uuid,text) returns text language sql as $$select 'SX-'||gen_random_uuid()::text$$;
    create table profiles(id uuid,tenant_id uuid,role text,is_active boolean);
    insert into profiles values('${actor}','${tenant}','cashier',true);
    create table branches(id uuid,tenant_id uuid,cascade_mode text,is_active boolean default true);
    insert into branches(id,tenant_id,cascade_mode) values('${retail}','${tenant}','production'),('${outlet}','${tenant}','outlet');
    create table products(id uuid,tenant_id uuid,unit text,is_fnb_stock_item boolean,is_active boolean default true,cost_price numeric default 10,stock numeric default 50);
    insert into products(id,tenant_id,unit,is_fnb_stock_item) values('${yaourt}','${tenant}','Chai',false),('${btp}','${tenant}','G',true),('${raw}','${tenant}','G',true);
    create table bom(id uuid,tenant_id uuid,product_id uuid,is_active boolean default true,branch_id uuid);
    insert into bom(id,tenant_id,product_id) values('${yaourt}','${tenant}','${yaourt}'),('${btp}','${tenant}','${btp}');
    create table product_variants(id uuid,tenant_id uuid,product_id uuid,is_active boolean);
    create table production_orders(id uuid primary key default gen_random_uuid(),tenant_id uuid,code text,branch_id uuid,bom_id uuid,product_id uuid,variant_id uuid,planned_qty numeric,planned_start date,planned_end date,notes text,created_by uuid,status text default 'planned');
    create table production_order_materials(id uuid primary key default gen_random_uuid(),production_order_id uuid,product_id uuid,planned_qty numeric,unit text,unit_cost numeric);
    create table audit_log(tenant_id uuid,user_id uuid,action text,entity_type text,entity_id uuid,new_data jsonb);
    create table prepared_stock_unit_cutovers_00517(product_id uuid,state text);
    insert into prepared_stock_unit_cutovers_00517 values('${btp}','completed');`);
  await db.exec(extract('00283_harden_production_order_lifecycle.sql','create_production_order_atomic'));
  await db.exec(read('00467_production_output_branch_scope.sql'));
  const gram = read('00517_prepared_stock_gram_cutover.sql');
  const start=gram.indexOf('alter function public.create_production_order_atomic(jsonb) rename');
  await db.exec(gram.slice(start,gram.indexOf('commit;',start)));
  const payload=(product,branch,unit)=>({branch_id:branch,bom_id:product,product_id:product,variant_id:null,planned_qty:product===yaourt?14:750,stock_unit:unit,planned_start:null,planned_end:null,notes:null,materials:[{product_id:raw,planned_qty:100,unit:'G'}]});
  const call = input => db.query('select create_production_order_atomic($1::jsonb) result',[JSON.stringify(input)]);
  // Reproduce the actual regression before applying the fix.
  await assert.rejects(call(payload(yaourt,retail,'cái')),/PRODUCTION_INPUT_INVALID/);
  await assert.rejects(call(payload(btp,outlet,'G')),/PRODUCTION_INPUT_INVALID/);
  await db.exec(read('00524_production_gram_payload_compatibility.sql'));
  await call(payload(yaourt,retail,'cái')); // legacy BOM label may differ from product stock label
  await call(payload(btp,outlet,'G'));
  const old=payload(yaourt,retail,'Chai');delete old.stock_unit;await call(old);
  const count=async table=>Number((await db.query(`select count(*) n from ${table}`)).rows[0].n);
  assert.equal(await count('production_orders'),3);
  assert.equal(await count('production_order_materials'),3);
  assert.equal(await count('audit_log'),3);
  const before=await count('production_orders');
  await assert.rejects(call(payload(btp,outlet,'Mẻ')),/GRAM_FORM_REFRESH_REQUIRED/);
  const missing=payload(btp,outlet,'G');delete missing.stock_unit;await assert.rejects(call(missing),/GRAM_FORM_REFRESH_REQUIRED/);
  const unknown={...payload(yaourt,retail,'Chai'),unexpected:true};await assert.rejects(call(unknown),/PRODUCTION_INPUT_INVALID/);
  await assert.rejects(call({...old,planned_qty:0}),/PLANNED_QUANTITY_INVALID/);
  await assert.rejects(call(payload(yaourt,outlet,'Chai')),/FNB_PRODUCTION_PREPARED_OUTPUT_REQUIRED/);
  await db.exec("select set_config('test.permission','false',false)");await assert.rejects(call(old),/CREATE_PRODUCTION_ORDER_PERMISSION_REQUIRED/);
  await db.exec("select set_config('test.permission','true',false);select set_config('test.branch','false',false)");await assert.rejects(call(old),/PRODUCTION_BRANCH_ACCESS_DENIED/);
  assert.equal(await count('production_orders'),before,'failed validation cannot create documents');
  assert.deepEqual((await db.query('select stock from products order by id')).rows.map(x=>Number(x.stock)),[50,50,50],'creation does not post stock');
  await db.exec(read('00524_production_gram_payload_compatibility.sql')); // migration replay is harmless
  console.log('PASS: reproduced legacy JSON rejection; Retail 14 Yaourt and gram F&B creation; legacy clients; real inserts/audit; stale grams, permissions, branch, unknown fields and invalid qty still rejected; stock unchanged.');
} finally {await db.close();}
