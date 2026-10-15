// Disposable PostgreSQL contract test; never connects to production.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(process.argv[2] ? pathToFileURL(path.resolve(process.argv[2])).href : '@electric-sql/pglite');
const db = new PGlite();
const id = n => '00000000-0000-0000-0000-' + String(n).padStart(12,'0');
try {
 await db.exec(`create schema extensions;
 create table products(id uuid primary key,code text,name text);
 create table bom(id uuid primary key,code text,name text);
 create table bom_items(id uuid default gen_random_uuid(),bom_id uuid,material_id uuid,unit text,quantity numeric,waste_percent numeric,modifier_scale_target uuid,sort_order int);
 create table modifier_groups(id uuid,tenant_id uuid,is_active boolean);
 create table modifier_options(id uuid,group_id uuid,scale_factor numeric,is_active boolean);
 create table bom_modifier_option_quantities(bom_id uuid,material_id uuid,modifier_option_id uuid,quantity numeric);
 create table branch_stock(tenant_id uuid,branch_id uuid,product_id uuid,variant_id uuid,quantity numeric);
 create table stock_movements(tenant_id uuid,branch_id uuid,product_id uuid,type text,quantity numeric,reference_type text,reference_id uuid,note text,created_by uuid);
 create function get_active_bom_for_branch(uuid,uuid,uuid) returns uuid language sql as $$ select '${id(4)}'::uuid $$;
 create function _allow_negative_sale_00473(uuid,uuid) returns boolean language sql as $$ select false $$;
 create function upsert_branch_stock(uuid,uuid,uuid,numeric) returns void language sql as $$ update branch_stock set quantity=quantity+$4 where tenant_id=$1 and branch_id=$2 and product_id=$3 $$;
 create function increment_product_stock(uuid,numeric) returns void language sql as $$ select $$;
 create function allocate_lots_fifo(uuid,uuid,uuid,numeric,text,uuid) returns void language sql as $$ select $$;
 insert into products values('${id(10)}','SUGAR','Sugar'),('${id(11)}','MILK','Condensed milk'),('${id(12)}','HONEY','Honey');
 insert into bom values('${id(4)}','RECIPE','Recipe');
 insert into modifier_groups values('${id(5)}','${id(1)}',true);
 insert into bom_items(bom_id,material_id,quantity,unit,waste_percent,modifier_scale_target,sort_order) values
 ('${id(4)}','${id(10)}',10,'G',0,'${id(5)}',1),('${id(4)}','${id(11)}',20,'G',0,null,2),('${id(4)}','${id(12)}',30,'G',0,null,3);
 insert into branch_stock select '${id(1)}','${id(2)}',id,null,1000 from products;`);
 const migration=fs.readFileSync('supabase/migrations/00541_fnb_authoritative_modifier_scale.sql','utf8');
 const start=migration.indexOf('CREATE OR REPLACE FUNCTION');
 const end=migration.indexOf('$function$',migration.indexOf('$function$',start)+10)+10;
 await db.exec(migration.slice(start,end)+';');
 const consume=async option => (await db.query('select consume_bom_for_sale($1,$2,$3,1,$4,$5,null,$6,false,null) result',
 [id(1),id(2),id(3),id(6),id(7),JSON.stringify([{groupId:id(5),options:[{optionId:option,scaleFactor:0.001}]}])])).rows[0].result;
 for(const [n,factor] of [[20,0],[21,.8],[22,1],[23,1.2]]) {
 await db.query('insert into modifier_options values($1,$2,$3,true)',[id(n),id(5),factor]);
 await db.exec('begin');
 const result=await consume(id(n));
 const amount=material => Number(result.consumed.find(x=>x.material_id===id(material))?.qty??0);
 assert.equal(amount(10),10*factor,'database factor overrides cart factor including 120%');
 assert.equal(amount(11),20,'condensed milk unchanged'); assert.equal(amount(12),30,'honey unchanged');
 await db.exec('rollback');
 }
 await db.query('insert into bom_modifier_option_quantities values($1,$2,$3,17)',[id(4),id(10),id(23)]);
 await db.exec('begin'); const exact=await consume(id(23));
 assert.equal(Number(exact.consumed.find(x=>x.material_id===id(10)).qty),17,'exact measured recipe takes priority');
 await db.exec('rollback');
 assert.equal(Number((await db.query('select sum(quantity) qty from branch_stock')).rows[0].qty),3000,'rollback leaves stock unchanged');
 console.log('PASS: actual consume function; 0/80/100/120%, forged cart factor, unchanged milk/honey, exact recipe priority, rollback');
} finally { await db.close(); }
