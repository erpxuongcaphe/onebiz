// Disposable PostgreSQL: confirmed shared recipes through the real resolver and stock consumer.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(process.argv[2]?pathToFileURL(path.resolve(process.argv[2])).href:'@electric-sql/pglite');
const db=new PGlite();
const tenant='148e8ac5-b891-4de3-9055-cfa41f39ddb0';
const honeyDrink='240e906d-e95e-4e9b-bdba-dea969feca96',lemonDrink='dd1f9569-604b-458c-a43e-eb5217a4c736';
const honeyBom='7c47398a-82fe-4a08-b117-dd5ab4099c20',lemonBom='c52358b4-ad28-4b09-b7ef-6200b0fb5d82';
const honey='0a398b76-4de8-4317-8e34-0e594fe59b0b',lemon='34617a2e-d6e4-40b3-b20a-3587266ddf9b',tac='64ce6219-d22d-4313-97b7-49add8a8bd6b';
const honeyItem='8951e89d-9997-4020-a8a1-d22a5c5326d4',lemonItem='8110adf1-3732-43e2-8dec-791bc90fd39d',tacItem='3ec63bfb-3a2d-4552-ad07-b2695f1655ac';
const group='378ae8d0-0974-4c6b-ba13-9ef1c2511a0e';
const options=['c70b0cfa-63e1-4193-88af-203b419f2e40','3471cb10-ecb6-473f-89c7-7287ac497204','57cfce93-b29b-4f3b-96d7-e9a89f92f6a1'];
const id=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
function extract(file,name){const s=fs.readFileSync(file,'utf8');const m=new RegExp('create or replace function public\\.'+name+'\\s*\\(','i').exec(s);assert(m,name);const rest=s.slice(m.index);const tag=/\bas\s+(\$[a-z_]*\$)/i.exec(rest);assert(tag);const end=rest.indexOf(tag[1],tag.index+tag[0].length);return rest.slice(0,end+tag[1].length)+';';}
const migration=fs.readFileSync('supabase/migrations/202610210005_confirmed_tea_recipe_quantities.sql','utf8');
const rows=async sql=>(await db.query(sql)).rows;
try{
await db.exec(`create schema extensions;
create table products(id uuid primary key,tenant_id uuid,code text,name text,bom_code text,unit text,is_active boolean default true);
create table product_variants(id uuid primary key,tenant_id uuid,product_id uuid,bom_code text);
create table bom(id uuid primary key,tenant_id uuid,product_id uuid,variant_id uuid,branch_id uuid,code text,name text,version int default 1,is_active boolean default true,cached_cost numeric,cached_cost_updated_at timestamptz,updated_at timestamptz);
create table bom_items(id uuid primary key,bom_id uuid,material_id uuid,unit text,quantity numeric(18,4),input_quantity numeric,input_unit text,conversion_factor numeric,waste_percent numeric default 0,modifier_scale_target uuid,sort_order int,note text);
create table modifier_groups(id uuid primary key,tenant_id uuid,is_active boolean,name text);
create table modifier_options(id uuid primary key,group_id uuid,scale_factor numeric,is_active boolean);
create table bom_modifier_option_quantities(bom_id uuid,material_id uuid,modifier_option_id uuid,quantity numeric);
create table branch_stock(tenant_id uuid,branch_id uuid,product_id uuid,variant_id uuid,quantity numeric);
create table stock_movements(tenant_id uuid,branch_id uuid,product_id uuid,type text,quantity numeric,reference_type text,reference_id uuid,note text,created_by uuid);
create table historical_recipe_snapshots(invoice_id uuid,quantity numeric);
create function _allow_negative_sale_00473(uuid,uuid) returns boolean language sql as $$select false$$;
create function upsert_branch_stock(uuid,uuid,uuid,numeric) returns void language sql as $$update branch_stock set quantity=quantity+$4 where tenant_id=$1 and branch_id=$2 and product_id=$3$$;
create function increment_product_stock(uuid,numeric) returns void language sql as $$select$$;
create function allocate_lots_fifo(uuid,uuid,uuid,numeric,text,uuid) returns void language sql as $$select$$;
insert into products(id,tenant_id,code,name,unit) values
('${honeyDrink}','${tenant}','SKU-HTR-003','Honey tea','Ly'),('${lemonDrink}','${tenant}','SKU-HTR-002','Lemon tea','Ly'),
('${honey}','${tenant}','SKU-SST-018','Honey','Chai'),('${lemon}','${tenant}','SKU-TCA-015','Lemon','Trái'),('${tac}','${tenant}','SKU-TCA-014','Tac','Trái'),('${id(10)}','${tenant}','SUGAR','Sugar','G');
insert into bom(id,tenant_id,product_id,code,name,cached_cost) values('${honeyBom}','${tenant}','${honeyDrink}','BOM-SKU-HTR-003','Honey tea',1),('${lemonBom}','${tenant}','${lemonDrink}','BOM-SKU-HTR-002-CNH-XPR','Lemon tea',1);
insert into bom_items(id,bom_id,material_id,unit,quantity,input_quantity,input_unit,conversion_factor,note) values
('${honeyItem}','${honeyBom}','${honey}','Chai',0.0003,1,'G',0.00033333,'preserve'),
('${lemonItem}','${lemonBom}','${lemon}','Trái',2,2,'Trái',1,'preserve'),
('${tacItem}','${lemonBom}','${tac}','Trái',1,1,'Trái',1,'preserve'),
('${id(11)}','${honeyBom}','${tac}','Trái',1,1,'Trái',1,'unrelated honey tea tac'),
('${id(12)}','${lemonBom}','${id(10)}','G',3,3,'G',1,'unrelated sugar');
update bom_items set modifier_scale_target='${group}' where id='${id(12)}';
insert into modifier_groups values('${group}','${tenant}',true,'Mức ngọt - Hồng Trà');
insert into historical_recipe_snapshots values('${id(90)}',0.0003);
`);
for(let i=0;i<3;i++)await db.exec(`insert into modifier_options values('${options[i]}','${group}',${[0.8,1,1.2][i]},true);insert into bom_modifier_option_quantities values('${lemonBom}','${id(10)}','${options[i]}',${i+2});`);
for(const branch of [id(2),id(3)])for(const material of [honey,lemon,tac,id(10)])await db.exec(`insert into branch_stock values('${tenant}','${branch}','${material}',null,1000);`);
await db.exec(extract('supabase/migrations/00147_variant_aware_bom_lookup.sql','get_active_bom_for_branch'));
await db.exec(extract('supabase/migrations/00544_fnb_explicit_sweetness_only.sql','consume_bom_for_sale'));
const stockBefore=await rows('select * from branch_stock order by branch_id,product_id');
const historyBefore=await rows('select * from historical_recipe_snapshots');
const otherBefore=await rows(`select * from bom_items where id in ('${id(11)}','${id(12)}') order by id`);
const exactBefore=await rows('select * from bom_modifier_option_quantities order by modifier_option_id');
// Fail closed before any update if the audited values, scope or units change.
const guardedBody=migration.replace(/^begin;$/m,'').replace(/^commit;$/m,'');
for(const [change,error] of [
 [`update bom_items set quantity=9 where id='${tacItem}'`,'VALUE_CHANGED'],
 [`update bom_items set input_unit='KG' where id='${honeyItem}'`,'VALUE_CHANGED'],
 [`insert into bom_modifier_option_quantities values('${honeyBom}','${honey}','${options[0]}',1)`,'VALUE_CHANGED'],
 [`insert into bom(id,tenant_id,product_id,branch_id) values('${id(99)}','${tenant}','${honeyDrink}','${id(2)}')`,'SCOPE_CHANGED']
]){
 await db.exec('begin');await db.exec(change);await assert.rejects(()=>db.exec(guardedBody),new RegExp(error));await db.exec('rollback');
 assert.equal(Number((await rows(`select quantity from bom_items where id='${honeyItem}'`))[0].quantity),0.0003,'guard rolls back without changing first item');
}
await db.exec(migration);await db.exec(migration);
assert.deepEqual(await rows('select * from branch_stock order by branch_id,product_id'),stockBefore,'install does not adjust stock');
assert.deepEqual(await rows('select * from historical_recipe_snapshots'),historyBefore,'closed bill snapshots preserved');
assert.equal((await rows('select count(*)::int n from stock_movements'))[0].n,0);
assert.deepEqual(await rows(`select * from bom_items where id in ('${id(11)}','${id(12)}') order by id`),otherBefore,'other recipe inputs untouched');
assert.deepEqual(await rows('select * from bom_modifier_option_quantities order by modifier_option_id'),exactBefore,'measured sugar options untouched');
const patched=await rows(`select quantity,input_quantity,note from bom_items where id='${honeyItem}'`);
assert.equal(Number(patched[0].input_quantity),53);assert.equal(Number(patched[0].quantity),0.0177);assert.equal(patched[0].note,'preserve');
assert.equal((await rows('select count(*)::int n from bom where cached_cost is null'))[0].n,2);
const consume=async(product,branch,index)=>{
 const selections=[{groupId:group,groupName:'Mức ngọt - Hồng Trà',options:[{optionId:options[index],scaleFactor:[0.8,1,1.2][index]}]}];
 return (await db.query('select consume_bom_for_sale($1,$2,$3,1,$4,$5,null,$6,false,null) result',[tenant,branch,product,id(90),id(7),JSON.stringify(selections)])).rows[0].result;
};
for(const branch of [id(2),id(3)])for(let i=0;i<3;i++){
 await db.exec('begin');
 const honeyResult=await consume(honeyDrink,branch,i),lemonResult=await consume(lemonDrink,branch,i);
 const qty=(result,material)=>Number(result.consumed.find(x=>x.material_id===material).qty);
 assert.equal(honeyResult.bom_id,honeyBom);assert.equal(lemonResult.bom_id,lemonBom);
 assert.equal(qty(honeyResult,honey),0.0177,'fixed honey for all three sweetness levels and both branches');
 assert.equal(qty(honeyResult,tac),1,'unrelated honey tea tac unchanged');
 assert.equal(qty(lemonResult,lemon),1.5);assert.equal(qty(lemonResult,tac),0.5);
 assert.equal(qty(lemonResult,id(10)),i+2,'existing exact sugar option still controls sugar');
 const ledger=await rows(`select product_id,sum(quantity) qty from stock_movements group by product_id`);
 assert.equal(Number(ledger.find(x=>x.product_id===honey).qty),0.0177);
 const remaining=await rows(`select quantity from branch_stock where branch_id='${branch}' and product_id='${honey}'`);
 assert.equal(Number(remaining[0].quantity),999.9823);
 await db.exec('rollback');
}
// A deployment in a different tenant has no owner-specific configuration to patch.
await db.exec('begin');await db.exec(`update products set tenant_id='${id(88)}' where id='${honeyDrink}'`);await db.exec(guardedBody);await db.exec('rollback');
console.log('PASS: shared recipes, real BOM lookup and stock ledger at two branches / 80%-100%-120%, 53g input normalized to 0.0177 bottle (53.1g at 4-decimal stock precision), unchanged sugar mappings/history/stock on install, safe rerun, tenant no-op and transactional drift guards');
}finally{await db.close();}
