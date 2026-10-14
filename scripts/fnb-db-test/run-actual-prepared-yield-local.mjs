import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(path.resolve(process.argv[2])).href);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'onebiz-yield-'));
const files=new Map();
for (const [script,name] of [['extract-supply-cost-flow','fnb-supply-cost-flow'],['extract-cost-trigger','fnb-prepared-cost-trigger'],['extract-production-chain','fnb-real-production-chain']]) {
  const file=path.join(dir,name+'.sql'); execFileSync(process.execPath,[`scripts/fnb-db-test/${script}.mjs`,file]); files.set('/tmp/'+name+'.sql',file);
}
function expand(file) {return fs.readFileSync(file,'utf8').replace(/^\\i(r?)\s+(.+)$/gm,(_,r,t)=>expand(files.get(t.trim())??path.resolve(path.dirname(file),t.trim()))).replace(/^\\set.*$/gm,'').replace('create extension if not exists "uuid-ossp";','').replaceAll('uuid_generate_v4()', 'gen_random_uuid()');}
const db=new PGlite();
try {
  await db.exec('create role anon;create role authenticated;');
  await db.exec(expand('supabase/tests/00417_fnb_real_production_chain.integration.sql'));
  await db.exec(fs.readFileSync('supabase/migrations/00511_fnb_actual_prepared_yield.sql','utf8'));
  await db.exec(fs.readFileSync('supabase/migrations/00525_prepared_production_material_snapshot_guard.sql','utf8'));
  const branch='20000000-0000-0000-0000-000000000002',tenant='10000000-0000-0000-0000-000000000001',raw='30000000-0000-0000-0000-000000000001',prepared='30000000-0000-0000-0000-000000000002',actor='40000000-0000-0000-0000-000000000001';
  const qty=async id=>Number((await db.query(`select quantity from branch_stock where product_id='${id}'`)).rows[0].quantity);
  for (const actual of [580,620]) {
    const id=crypto.randomUUID(),beforeRaw=await qty(raw),beforePrepared=await qty(prepared);
    await db.exec(`insert into production_orders(id,tenant_id,branch_id,product_id,code,created_by,status,planned_qty) values('${id}','${tenant}','${branch}','${prepared}','SX-${actual}','${actor}','planned',600);
      insert into production_order_materials(id,production_order_id,product_id,planned_qty,unit,unit_cost) values(gen_random_uuid(),'${id}','${raw}',.5,'Tui',12500);`);
    await db.query(`select complete_production_atomic('${id}',${actual},'YIELD-${actual}',current_date,null)`);
    assert.equal(await qty(raw),beforeRaw-.5,'raw input does not scale with actual yield');
    assert.equal(await qty(prepared),beforePrepared+actual,'actual measured output enters stock');
    const cost=(await db.query(`select cogs_amount from production_orders where id='${id}'`)).rows[0];
    assert.equal(Number(cost.cogs_amount),6250,'batch cost remains actual consumed raw cost');
    await assert.rejects(()=>db.query(`select complete_production_atomic('${id}',${actual},'YIELD-${actual}',current_date,null)`));
    assert.equal(await qty(raw),beforeRaw-.5,'retry completed batch cannot deduct twice');
  }
  // A second prepared batch consumes the first BTP's physical stock directly.
  const mix='30000000-0000-0000-0000-000000000009',nested=crypto.randomUUID();
  const rawBeforeNested=await qty(raw),preparedBeforeNested=await qty(prepared);
  const inputCost=Number((await db.query(`select unit_cost from fnb_branch_product_cost_balances where branch_id='${branch}' and product_id='${prepared}'`)).rows[0].unit_cost);
  const rawCost=Number((await db.query(`select unit_cost from fnb_branch_product_cost_balances where branch_id='${branch}' and product_id='${raw}'`)).rows[0].unit_cost);
  await db.exec(`insert into products(id,tenant_id,is_fnb_stock_item,stock,cost_price) values('${mix}','${tenant}',true,0,0);
    insert into production_orders(id,tenant_id,branch_id,product_id,code,created_by,status,planned_qty) values('${nested}','${tenant}','${branch}','${mix}','SX-NESTED','${actor}','planned',100);
    insert into production_order_materials(id,production_order_id,product_id,planned_qty,unit,unit_cost) values
      (gen_random_uuid(),'${nested}','${prepared}',50,'G',0),
      (gen_random_uuid(),'${nested}','${raw}',.01,'Tui',0);`);
  await db.query(`select complete_production_atomic('${nested}',100,'NESTED',current_date,null)`);
  assert.equal(await qty(prepared),preparedBeforeNested-50,'nested batch consumes only measured prepared input');
  assert.ok(Math.abs(await qty(raw)-(rawBeforeNested-.01))<1e-8,'nested BTP never explodes and deducts its raw recipe again');
  assert.equal(await qty(mix),100,'nested batch credits measured output');
  const nestedCost=Number((await db.query(`select cogs_amount from production_orders where id='${nested}'`)).rows[0].cogs_amount);
  const expectedCost=Math.round((50*inputCost+.01*rawCost)*100)/100;
  assert.equal(nestedCost,expectedCost,'nested batch uses branch WAC with the existing two-decimal batch cost convention');
  for(const product of [raw,prepared,mix]) {
    const costed=Number((await db.query(`select costed_quantity from fnb_branch_product_cost_balances where branch_id='${branch}' and product_id='${product}'`)).rows[0].costed_quantity);
    assert.ok(Math.abs(costed-await qty(product))<.0001,'physical and cost quantities agree after nested production');
  }
  await assert.rejects(()=>db.query(`select complete_production_atomic('${nested}',100,'NESTED',current_date,null)`));
  assert.equal(await qty(prepared),preparedBeforeNested-50,'nested replay cannot deduct prepared input twice');
  assert.equal(await qty(mix),100,'nested replay cannot credit output twice');
  console.log('PASS: BTP-to-BTP production, direct input stock, branch WAC, measured output and replay prevention');
  const invalid=crypto.randomUUID();
  await db.exec(`insert into production_orders(id,tenant_id,branch_id,product_id,code,created_by,status,planned_qty) values('${invalid}','${tenant}','${branch}','${prepared}','SX-invalid','${actor}','planned',600);`);
  const before=await qty(raw);
  for(const value of ['0','-1',"'NaN'::numeric"]) await assert.rejects(()=>db.query(`select complete_production_atomic('${invalid}',${value},null,current_date,null)`));
  assert.equal(await qty(raw),before,'invalid yields make no stock changes');
  const outputBefore=await qty(prepared);
  await assert.rejects(()=>db.query(`select complete_production_atomic('${invalid}',600,'EMPTY',current_date,null)`),/FNB_PRODUCTION_MATERIALS_REQUIRED/);
  assert.equal(await qty(prepared),outputBefore,'missing ingredient snapshot never credits prepared stock');
  assert.equal(await qty(raw),before,'missing ingredient snapshot never consumes raw stock');
  await db.exec(`insert into production_order_materials(id,production_order_id,product_id,planned_qty,unit,unit_cost) values(gen_random_uuid(),'${invalid}','${raw}',0,'Tui',12500);`);
  for (const quantity of ['0','-1',"'NaN'::numeric"]) {
    await db.exec(`update production_order_materials set planned_qty=${quantity} where production_order_id='${invalid}'`);
    await assert.rejects(()=>db.query(`select complete_production_atomic('${invalid}',600,'INVALID',current_date,null)`),/FNB_PRODUCTION_MATERIALS_INVALID/);
    assert.equal(await qty(prepared),outputBefore,'invalid ingredients never credit stock');
    assert.equal(await qty(raw),before,'invalid ingredients never consume stock');
  }
  console.log('PASS: empty/invalid prepared ingredient snapshots rejected without stock changes');
  console.log('PASS: under/over standard yield, independent raw consumption and cost, replay prevention, invalid yield rollback. Legacy full-chain assertions passed.');
} catch(error) { console.error(error.message); process.exitCode=1; }
finally {await db.close();fs.rmSync(dir,{recursive:true,force:true});}
