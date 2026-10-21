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
 await db.exec(`alter table invoices add column amount_tendered numeric, add column delivery_fee numeric;
 create function verify_otp_authorization(uuid,text,uuid,uuid) returns uuid language plpgsql as $$ begin
 if $1 is null then raise exception 'OTP_ID_REQUIRED'; end if; return $3; end $$;`);
 await db.exec(fs.readFileSync('supabase/migrations/00470_internal_pos_payment_and_precision.sql','utf8'));
 const payload={branchId:'20000000-0000-0000-0000-000000000001',customerId:context.customer,
  items:[{productId:context.product,unit:context.unit,quantity:.1234,unitPrice:100000,vatRate:10,discount:100}],
  orderDiscount:234,orderVatRate:0,shippingFee:50,expectedTotal:13250,
  payments:[{method:'cash',amount:2000},{method:'transfer',amount:3000}],amountTendered:5000,
  discountOtpId:'92000000-0000-0000-0000-000000000001',sessionId:'91000000-0000-0000-0000-000000000002',
  shiftId:'90000000-0000-0000-0000-000000000001',draftId:null,revision:null,note:'test partial paired payment'};
 // 12340 - 100 - 234 = 12006; VAT 1201; fee 50 = 13257.
 payload.expectedTotal=13257;
 const call=p=>`select checkout_internal_pos_v2('${JSON.stringify(p)}'::jsonb) result`;
 const stockBeforeUpgrade=(await db.query('select tenant_id,branch_id,product_id,quantity from branch_stock order by branch_id,product_id')).rows;
 const costBeforeUpgrade=(await db.query('select branch_id,product_id,costed_quantity,total_cost,unit_cost from fnb_branch_product_cost_balances order by branch_id,product_id')).rows;
 const upgraded=(await db.query(call(payload))).rows[0].result;
 const inv=(await db.query(`select * from invoices where id='${upgraded.invoice_id}'`)).rows[0];
 assert.equal(Number(inv.total),13257); assert.equal(Number(inv.paid),5000); assert.equal(Number(inv.debt),8257);
 assert.equal(Number(inv.discount_amount),334); assert.equal(inv.payment_method,'mixed');
 assert.equal(Number((await db.query(`select quantity from invoice_items where invoice_id='${upgraded.invoice_id}'`)).rows[0].quantity),.1234);
 const cash=(await db.query(`select branch_id,type,sum(amount) amount from cash_transactions where reference_id in ('${upgraded.invoice_id}','${upgraded.input_invoice_id}') group by branch_id,type`)).rows;
 assert.equal(cash.length,2); assert.ok(cash.every(r=>Number(r.amount)===5000));
 assert.equal((await db.query(call(payload))).rows[0].result.internal_sale_id,upgraded.internal_sale_id);
 await assert.rejects(db.query(call({...payload, payments:[{method:'cash',amount:14000}],sessionId:'91000000-0000-0000-0000-000000000003'})),/PAYMENT_EXCEEDS_TOTAL/);
 await assert.rejects(db.query(call({...payload, discountOtpId:null,sessionId:'91000000-0000-0000-0000-000000000004'})),/OTP_ID_REQUIRED/);
 await assert.rejects(db.query(call({...payload,expectedTotal:1,sessionId:'91000000-0000-0000-0000-000000000005'})),/POS_CART_TOTAL_CHANGED/);
 console.log('PASS: four-decimal quantities; line/bill discounts, VAT, partial mixed payments paired across branches, debt balance, replay and invalid payload rollback.');
 const invoice=(await db.query(`select source,shift_id,paid,debt from invoices where id='${first.invoice_id}'`)).rows[0];
 assert.equal(invoice.source,'internal'); assert.equal(Number(invoice.paid),0); assert.equal(Number(invoice.debt),10);
 assert.ok(invoice.shift_id);
 await assert.rejects(db.query(`select checkout_internal_pos_atomic(${args.replace("'debt',10,", "'cash',10,")})`), /INTERNAL_POS_SESSION_PAYLOAD_MISMATCH/);
 assert.equal(Number((await db.query('select count(*) n from internal_sales')).rows[0].n),before+2);
 await db.exec(`alter table stock_movements add column id uuid default gen_random_uuid();
 alter table branch_stock add column variant_id uuid;
 alter table internal_sales add column updated_at timestamptz default now();
 alter table audit_log add column old_data jsonb;
 create table sales_returns(id uuid default gen_random_uuid(),invoice_id uuid,status text);`);
 const cancelSource=fs.readFileSync('supabase/migrations/00289_atomic_input_invoice_internal_sale_state.sql','utf8');
 const cancelFunction=cancelSource.match(/create or replace function public\.cancel_internal_sale_atomic\([\s\S]*?\n\$\$;/)[0];
 await db.exec(cancelFunction);
 await db.exec(fs.readFileSync('supabase/migrations/00471_internal_sale_paired_reversal.sql','utf8'));
 await assert.rejects(db.query(`update invoices set status='cancelled' where id='${upgraded.invoice_id}'`),/USE_PAIRED_REVERSAL/);
 await assert.rejects(db.query(`insert into sales_returns(invoice_id,status) values('${upgraded.invoice_id}','completed')`),/USE_PAIRED_REVERSAL/);
 const cancelled=(await db.query(`select cancel_internal_sale_atomic('${upgraded.internal_sale_id}','Kiểm thử đảo cặp chứng từ') result`)).rows[0].result;
 assert.equal(cancelled.status,'cancelled'); assert.equal(Number(cancelled.reversed_cash),5000);
 await assert.rejects(db.query(call(payload)),/SESSION_ALREADY_CLOSED/);
 await assert.rejects(db.query(`update input_invoices set status='cancelled' where id='${first.input_invoice_id}'`),/USE_PAIRED_REVERSAL/);
 assert.deepEqual((await db.query('select tenant_id,branch_id,product_id,quantity from branch_stock order by branch_id,product_id')).rows,stockBeforeUpgrade);
 assert.deepEqual((await db.query('select branch_id,product_id,costed_quantity,total_cost,unit_cost from fnb_branch_product_cost_balances order by branch_id,product_id')).rows,costBeforeUpgrade);
 assert.equal((await db.query(`select status from input_invoices where id='${upgraded.input_invoice_id}'`)).rows[0].status,'cancelled');
 assert.equal(Number((await db.query(`select debt from invoices where id='${upgraded.invoice_id}'`)).rows[0].debt),0);
 const refunded=(await db.query(`select sum(case when type='receipt' then amount else -amount end) net from cash_transactions where reference_id in('${upgraded.invoice_id}','${upgraded.input_invoice_id}','${upgraded.internal_sale_id}')`)).rows[0];
 assert.equal(Number(refunded.net),0);
 const reversalCount=Number((await db.query(`select count(*) n from stock_movements where reference_type='internal_sale_cancel'`)).rows[0].n);
 await db.query(`select cancel_internal_sale_atomic('${upgraded.internal_sale_id}','Kiểm thử gọi lại')`);
 assert.equal(Number((await db.query(`select count(*) n from stock_movements where reference_type='internal_sale_cancel'`)).rows[0].n),reversalCount);
 const fractional={...payload,items:[{productId:context.product,unit:context.unit,quantity:.1234,unitPrice:100,vatRate:0,discount:0}],
  orderDiscount:0,shippingFee:0,expectedTotal:12,payments:[{method:'card',amount:12}],amountTendered:12,sessionId:'91000000-0000-0000-0000-000000000006'};
 const fractionalResult=(await db.query(call(fractional))).rows[0].result;
 const fractionalLine=(await db.query(`select quantity,total from invoice_items where invoice_id='${fractionalResult.invoice_id}'`)).rows[0];
 assert.equal(Number(fractionalLine.quantity),.1234); assert.equal(Number(fractionalLine.total),12);
 await assert.rejects(db.query(call({...fractional,amountTendered:0,sessionId:'91000000-0000-0000-0000-000000000007'})),/TENDERED_INVALID/);
 console.log('PASS: fractional quantities are retained while VND line totals and paired receipt cost round consistently.');
 console.log('PASS: paired completed cancellation restores actual stock in both branches, reverses paired cash, clears debt, retains documents, blocks one-sided void/return and is idempotent.');
 console.log('PASS: established internal document/stock/cost chain; POS debt checkout, shift linkage and replay without duplicate stock.');
 await db.exec(`create table tenant_settings(tenant_id uuid,key text,value jsonb);
 create function get_tenant_setting(uuid,text,jsonb) returns jsonb language sql as $$
 select coalesce((select value from tenant_settings where tenant_id=$1 and key=$2),$3) $$;`);
 const policySource=fs.readFileSync('supabase/migrations/00473_branch_negative_sale_policy.sql','utf8');
 await db.exec('drop function public._allow_negative_sale_00473(uuid,uuid)');
 await db.exec(policySource.match(/create function public\._allow_negative_sale_00473\([\s\S]*?\n\$\$;/)[0]);
 const stockPolicyBefore=(await db.query('select * from branch_stock order by branch_id,product_id')).rows;
 await db.exec(fs.readFileSync('supabase/migrations/00569_internal_pos_branch_stock_policy.sql','utf8').replace(/\r?\n/g,'\r\n'));
 assert.deepEqual((await db.query('select * from branch_stock order by branch_id,product_id')).rows,stockPolicyBefore);
 // Direct-stock fixture: the source policy must not be confused with the outlet's.
 await db.exec(`update products set has_bom=false where id='${context.product}';
 insert into tenant_settings values ('${context.tenant_id}','allow_negative_stock','true'),
 ('${context.tenant_id}','allow_negative_stock:20000000-0000-0000-0000-000000000001','false'),
 ('${context.tenant_id}','allow_negative_stock:${context.dest}','true');`);
 const sourceQty=Number((await db.query(`select coalesce(sum(quantity),0) n from branch_stock where branch_id='${payload.branchId}' and product_id='${context.product}'`)).rows[0].n);
 const destinationQty=Number((await db.query(`select coalesce(sum(quantity),0) n from branch_stock where branch_id='${context.dest}' and product_id='${context.product}'`)).rows[0].n);
 const shortageQty=Math.max(0,sourceQty)+2;
 const shortage={...fractional,items:[{productId:context.product,unit:context.unit,quantity:shortageQty,unitPrice:100,vatRate:0,discount:0}],
 expectedTotal:shortageQty*100,payments:[],amountTendered:0,sessionId:'91000000-0000-0000-0000-000000000008'};
 const snapshot=async()=>(await db.query(`select jsonb_build_object('stock',(select jsonb_agg(b order by branch_id,product_id) from branch_stock b),'invoices',(select count(*) from invoices),'sales',(select count(*) from internal_sales),'cash',(select count(*) from cash_transactions),'movements',(select count(*) from stock_movements)) state`)).rows[0].state;
 const blockedBefore=await snapshot();
 await assert.rejects(db.query(call(shortage)),/INTERNAL_POS_INSUFFICIENT_STOCK/);
 assert.deepEqual(await snapshot(),blockedBefore);
 await db.exec(`update tenant_settings set value='true' where key='allow_negative_stock:${payload.branchId}';
 update tenant_settings set value='false' where key='allow_negative_stock:${context.dest}';`);
 const negativeSale=(await db.query(call(shortage))).rows[0].result;
 assert.equal(Number((await db.query(`select sum(quantity) n from branch_stock where branch_id='${payload.branchId}' and product_id='${context.product}'`)).rows[0].n),sourceQty-shortageQty);
 assert.equal(Number((await db.query(`select sum(quantity) n from branch_stock where branch_id='${context.dest}' and product_id='${context.product}'`)).rows[0].n),destinationQty+shortageQty);
 const allowedAfter=await snapshot();
 assert.equal((await db.query(call(shortage))).rows[0].result.internal_sale_id,negativeSale.internal_sale_id);
 assert.deepEqual(await snapshot(),allowedAfter);
 const debtInvoice=(await db.query(`select total,paid,debt from invoices where id='${negativeSale.invoice_id}'`)).rows[0];
 assert.equal(Number(debtInvoice.total),shortage.expectedTotal);
 assert.equal(Number(debtInvoice.paid),0); assert.equal(Number(debtInvoice.debt),shortage.expectedTotal);
 await db.exec(`delete from tenant_settings where key='allow_negative_stock:${payload.branchId}';
 update tenant_settings set value='false' where key='allow_negative_stock';`);
 const fallbackBefore=await snapshot();
 await assert.rejects(db.query(call({...shortage,sessionId:'91000000-0000-0000-0000-000000000009'})),/INTERNAL_POS_INSUFFICIENT_STOCK/);
 assert.deepEqual(await snapshot(),fallbackBefore);
 await db.exec(`update tenant_settings set value='true' where key='allow_negative_stock';`);
 const fallbackAllowed=(await db.query(call({...shortage,sessionId:'91000000-0000-0000-0000-000000000010'}))).rows[0].result;
 assert.ok(fallbackAllowed.invoice_id);
 await assert.rejects(db.exec(fs.readFileSync('supabase/migrations/00569_internal_pos_branch_stock_policy.sql','utf8')),/INTERNAL_POS_STOCK_POLICY_PATCH_MISMATCH/);
 await db.exec('rollback');
 console.log('PASS: internal POS honors source-branch negative-stock policy, rolls back blocked checkout, retains paired stock/debt and replays without duplicates.');
 // Reproduce the cashier's race: autosave has acknowledged revision 2,
 // but the click handler still holds revision 1 from the earlier render.
 const draftId='93000000-0000-0000-0000-000000000001';
 const draftSession='91000000-0000-0000-0000-000000000011';
 await db.query(`insert into invoices(id,tenant_id,branch_id,code,status,source,client_session_id,draft_revision,total,created_by)
 values($1,$2,$3,'DRAFT-HANDOFF','draft','pos',$4,2,10,$5)`,[draftId,context.tenant_id,payload.branchId,draftSession,context.actor]);
 const handedOff={...fractional,items:[{productId:context.product,unit:context.unit,quantity:.1,unitPrice:100,vatRate:0,discount:0}],
 expectedTotal:10,payments:[],amountTendered:0,sessionId:draftSession,draftId,revision:1};
 const beforeConflict=await snapshot();
 await assert.rejects(db.query(call(handedOff)),/POS_DRAFT_CONFLICT/);
 assert.deepEqual(await snapshot(),beforeConflict,'stale revision cannot alter documents, stock or money');
 assert.equal(Number((await db.query('select draft_revision from invoices where id=$1',[draftId])).rows[0].draft_revision),2);
 await assert.rejects(db.query(call({...handedOff,revision:null})),/POS_DRAFT_CONFLICT/);
 await assert.rejects(db.query(call({...handedOff,revision:2,sessionId:'91000000-0000-0000-0000-000000000012'})),/POS_DRAFT_CONFLICT/);
 assert.deepEqual(await snapshot(),beforeConflict);
 const completedDraft=(await db.query(call({...handedOff,revision:2}))).rows[0].result;
 assert.equal((await db.query('select count(*)::int n from invoices where id=$1',[draftId])).rows[0].n,0);
 assert.equal((await db.query('select source from invoices where id=$1',[completedDraft.invoice_id])).rows[0].source,'internal');
 assert.ok((await db.query('select id from input_invoices where id=$1',[completedDraft.input_invoice_id])).rows[0]);
 const afterHandoff=await snapshot();
 assert.equal((await db.query(call({...handedOff,revision:2}))).rows[0].result.invoice_id,completedDraft.invoice_id);
 assert.deepEqual(await snapshot(),afterHandoff,'same acknowledged checkout replays without duplicate export/import');
 console.log('PASS: stale/missing/foreign-session draft revisions reject atomically; acknowledged revision completes paired internal documents and replays once.');

} catch(error) { console.error(error.message,error.where??''); process.exitCode=1; }
finally {await db.close();fs.rmSync(dir,{recursive:true,force:true});}
