import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const db = new PGlite();
const migration = fs.readFileSync('supabase/migrations/00465_bom_product_uom_synchronization.sql','utf8');
const original = fs.readFileSync('supabase/migrations/00320_uom_accounting_snapshots.sql','utf8');
const resolver = original.slice(original.indexOf('create or replace function public.resolve_product_uom_factor('), original.indexOf('revoke all on function public.resolve_product_uom_factor'));
const normalize = original.slice(original.indexOf('create or replace function public.normalize_bom_item_uom_00320()'), original.indexOf('revoke all on function public.normalize_bom_item_uom_00320'));
const material='00000000-0000-0000-0000-000000000001';
try {
 await db.exec(`create role anon; create role authenticated; create schema auth; create schema extensions;
 create function auth.uid() returns uuid language sql as 'select null::uuid';
 create table products(id uuid primary key, tenant_id uuid, unit text, is_active boolean);
 create table bom(id uuid primary key,tenant_id uuid,product_id uuid,is_active boolean default true);
 create table bom_items(id uuid primary key,bom_id uuid,material_id uuid,quantity numeric(18,4),unit text,input_quantity numeric(18,8),input_unit text,conversion_factor numeric(20,8),modifier_scale_target uuid);
 create table uom_conversions(id serial primary key,tenant_id uuid,product_id uuid,from_unit text,to_unit text,factor numeric,is_active boolean);
 create table bom_modifier_option_quantities(id serial primary key, tenant_id uuid,bom_id uuid,material_id uuid,modifier_option_id uuid,quantity numeric(15,4));
 create table audit_log(tenant_id uuid,user_id uuid,action text,entity_type text,entity_id uuid,old_data jsonb,new_data jsonb);
 insert into products values('${material}','${material}','Lon',true);
 insert into bom(id,tenant_id,product_id) values('${material}','${material}','${material}');
 insert into uom_conversions(tenant_id,product_id,from_unit,to_unit,factor,is_active) values('${material}','${material}','Lon','G',1000,true);
 insert into bom_items values('${material}','${material}','${material}',.02,'Lon',28,'G',.00071429,null);
 insert into bom_modifier_option_quantities(tenant_id,bom_id,material_id,quantity) values('${material}','${material}','${material}',.01);
 ${resolver} ${normalize}`);
 await db.exec(migration);
 const scalar = async sql => (await db.query(sql)).rows[0];
 assert.equal(Number((await scalar('select quantity from bom_items')).quantity),.028);
 const exact = await scalar('select input_quantity, quantity from bom_modifier_option_quantities');
 assert.ok(Math.abs(Number(exact.input_quantity)-14)<.0001);
 assert.equal(Number(exact.quantity),.014);
 await db.exec(`begin; update uom_conversions set is_active=false;
 insert into uom_conversions(tenant_id,product_id,from_unit,to_unit,factor,is_active) values('${material}','${material}','Lon','G',2000,true); commit;`);
 assert.equal(Number((await scalar('select quantity from bom_items')).quantity),.014);
 assert.equal(Number((await scalar('select quantity from bom_modifier_option_quantities')).quantity),.007);
 assert.equal(Number((await scalar('select input_quantity from bom_items')).input_quantity),28);
 let rejected=false;
 try { await db.exec('begin; update uom_conversions set is_active=false; commit;'); }
 catch(error) { rejected=error.message.includes('UOM_CONVERSION_NOT_FOUND'); await db.exec('rollback;'); }
 assert.equal(rejected,true);
 assert.equal(Number((await scalar('select quantity from bom_items')).quantity),.014);
 assert.equal(Number((await scalar('select count(*) n from uom_conversions where is_active')).n),1);
 const audits=await scalar('select count(*) n from bom_uom_sync_history_00465');
 assert.equal(Number(audits.n),2);
 console.log('PASS: stale BOM repair; exact preparation preservation; atomic packaging change; missing conversion rollback; audit trail.');
} finally { await db.close(); }
