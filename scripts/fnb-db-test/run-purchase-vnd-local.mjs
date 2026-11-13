// Isolated synthetic PostgreSQL. No production connection or print commands.
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
const {PGlite}=createRequire(process.argv[2]||import.meta.url)('@electric-sql/pglite');
const fixture=join(tmpdir(),`purchase-vnd-${process.pid}.sql`);
execFileSync(process.execPath,['scripts/fnb-db-test/extract-warehouse-change-fixture.mjs',fixture]);
const db=new PGlite();
await db.exec(readFileSync(fixture,'utf8'));
await db.exec(readFileSync('supabase/migrations/00346_purchase_order_save_replay_safe.sql','utf8'));
await db.exec(readFileSync('supabase/migrations/20261028044450_supplier_purchase_line_notes.sql','utf8'));
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
await db.exec(`select set_config('test.actor','${id(2)}',false); select set_config('test.branch','${id(3)}',false); update products set unit='Cái' where id='${id(7)}';`);
const save=async(code,items,extra={})=>(await db.query(`select save_purchase_order_with_uom_atomic_v2(null,$1,$2,$3,null,$4,$5,$6,0,'cash',false,false,$7::jsonb) result`,[code,id(3),id(5),extra.shipping??0,extra.other??0,extra.discount??0,JSON.stringify(items)])).rows[0].result;
let useNearest=false;
const line=(n,quantity,unit_price,vat_rate=0,discount=0)=>({product_id:id(n),quantity,unit_price,vat_rate,discount,unit:'Cái',...(useNearest?{money_rounding:'nearest_vnd_v1'}:{})});
const old=await save('PO-OLD',[line(7,6,4666.67)]);
assert.equal(Number(old.total),28001);
const snapshot=JSON.stringify((await db.query('select * from purchase_orders order by id')).rows);
const metadata=()=>db.query("select oid,proowner,proacl,prosecdef,proconfig from pg_proc where oid='save_purchase_order_atomic(uuid,text,uuid,uuid,text,numeric,numeric,numeric,numeric,text,boolean,boolean,jsonb)'::regprocedure");
const before=(await metadata()).rows;
const original=(await db.query("select pg_get_functiondef('save_purchase_order_atomic(uuid,text,uuid,uuid,text,numeric,numeric,numeric,numeric,text,boolean,boolean,jsonb)'::regprocedure) definition")).rows[0].definition;
await db.exec(readFileSync('supabase/migrations/20261103073302_supplier_purchase_vnd_nearest.sql','utf8'));
assert.equal(JSON.stringify((await db.query('select * from purchase_orders order by id')).rows),snapshot);
assert.deepEqual((await metadata()).rows,before);
assert.equal(Number((await save('PO-OLD-BROWSER',[line(7,6,4666.67)])).total),28001);
useNearest=true;
const apple=await save('PO-APPLE',[line(7,6,4666.67)]);
assert.equal(Number(apple.total),28000);
const guava=await save('PO-GUAVA',[line(7,3,5333.33)]);
assert.equal(Number(guava.total),16000);
const melon=await save('PO-MELON',[line(7,2,17000)]);
const carrot=await save('PO-CARROT',[line(7,5,3600)]);
assert.equal([apple,guava,melon,carrot].reduce((sum,r)=>sum+Number(r.total),0),96000);
assert.equal(Number((await save('PO-HALF',[line(7,1.5,15,10)])).total),25);
assert.equal(Number((await save('PO-DISCOUNT',[line(7,1.5,15,10,3)])).total),22);
assert.equal(Number((await save('PO-FEES',[line(7,3,5333.33)],{shipping:1000,other:500,discount:100})).total),17400);
assert.equal(Number((await save('PO-FRACTION-FEES',[line(7,3,5333.33)],{shipping:1000.49,other:500.5,discount:100.5})).total),17400);
await assert.rejects(()=>save('PO-NEGATIVE-FEE',[line(7,1,100)],{shipping:-0.1}),/PURCHASE_ORDER_AMOUNT_INVALID/);
await assert.rejects(()=>db.query(`select save_purchase_order_with_uom_atomic_v2(null,'PO-OVERPAY',$1,$2,null,0,0,0,28001,'cash',false,true,$3::jsonb)`,[id(3),id(5),JSON.stringify([line(7,6,4666.67)])]),/PAID_AMOUNT_EXCEEDS_TOTAL/);
assert.equal((await save('PO-APPLE',[line(7,6,4666.67)])).idempotent,true);
assert.equal((await db.query("select count(*)::int n from purchase_orders where code='PO-APPLE'")).rows[0].n,1);
// A conversion changes stock quantity/price, never the rounded supplier line value.
await db.exec(`insert into uom_conversions values('${id(1)}','${id(7)}',true,'Cái','G',1000);`);
const uom=await save('PO-UOM',[{...line(7,3000,13.33333333),unit:'G'}]);
assert.equal(Number(uom.total),40000);
const stored=(await db.query('select transaction_quantity,quantity,transaction_unit_price,total from purchase_order_items where purchase_order_id=$1',[uom.purchase_order_id])).rows[0];
assert.equal(Number(stored.transaction_quantity),3000);assert.equal(Number(stored.quantity),3);
assert.equal(Number(stored.transaction_unit_price),13.33333333);assert.equal(Number(stored.total),40000);
assert.equal((await db.query("select count(*)::int n from effects")).rows[0].n,0);
// Mock only the side-effect endpoints: verify the actual save chain passes one
// integer amount to receive/payment, without requiring any printer or live stock.
await db.exec(`create or replace function receive_purchase_items_atomic(uuid,jsonb,uuid) returns jsonb language plpgsql set search_path=public as $$
begin update purchase_orders set status='completed' where id=$1;
insert into effects values('mock_receive'); return '{"new_status":"completed"}'::jsonb;end$$;
create or replace function record_purchase_payment(uuid,numeric,text,text,uuid,uuid) returns jsonb language plpgsql set search_path=public as $$
begin update purchase_orders set paid=$2,debt=total-$2 where id=$1;
insert into effects values('mock_payment');return jsonb_build_object('paid',$2);end$$;`);
const paid=(await db.query(`select save_purchase_order_with_uom_atomic_v2(null,'PO-PAID',$1,$2,null,0,0,0,28000,'cash',false,true,$3::jsonb) result`,[id(3),id(5),JSON.stringify([line(7,6,4666.67)])])).rows[0].result;
assert.equal(Number(paid.total),28000);assert.equal(Number(paid.paid),28000);assert.equal(Number(paid.debt),0);
assert.equal((await db.query('select paid=total and debt=0 as matched from purchase_orders where id=$1',[paid.purchase_order_id])).rows[0].matched,true);
await db.exec("select set_config('test.denied','yes',false)");
await assert.rejects(()=>save('PO-NO-PERM',[line(7,1,100)]),/INSUFFICIENT_PERMISSION/);
assert.equal((await db.query("select count(*)::int n from effects")).rows[0].n,2);
assert.equal(Number((await db.query('select total from purchase_orders where id=$1',[old.purchase_order_id])).rows[0].total),28001);
const allSaved=JSON.stringify((await db.query('select * from purchase_orders order by id')).rows);
await db.exec(original);
assert.equal(JSON.stringify((await db.query('select * from purchase_orders order by id')).rows),allSaved);
assert.deepEqual((await metadata()).rows,before);
console.log('PASS purchase VND: screenshot 96000, .02/.99 boundaries, half-VND, quantities, discount/VAT/fees, UOM, old browser, replay, overpayment, matched payable/payment/debt via mocks, historical rows and function OID/ACL preserved, rollback. No production connection.');
if (process.env.ONEBIZ_STAFF_PURCHASE_POSTING_TEST === '1') {
 const {verifyPurchasePostingScope}=await import('../staff-access-tests/purchase-posting.mjs');
 await verifyPurchasePostingScope(db,{id,save,line});
}
await db.close();

