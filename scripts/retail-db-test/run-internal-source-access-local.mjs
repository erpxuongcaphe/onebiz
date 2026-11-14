// Isolated PostgreSQL test only; no network or production credentials.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
// Optional read-only export of deployed function definitions: verify exact patch
// compatibility offline without executing any checkout or accessing production.
if(process.argv[3]) {
 const liveDb=new PGlite();
 try {
  const rows=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
  const migration=fs.readFileSync('supabase/migrations/00574_retail_internal_source_authorization.sql','utf8').replaceAll('\r\n','\n');
  const oldGuards=[...migration.matchAll(/\$old\$([\s\S]*?)\$old\$/g)].map(m=>m[1]);
  const newGuards=[...migration.matchAll(/\$new\$([\s\S]*?)\$new\$/g)].map(m=>m[1]);
  const deployed=migration.match(/\$deployed\$([\s\S]*?)\$deployed\$/)[1];
  await liveDb.exec('set check_function_bodies=off;');
  for(const row of rows)await liveDb.exec(row.definition);
  const before=(await liveDb.query(`select proname,pg_get_functiondef(oid) definition from pg_proc where proname in ('checkout_internal_pos_v2','_create_internal_sale_auth_impl_00243')`)).rows;
  await liveDb.exec(migration);await liveDb.exec(migration);
  for(const row of before) {
   const index=row.proname==='checkout_internal_pos_v2'?0:1;
   const guard=row.definition.includes(oldGuards[index])?oldGuards[index]:deployed;
   assert.equal(row.definition.split(guard).length-1,1);
   const actual=(await liveDb.query('select pg_get_functiondef(oid) definition from pg_proc where proname=$1',[row.proname])).rows[0].definition;
   assert.equal(actual,row.definition.replace(guard,newGuards[index]));
  }
  console.log('PASS deployed definitions: both exact live functions patched offline; all code outside authorization guards preserved; repeat migration safe.');
 } finally {await liveDb.close();}
}
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

 await db.exec(`alter table branches add column is_active boolean default true, add column branch_type text default 'store';
 alter table customers add column is_active boolean default true;
 alter table invoices add column amount_tendered numeric, add column delivery_fee numeric;
 create function verify_otp_authorization(uuid,text,uuid,uuid) returns uuid language sql as 'select $3';`);
 await db.exec(fs.readFileSync('supabase/migrations/00470_internal_pos_payment_and_precision.sql','utf8'));
 const ctx=(await db.query(`select p.id actor,p.tenant_id,c.id customer,c.branch_id dest,pr.id product,pr.unit
 from profiles p cross join customers c cross join products pr join fnb_supply_catalog catalog on catalog.product_id=pr.id
 where pr.inventory_role <> 'fnb_menu_item' limit 1`)).rows[0];
 const source='20000000-0000-0000-0000-000000000001';
 await db.exec(`create table retail_test_access(user_id uuid,branch_id uuid);
 create table retail_test_permission(allowed boolean); insert into retail_test_permission values(true);
 create or replace function public.user_has_branch_access(uuid,uuid) returns boolean language sql stable as
 $$select exists(select 1 from retail_test_access where user_id=$1 and branch_id=$2)$$;
 create or replace function public.user_has_permission(uuid,text) returns boolean language sql stable as
 $$select coalesce((select allowed from retail_test_permission),false)$$;`);
 await db.query('insert into retail_test_access values($1,$2)',[ctx.actor,source]);
 await db.query("update branches set branch_type='warehouse' where id=$1",[source]);
 let serial=10, checks=0;
 const payload=()=>({branchId:source,customerId:ctx.customer,
 items:[{productId:ctx.product,unit:ctx.unit,quantity:.1,unitPrice:100,vatRate:0,discount:0}],
 payments:[],amountTendered:0,orderDiscount:0,orderVatRate:0,shippingFee:0,expectedTotal:10,
 discountOtpId:null,sessionId:`91000000-0000-0000-0000-${String(++serial).padStart(12,'0')}`,
 shiftId:'90000000-0000-0000-0000-000000000001',draftId:null,revision:null,note:'warehouse-only actor test'});
 const call=p=>db.query('select public.checkout_internal_pos_v2($1::jsonb) result',[JSON.stringify(p)]);
 const snapshot=async()=> (await db.query(`select jsonb_object_agg(t.name,t.rows) snapshot from (
 ${['profiles','branches','customers','retail_test_access','internal_sales','invoices','invoice_items','input_invoices','cash_transactions','branch_stock','stock_movements'].map(t=>`select '${t}' name,coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) rows from public.${t} r`).join(' union all ')}
 )t`)).rows[0].snapshot;
 await assert.rejects(call(payload()),/INTERNAL_POS_CUSTOMER_INVALID/); checks++;
 const defs=async()=> (await db.query(`select jsonb_object_agg(proname,md5(pg_get_functiondef(p.oid))) defs from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.prokind='f' and (p.proname like '%fnb%' or p.proname in ('create_internal_sale_atomic','_create_internal_sale_catalog_impl_00390','consume_bom_for_sale','internal_sale_apply_stock_out','user_has_branch_access','user_has_permission'))`)).rows[0].defs;
 const primitiveArgs=[ctx.tenant_id,source,ctx.dest,ctx.actor,null,'XTB',null,'Retail',JSON.stringify([{productId:ctx.product,quantity:.1,unitPrice:100}]),'debt',false,null];
 const primitive=a=>db.query('select public._create_internal_sale_auth_impl_00243($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12) result',a);
 await assert.rejects(primitive(primitiveArgs),/BRANCH_ACCESS_DENIED/);checks++;
 const before=await snapshot(), fnbBefore=await defs();
 const migration=fs.readFileSync('supabase/migrations/00574_retail_internal_source_authorization.sql','utf8');
 const original=(await db.query(`select pg_get_functiondef('public.checkout_internal_pos_v2(jsonb)'::regprocedure) checkout,
 pg_get_functiondef('public._create_internal_sale_auth_impl_00243(uuid,uuid,uuid,uuid,uuid,text,uuid,text,jsonb,text,boolean,text)'::regprocedure) primitive`)).rows[0];
 await db.exec(original.primitive.replaceAll('BRANCH_ACCESS_DENIED','GUARD_CHANGED_FOR_TEST'));
 await assert.rejects(db.exec(migration),/ATOMIC_GUARD_CHANGED/); await db.exec('rollback;');checks++;
 assert.equal((await db.query("select pg_get_functiondef('public.checkout_internal_pos_v2(jsonb)'::regprocedure) d")).rows[0].d,original.checkout);checks++;
 await db.exec(original.primitive);
 // Production can contain the same guard with single-space indentation.
 const deployedPrimitive=original.primitive.replace(/^[ \t]+/gm,' ');
 await db.exec(deployedPrimitive);
 await db.exec(migration);await db.exec(migration);
 assert.match((await db.query("select pg_get_functiondef('public._create_internal_sale_auth_impl_00243(uuid,uuid,uuid,uuid,uuid,text,uuid,text,jsonb,text,boolean,text)'::regprocedure) d")).rows[0].d,/retail_internal_source_00574/);checks++;
 assert.deepEqual(await snapshot(),before);checks++;
 assert.deepEqual(await defs(),fnbBefore);checks++;
 await db.exec(original.checkout);await db.exec(original.primitive);
 await db.exec(migration); await db.exec(migration);
 assert.deepEqual(await snapshot(),before);checks++;
 assert.deepEqual(await defs(),fnbBefore);checks++;
 const p=payload();const first=(await call(p)).rows[0].result;
 assert.ok(first.invoice_id && first.input_invoice_id && first.internal_sale_id);checks++;
 assert.equal((await call(p)).rows[0].result.internal_sale_id,first.internal_sale_id);checks++;
 assert.equal((await db.query('select user_has_branch_access($1,$2) allowed',[ctx.actor,ctx.dest])).rows[0].allowed,false);checks++;
 assert.equal(Number((await db.query('select total from invoices where id=$1',[first.invoice_id])).rows[0].total),10);checks++;
 const cashPayload={...payload(),payments:[{method:'cash',amount:10}],amountTendered:10};
 const cashResult=(await call(cashPayload)).rows[0].result;
 const cashInvoice=(await db.query('select paid,debt from invoices where id=$1',[cashResult.invoice_id])).rows[0];
 assert.equal(Number(cashInvoice.paid),10);assert.equal(Number(cashInvoice.debt),0);checks+=2;
 const cashRows=(await db.query('select branch_id,type,sum(amount) amount from cash_transactions where reference_id in ($1,$2) group by branch_id,type',[cashResult.invoice_id,cashResult.input_invoice_id])).rows;
 assert.equal(cashRows.length,2);assert.ok(cashRows.every(r=>Number(r.amount)===10));checks+=2;
 const spoofBefore=await snapshot();await assert.rejects(primitive(primitiveArgs.map((x,i)=>i===3?'40000000-0000-0000-0000-000000000099':x)),/ACTOR_SPOOF_BLOCKED/);assert.deepEqual(await snapshot(),spoofBefore);checks+=2;
 async function deny(p,pattern){const s=await snapshot();await assert.rejects(call(p),pattern);assert.deepEqual(await snapshot(),s);checks+=2;}
 await deny({...payload(),branchId:ctx.dest},/PERMISSION_DENIED/);
 await db.exec('update retail_test_permission set allowed=false');
 await deny(payload(),/PERMISSION_DENIED/);await db.exec('update retail_test_permission set allowed=true');
 await db.query('update profiles set is_active=false where id=$1',[ctx.actor]);
 await deny(payload(),/PERMISSION_DENIED/);await db.query('update profiles set is_active=true where id=$1',[ctx.actor]);
 await db.query('update customers set is_active=false where id=$1',[ctx.customer]);
 await deny(payload(),/CUSTOMER_INVALID/);await db.query('update customers set is_active=true where id=$1',[ctx.customer]);
 await db.query('update customers set is_internal=false where id=$1',[ctx.customer]);
 await deny(payload(),/CUSTOMER_INVALID/);await db.query('update customers set is_internal=true where id=$1',[ctx.customer]);
 await db.query('update branches set is_active=false where id=$1',[ctx.dest]);
 await deny(payload(),/CUSTOMER_INVALID/);await db.query('update branches set is_active=true where id=$1',[ctx.dest]);
 await db.query("update customers set tenant_id='10000000-0000-0000-0000-000000000099' where id=$1",[ctx.customer]);
 await deny(payload(),/CUSTOMER_INVALID/);await db.query('update customers set tenant_id=$1 where id=$2',[ctx.tenant_id,ctx.customer]);
 await db.query('update customers set branch_id=$1 where id=$2',[source,ctx.customer]);
 await deny(payload(),/CUSTOMER_INVALID/);await db.query('update customers set branch_id=$1 where id=$2',[ctx.dest,ctx.customer]);
 await db.query("update branches set branch_type='store' where id=$1",[source]);
 await deny(payload(),/CUSTOMER_INVALID/);await db.query("update branches set branch_type='warehouse' where id=$1",[source]);
 await deny({...payload(),expectedTotal:11},/POS_CART_TOTAL_CHANGED/);
 assert.deepEqual(await defs(),fnbBefore);checks++;
 // Staff notes must survive the real internal-sale checkout chain.
 const oldInvoice=(await db.query('select note from invoices where id=$1',[first.invoice_id])).rows[0].note;
 assert.match(oldInvoice,/Ban noi bo/);checks++;
 const beforeNotes=await snapshot();
 const notesMigration=fs.readFileSync('supabase/migrations/00575_retail_internal_staff_notes.sql','utf8');
 await db.exec(notesMigration);await db.exec(notesMigration);
 assert.deepEqual(await snapshot(),beforeNotes);checks++;
 assert.deepEqual(await defs(),fnbBefore);checks++;
 for(const [label,note,expected] of [
  ['omitted',undefined,null],['empty','',null],['null',null,null],['spaces','   ',null],
  ['staff','Giao sau 15h, gọi kho trước khi đến.','Giao sau 15h, gọi kho trước khi đến.'],
  ['verbatim',"  Dòng 1: O'Brien\nDòng 2: giữ nguyên  ","  Dòng 1: O'Brien\nDòng 2: giữ nguyên  "],
  ['staff prefix','Ban noi bo do nhân viên tự ghi','Ban noi bo do nhân viên tự ghi'],
 ]) {
  const request={...payload(),note};
  const result=(await call(request)).rows[0].result;
  const inv=(await db.query('select note,total,paid,debt from invoices where id=$1',[result.invoice_id])).rows[0];
  const input=(await db.query('select note,total_amount from input_invoices where id=$1',[result.input_invoice_id])).rows[0];
  assert.equal(inv.note,expected,label+' sales note');checks++;
  assert.equal(input.note,expected,label+' paired note');checks++;
  assert.equal(Number(inv.total),10);assert.equal(Number(inv.paid),0);assert.equal(Number(inv.debt),10);
  assert.equal(Number(input.total_amount),10);checks+=4;
  const beforeReplay=await snapshot();
  assert.equal((await call(request)).rows[0].result.internal_sale_id,result.internal_sale_id);
  assert.deepEqual(await snapshot(),beforeReplay);checks+=2;
 }
 assert.equal((await db.query('select note from invoices where id=$1',[first.invoice_id])).rows[0].note,oldInvoice);checks++;
 await deny({...payload(),expectedTotal:11,note:'Không được lưu ghi chú đơn lỗi'},/POS_CART_TOTAL_CHANGED/);
 assert.deepEqual(await defs(),fnbBefore);checks++;
 console.log(`PASS ${checks}: reproduced warehouse-only failure; real checkout and paired documents succeed after patch; replay safe; destination access remains false; source permission, tenant, customer, branch and totals guards retained; rejected requests rollback; F&B/stock/cost functions unchanged; migration idempotent and data unchanged.`);
} finally { await db.close(); fs.rmSync(dir,{recursive:true,force:true}); }
