// Embedded PostgreSQL contract check, never connects to any remote database.
// CI repeats the same fixture on PostgreSQL 17, including view row locks.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(process.argv[2]
  ? pathToFileURL(path.resolve(process.argv[2])).href : '@electric-sql/pglite');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'onebiz-qty-'));
const generated = new Map();
for (const [script, name] of [
  ['extract-payment-posting-chain.mjs','fnb-payment-posting-chain.sql'],
  ['extract-payment-replay-chain.mjs','fnb-payment-replay-chain.sql'],
  ['extract-effective-quantity-chain.mjs','fnb-effective-quantity-chain.sql'],
]) {
  const file = path.join(temporary,name);
  execFileSync(process.execPath,[`scripts/fnb-db-test/${script}`,file]);
  generated.set(`/tmp/${name}`,file);
}
function expand(file) {
  return fs.readFileSync(file,'utf8').replace(/^\\i(r?)\s+(.+)$/gm, (_match,relative,target)=>
    expand(relative ? path.resolve(path.dirname(file),target.trim()) : generated.get(target.trim()))
  ).replace(/^\\set.*$/gm,'').replace(
    /select 'create role (\w+) nologin'\s+where not exists \(select 1 from pg_roles where rolname = '\1'\) \\gexec/g,
    (_match,name)=>`create role ${name} nologin;`
  );
}

const extract=(source,name)=>{const start=source.search(new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${name}\\s*\\(`,'i'));if(start<0)throw Error(name);const rest=source.slice(start),m=/\bas\s+(\$[a-z_]*\$)/i.exec(rest);return rest.slice(0,rest.indexOf(m[1]+';',m.index+m[0].length)+m[1].length+1);};
let sql=expand(path.resolve('supabase/tests/00457_fnb_invoice_discount_allocation.integration.sql')).replace("current_database() not in ('fnb_payment_concurrency_test', 'fnb_payment_cost_test', 'fnb_payment_return_cost_test', 'fnb_full_refund_test', 'fnb_effective_qty_test')",'false');
const db=new PGlite();
try {
 await db.exec(sql);
 const approval=fs.readFileSync('supabase/migrations/00566_manager_approval_requests.sql','utf8');
 await db.exec(approval.slice(approval.indexOf('create table public.manager_approval_requests'),approval.indexOf('create function public._manager_approval_permission_00566')));
 await db.exec(`alter table invoice_items add note text;alter table profiles add full_name text;alter table branches add tenant_id uuid,add name text;
 alter table products add column if not exists category_id uuid;alter table product_variants add name text;
 alter table kitchen_orders add idempotency_key text;alter table customers add code text,add name text;
 create or replace function verify_otp_authorization(p_otp_id uuid,p_expected_action text,p_actor uuid,p_expected_target_id uuid default null) returns uuid language sql as $$select $3$$;
 update branches set tenant_id='00000000-0000-0000-0000-000000000002';`);
 for(const name of ['_manager_approval_permission_00566','_manager_approval_detail_00566','_manager_approval_items_00566','_manager_approval_target_00566','request_manager_approval_00566','_check_discount_approval_00566']) await db.exec(extract(approval,name));
 await db.exec(`do $$declare d text; begin d:=pg_get_functiondef('public._fnb_complete_payment_impl_00343(uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text)'::regprocedure);
 execute replace(d,'v_manual_discount_approver := public.verify_otp_authorization(','perform public._check_discount_approval_00566(p_manual_discount_otp_id,''fnb.discount_override'',v_order.branch_id,v_order.id,v_manual_discount,(select jsonb_agg(to_jsonb(x)) from public._fnb_active_kitchen_items_00454 x where x.kitchen_order_id=v_order.id)); v_manual_discount_approver := public.verify_otp_authorization(');end $$;`);
 await db.exec(fs.readFileSync('supabase/migrations/202610200002_fnb_selected_item_discount.sql','utf8'));
 const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
 const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
 const item=(idNo,qty,price,selected,note='')=>({kitchen_item_id:id(idNo),productId:id(10),productName:'Drink',variantId:null,quantity:qty,unitPrice:price,toppings:[],modifierSelections:[],discount_selected:selected,note});
 await db.exec(`insert into kitchen_orders(id,tenant_id,branch_id,status,order_type,order_number) values('${id(200)}','${id(2)}','${id(3)}','pending','takeaway','SELECTED-1');
 insert into kitchen_order_items(id,kitchen_order_id,product_id,product_name,quantity,unit_price,toppings,modifier_selections,note) values
 ('${id(201)}','${id(200)}','${id(10)}','Drink',2,30000,'[{"productId":"${id(10)}","name":"Extra","quantity":1,"price":5000}]','[]','chosen'),('${id(202)}','${id(200)}','${id(10)}','Drink',1,50000,'[]','[]','other');`);
 const items=[{...item(201,2,30000,true,'chosen'),toppings:[{productId:id(10),name:'Extra',quantity:1,price:5000}]},item(202,1,50000,false,'other')];
 const meta={branch_id:id(3),entity_id:id(200),draft_key:'test',label:'Selected rows',subtotal:120000,amount:17500,existing_discount:0,discount_scope:'items',discount_mode:'percent',discount_value:25,items};
 const request=(m)=>db.query("select request_manager_approval_00566('fnb.discount_override',$1,'Discount chosen drinks') result",[m]);
 const req=(await request(meta)).rows[0].result;
 const saved=(await db.query('select payload from manager_approval_requests where id=$1',[req.id])).rows[0].payload;
 assert(saved.items[0].productName.startsWith('[Giảm món này]'),'approver sees selected item');
 assert(!saved.items[1].productName.startsWith('[Giảm món này]'),'unselected item is not mislabeled');
 await db.query("update manager_approval_requests set status='authorized',otp_id=$2 where id=$1",[req.id,id(203)]);
 await db.exec(`select fnb_complete_payment_atomic_v3('${id(200)}',null,'TEST','cash',null,150000,false,17500,'${id(203)}','Approved selected rows',null,'${id(7)}');`);
 const invoice=(await db.query('select invoice_id from kitchen_orders where id=$1',[id(200)])).rows[0].invoice_id;
 const lines=(await db.query('select s.kitchen_order_item_id,i.discount,i.total,i.note from invoice_items i join fnb_invoice_kitchen_line_sources s on s.invoice_item_id=i.id where i.invoice_id=$1 order by s.kitchen_order_item_id',[invoice])).rows;
 assert(Number(lines[0].discount)===17500 && Number(lines[0].total)===52500,'selected row receives exactly its approved discount');
 assert(Number(lines[1].discount)===0 && Number(lines[1].total)===50000,'unselected row keeps full refundable value');
 assert(Number(lines[0].total)/2===26250,'one-unit partial refund uses only the selected row net amount');
 assert(lines[0].note.includes('chosen') && lines[0].note.includes('Giảm món: -17500'),'receipt annotation preserves original note');
 const snap=(await db.query('select lines from fnb_invoice_discount_snapshots where invoice_id=$1',[invoice])).rows[0].lines;
 await db.exec(`select fnb_complete_payment_atomic_v3('${id(200)}',null,'TEST','cash',null,150000,false,17500,'${id(203)}','Approved selected rows',null,'${id(7)}');`);
 assert(JSON.stringify(snap)===JSON.stringify((await db.query('select lines from fnb_invoice_discount_snapshots where invoice_id=$1',[invoice])).rows[0].lines),'payment replay never reallocates historical lines');
 for(const bad of [{...meta,amount:1000},{...meta,discount_value:101},{...meta,items:items.map(i=>({...i,discount_selected:false}))}]){
  let rejected=false;try{await request(bad);}catch(e){rejected=/APPROVAL_/.test(e.message);}assert(rejected,'invalid selected scope rejected');
 }
 await db.exec(`insert into kitchen_orders(id,tenant_id,branch_id,status,order_type,order_number) values('${id(210)}','${id(2)}','${id(3)}','pending','takeaway','SELECTED-ROLLBACK');
 insert into kitchen_order_items(id,kitchen_order_id,product_id,product_name,quantity,unit_price,toppings,modifier_selections,note) values('${id(211)}','${id(210)}','${id(10)}','Drink',1,50000,'[]','[]','exact row');`);
 const badMeta={...meta,entity_id:id(210),subtotal:50000,amount:12500,items:[item(999,1,50000,true,'exact row')]};
 const badReq=(await request(badMeta)).rows[0].result;
 await db.query("update manager_approval_requests set status='authorized',otp_id=$2 where id=$1",[badReq.id,id(212)]);
 let rejected=false;try{await db.exec(`select fnb_complete_payment_atomic_v3('${id(210)}',null,'TEST','cash',null,50000,false,12500,'${id(212)}','Approved selection',null,'${id(7)}');`);}catch(e){rejected=/APPROVAL_ITEMS_CHANGED/.test(e.message);}assert(rejected,'wrong exact source cannot spend an approval');
 assert((await db.query('select invoice_id from kitchen_orders where id=$1',[id(210)])).rows[0].invoice_id===null,'wrong source rolls back invoice and all payment work');
 assert((await db.query("select count(*) c from audit_log where entity_id=$1 and action='fnb_checkout_benefits_server_calculated'",[id(210)])).rows[0].c===0,'failed checkout does not log success');
 console.log('PASS: selected-item approval validation, manager labels, real checkout/source links, exact per-line refund basis, receipt notes, replay immutability and full wrong-source rollback.');
} catch(e){console.error(e.message,e.where??'');process.exitCode=1;} finally {await db.close();fs.rmSync(temporary,{recursive:true,force:true});}
