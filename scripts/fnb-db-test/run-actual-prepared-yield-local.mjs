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
  const invalid=crypto.randomUUID();
  await db.exec(`insert into production_orders(id,tenant_id,branch_id,product_id,code,created_by,status,planned_qty) values('${invalid}','${tenant}','${branch}','${prepared}','SX-invalid','${actor}','planned',600);`);
  const before=await qty(raw);
  for(const value of ['0','-1',"'NaN'::numeric"]) await assert.rejects(()=>db.query(`select complete_production_atomic('${invalid}',${value},null,current_date,null)`));
  assert.equal(await qty(raw),before,'invalid yields make no stock changes');
  console.log('PASS: under/over standard yield, independent raw consumption and cost, replay prevention, invalid yield rollback. Legacy full-chain assertions passed.');
} catch(error) { console.error(error.message); process.exitCode=1; }
finally {await db.close();fs.rmSync(dir,{recursive:true,force:true});}
