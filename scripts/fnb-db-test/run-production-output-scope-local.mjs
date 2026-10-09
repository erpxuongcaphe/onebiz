import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const db=new PGlite();
try {
 await db.exec(`create role anon; create role authenticated;
 create table branches(id text,tenant_id text,cascade_mode text);
 create table products(id text,tenant_id text,is_fnb_stock_item boolean,is_active boolean);
 create table bom(id text,tenant_id text,product_id text,is_active boolean,branch_id text);
 create table production_orders(id text,tenant_id text,branch_id text,product_id text,bom_id text);
 insert into branches values('xtb','tenant','outlet'),('warehouse','tenant','production');
 insert into products values('prepared','tenant',true,true),('menu','tenant',false,true);
 insert into bom values('prepared-bom','tenant','prepared',true,null),('menu-bom','tenant','menu',true,null),('wrong-branch','tenant','prepared',true,'warehouse');`);
 await db.exec(fs.readFileSync('supabase/migrations/00467_production_output_branch_scope.sql','utf8'));
 await db.exec("insert into production_orders values('good','tenant','xtb','prepared','prepared-bom')");
 await assert.rejects(db.exec("insert into production_orders values('bad','tenant','xtb','menu','menu-bom')"),/FNB_PRODUCTION_PREPARED_OUTPUT_REQUIRED/);
 await assert.rejects(db.exec("insert into production_orders values('bad','tenant','xtb','prepared','wrong-branch')"),/PRODUCTION_BOM_BRANCH_MISMATCH/);
 await db.exec("insert into production_orders values('retail','tenant','warehouse','menu','menu-bom')");
 assert.equal(Number((await db.query('select count(*) n from production_orders')).rows[0].n),2);
 console.log('PASS: F&B only produces prepared stock; wrong branch recipe rejected; Retail output flow preserved.');
} finally {await db.close();}
