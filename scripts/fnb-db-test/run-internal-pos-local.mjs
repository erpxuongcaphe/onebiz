import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'onebiz-internal-pos-'));
const generated=new Map();
for(const name of ['internal-sale-stock-out','internal-sale-documents','supply-cost-flow']) {
 const file=path.join(dir,`${name}.sql`);
 execFileSync(process.execPath,[`scripts/fnb-db-test/extract-${name}.mjs`,file]);
 generated.set(`/tmp/fnb-${name}.sql`,file);
}
function expand(file) {return fs.readFileSync(file,'utf8').replace(/^\\i(r?)\s+(.+)$/gm,(_,relative,target)=>expand(generated.get(target.trim())??path.resolve(path.dirname(file),target.trim()))).replace(/^\\set.*$/gm,'');}
const db=new PGlite();
try {
 await db.exec('create role anon; create role authenticated;');
 await db.exec(expand('supabase/tests/00419_fnb_internal_sale_complete_chain.integration.sql'));
 await db.exec(`alter table invoices add column client_session_id uuid, add column shift_id uuid, add column draft_revision bigint default 0;
 alter table cash_transactions add column shift_id uuid;
 create table shifts(id uuid,tenant_id uuid,branch_id uuid,cashier_id uuid,status text);
 create function resolve_product_uom_factor(uuid,uuid,text) returns numeric language sql as 'select 1::numeric';
 insert into shifts select '90000000-0000-0000-0000-000000000001',p.tenant_id,'20000000-0000-0000-0000-000000000001',p.id,'open' from profiles p;`);
 await db.exec(fs.readFileSync('supabase/migrations/00466_internal_pos_checkout.sql','utf8'));
 const context=(await db.query(`select p.id actor,p.tenant_id,c.id customer,c.branch_id dest,pr.id product,pr.unit from profiles p cross join customers c cross join products pr join fnb_supply_catalog catalog on catalog.product_id=pr.id where pr.inventory_role <> 'fnb_menu_item' limit 1`)).rows[0];
 assert.ok(context);
 const args=`'20000000-0000-0000-0000-000000000001','${context.customer}',
 '${JSON.stringify([{productId:context.product,unit:context.unit,quantity:.1,unitPrice:100,vatRate:0}])}'::jsonb,
 'debt',10,'91000000-0000-0000-0000-000000000001',null,null,'90000000-0000-0000-0000-000000000001',null`;
 const before=Number((await db.query('select count(*) n from internal_sales')).rows[0].n);
 const first=(await db.query(`select checkout_internal_pos_atomic(${args}) result`)).rows[0].result;
 const replay=(await db.query(`select checkout_internal_pos_atomic(${args}) result`)).rows[0].result;
 assert.equal(first.internal_sale_id,replay.internal_sale_id);
 assert.equal(Number((await db.query('select count(*) n from internal_sales')).rows[0].n),before+1);
 const invoice=(await db.query(`select source,shift_id,paid,debt from invoices where id='${first.invoice_id}'`)).rows[0];
 assert.equal(invoice.source,'internal'); assert.equal(Number(invoice.paid),0); assert.equal(Number(invoice.debt),10);
 assert.ok(invoice.shift_id);
 await assert.rejects(db.query(`select checkout_internal_pos_atomic(${args.replace("'debt',10,", "'cash',10,")})`), /INTERNAL_POS_SESSION_PAYLOAD_MISMATCH/);
 assert.equal(Number((await db.query('select count(*) n from internal_sales')).rows[0].n),before+1);
 console.log('PASS: established internal document/stock/cost chain; POS debt checkout, shift linkage and replay without duplicate stock.');
} catch(error) { console.error(error.message,error.where??''); process.exitCode=1; }
finally {await db.close();fs.rmSync(dir,{recursive:true,force:true});}
