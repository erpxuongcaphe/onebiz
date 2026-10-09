import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'onebiz-fnb-posting-'));
const generated=new Map();
for (const [script,file,args] of [
 ['extract-payment-posting-chain','fnb-payment-posting-chain',[]],
 ['extract-payment-replay-chain','fnb-payment-replay-chain',[]],
 ['extract-supply-cost-flow','fnb-checkout-cost-ledger',['--replace','--ledger-only']],
 ['extract-cost-trigger','fnb-original-cost-trigger',[]],
]) {
 const output=path.join(dir,`${file}.sql`);
 execFileSync(process.execPath,[`scripts/fnb-db-test/${script}.mjs`,output,...args]);
 generated.set(`/tmp/${file}.sql`,output);
}
function expand(file) {
 return fs.readFileSync(file,'utf8').replaceAll('\r\n','\n').replace(/^\\i(r?)\s+(.+)$/gm,(_,relative,target)=>
  expand(generated.get(target.trim())??path.resolve(path.dirname(file),target.trim())))
  .replace(/^\\set.*$/gm,'').replaceAll('current_database()',"'fnb_payment_cost_test'");
}
const db=new PGlite();
try {
 await db.exec('create role anon; create role authenticated; create role service_role;');
 const fixture=expand('supabase/tests/00423_fnb_checkout_cost_ledger.integration.sql')
   .replace(/select 'create role (?:anon|authenticated|service_role) nologin'\s+where not exists \(select 1 from pg_roles where rolname = '(?:anon|authenticated|service_role)'\) \\gexec/g,'');
 const leftover=fixture.split('\n').filter((line)=>/^\\(?:set|i|ir)\s/.test(line));
 if(leftover.length) throw new Error(`Unexpanded psql commands: ${leftover.join('; ')}`);
 try { await db.exec(fixture); } catch(error) {
   if(error.position) console.error(fixture.slice(Number(error.position)-100,Number(error.position)+100));
   throw error;
 }
 await db.exec(`select set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
 insert into products(id,tenant_id,code,name,bom_code,has_bom,inventory_role,stock)
 values('00000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000002','TEST-CUP','Free cup','TEST-CUP-BOM',true,'fnb_menu_item',0);
 insert into bom(id,tenant_id,product_id,code,name)
 values('00000000-0000-0000-0000-000000000032','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000031','TEST-CUP-BOM','Explicit cup recipe');
 insert into bom_items(bom_id,material_id,unit,quantity,sort_order)
 values('00000000-0000-0000-0000-000000000032','00000000-0000-0000-0000-000000000011','kg',.02,0);
 insert into kitchen_order_items(kitchen_order_id,product_id,product_name,quantity,unit_price)
 values('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000031','Free cup',3,0);`);
 const first=(await db.query('select test_pay() result')).rows[0].result;
 const snapshot=async()=>JSON.stringify((await db.query(`select
 (select jsonb_agg(b order by product_id) from branch_stock b) stock,
 (select count(*) from stock_movements) movements,
 (select count(*) from invoices) invoices,
 (select count(*) from fnb_branch_product_cost_events) costs`)).rows[0]);
 const after=await snapshot();
 await db.query('select test_pay()');
 assert.equal(await snapshot(),after,'replayed payment must not consume twice');
 const cup=(await db.query("select quantity,unit_price,unit_cost from invoice_items where product_id='00000000-0000-0000-0000-000000000031'")).rows[0];
 assert.equal(Number(cup.quantity),3); assert.equal(Number(cup.unit_price),0);
 assert.equal(Number(cup.unit_cost),2400,'free cup still carries actual branch cost');
 const out=(await db.query("select sum(quantity) quantity from stock_movements where type='out' and product_id='00000000-0000-0000-0000-000000000011'")).rows[0];
 assert.equal(Number(out.quantity),.12,'three drinks and three explicit cups use their own recipes once');
 assert.ok(first);
 console.log('PASS: actual F&B payment/BOM/branch cost chain; explicit zero-price cups consume stock and cost; replay leaves stock, invoices and cost events unchanged.');
} catch(error) { console.error(error.message,error.where??''); process.exitCode=1; }
finally {await db.close();fs.rmSync(dir,{recursive:true,force:true});}
