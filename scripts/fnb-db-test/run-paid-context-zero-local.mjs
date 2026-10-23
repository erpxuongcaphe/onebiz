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

 await db.exec(`alter table restaurant_tables add branch_id uuid,add table_number integer,add name text,add zone text,add zone_id uuid;
 create table floor_plan_zones(id uuid primary key,tenant_id uuid,branch_id uuid,name text);
 alter table invoices add created_at timestamptz default now();`);
 await db.exec(`alter table cash_transactions add created_at timestamptz default now(),add occurred_at timestamptz,add transaction_date date,add time_source text,add time_reason text;`);
 await db.exec(extract(fs.readFileSync('supabase/migrations/00429_fnb_offline_cash_occurrence.sql','utf8'),'fnb_complete_payment_timed_v1'));
 const old=(await db.query('select to_jsonb(i) row from invoices i order by id')).rows;
 const migration=fs.readFileSync('supabase/migrations/202610230004_fnb_paid_context_zero_total.sql','utf8');
 await db.exec(migration);await db.exec(migration);
 const preserved=(await db.query("select to_jsonb(i)-'fnb_context' row from invoices i order by id")).rows;
 const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
 assert(JSON.stringify(old)===JSON.stringify(preserved),'install does not rewrite old invoices');
 const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
 await db.exec(`insert into floor_plan_zones values('${id(300)}','${id(2)}','${id(3)}','Trong nhà');
 insert into restaurant_tables(id,tenant_id,branch_id,table_number,name,zone_id,status) values('${id(301)}','${id(2)}','${id(3)}',3,'TN 03','${id(300)}','occupied');`);
 const create=async(n,price=0,quantity=1)=>db.exec(`insert into kitchen_orders(id,tenant_id,branch_id,status,order_type,order_number,table_id,note,created_at) values('${id(n)}','${id(2)}','${id(3)}','pending','dine_in','FREE-${n}','${id(301)}','Khách lấy thêm ly','2026-10-23T03:00:00Z');
 insert into kitchen_order_items(id,kitchen_order_id,product_id,product_name,quantity,unit_price,cancelled_qty) values('${id(n+1)}','${id(n)}','${id(10)}','Extra cup',${quantity},${price},0);`);
 const pay=async(n,paid=0,shift=id(7))=>(await db.query('select fnb_complete_payment_atomic_v3($1,null,\'UAT\',\'cash\',null,$2,false,0,null,null,null,$3) result',[id(n),paid,shift])).rows[0].result;
 const stock=async()=>(await db.query('select product_id,quantity from branch_stock order by branch_id,product_id')).rows;
 const cashBefore=Number((await db.query('select count(*) n from cash_transactions')).rows[0].n);
 await create(310);await create(320,10000);
 const before=await stock();const paid=await pay(310);
 const header=(await db.query('select * from invoices where id=$1',[paid.invoice_id])).rows[0];
 assert(Number(header.total)===0 && Number(header.paid)===0 && Number(header.debt)===0,'free bill completed at exactly zero');
 assert(header.status==='completed','free bill is completed');
 assert(Number((await db.query('select count(*) n from cash_transactions')).rows[0].n)===cashBefore,'zero bill creates no fake cash/payment receipt');
 assert(Number((await db.query('select quantity from invoice_items where invoice_id=$1',[paid.invoice_id])).rows[0].quantity)===1,'free item remains on invoice');
 assert(JSON.stringify(before)!==JSON.stringify(await stock()),'zero bill still posts actual BOM stock');
 const ctx=header.fnb_context;
 assert(ctx.table_name==='TN 03' && ctx.table_number===3 && ctx.area_name==='Trong nhà' && ctx.pos_note==='Khách lấy thêm ly','exact table + zone + POS note snapshot');
 assert(new Date(ctx.opened_at).toISOString()==='2026-10-23T03:00:00.000Z' && Date.parse(ctx.paid_at)>Date.parse(ctx.opened_at),'opening and payment times distinct');
 assert((await db.query('select status from restaurant_tables where id=$1',[id(301)])).rows[0].status==='occupied','unpaid sibling bill keeps table occupied');
 const after=await stock();const replay=await pay(310);
 assert(replay.invoice_id===paid.invoice_id && JSON.stringify(after)===JSON.stringify(await stock()),'retry returns same invoice and never reposts stock');
 await db.exec(`update restaurant_tables set name='Renamed',zone=null;update floor_plan_zones set name='Renamed area';update kitchen_orders set note='Later note' where id='${id(310)}';`);
 assert(JSON.stringify((await db.query('select fnb_context from invoices where id=$1',[paid.invoice_id])).rows[0].fnb_context)===JSON.stringify(ctx),'later table/zone/note edits never change paid snapshot');
 let rejected=false;try{await db.query("update invoices set fnb_context='{}' where id=$1",[paid.invoice_id]);}catch(e){rejected=/IMMUTABLE/.test(e.message);}assert(rejected,'captured history cannot be rewritten');
 await pay(320,10000);assert((await db.query('select status from restaurant_tables where id=$1',[id(301)])).rows[0].status==='available','last bill releases table');
 for(const [n,price,qty] of [[330,0,1],[340,-1,1],[350,0,0]]){
  await create(n,price,qty);
  let failed=false;try{await pay(n,0,n===330?null:id(7));}catch(e){failed=true;}assert(failed,'missing shift, negative price, empty active quantity rejected');
  assert((await db.query('select invoice_id from kitchen_orders where id=$1',[id(n)])).rows[0].invoice_id===null,'invalid checkout writes no invoice');
 }
 await create(360);await db.exec(`update kitchen_orders set table_id=null,order_type='takeaway' where id='${id(360)}';`);
 const mixed=(await db.query('select fnb_complete_payment_atomic_v3($1,null,\'UAT\',\'mixed\',null,0,false,0,null,null,null,$2) result',[id(360),id(7)])).rows[0].result;
 assert(Number(mixed.total)===0,'zero mixed settlement with no components completes');
 assert(Number((await db.query('select count(*) n from cash_transactions where reference_id=$1',[mixed.invoice_id])).rows[0].n)===0,'zero mixed creates no payment receipt');
 await create(370);await db.exec(`update kitchen_orders set table_id=null,created_at='2026-10-23T02:00:00Z' where id='${id(370)}';`);
 const payload={p_kitchen_order_id:id(370),p_customer_name:'UAT',p_payment_method:'cash',p_paid:0,p_shift_id:id(7)};
 const offline=(await db.query("select fnb_complete_payment_timed_v1($1,'2026-10-23T03:00:00Z') result",[JSON.stringify(payload)])).rows[0].result;
 const offlineContext=(await db.query('select fnb_context from invoices where id=$1',[offline.invoice_id])).rows[0].fnb_context;
 assert(new Date(offlineContext.paid_at).toISOString()==='2026-10-23T03:00:00.000Z' && offlineContext.paid_time_source==='offline','offline paid time follows original event, not sync time');
 assert(!(await db.query("select current_setting('onebiz.fnb_paid_occurred_at',true) value")).rows[0].value,'offline time scope restored');
 await db.query("select fnb_complete_payment_timed_v1($1,'2026-10-23T04:00:00Z')",[JSON.stringify(payload)]);
 assert(JSON.stringify((await db.query('select fnb_context from invoices where id=$1',[offline.invoice_id])).rows[0].fnb_context)===JSON.stringify(offlineContext),'offline replay does not rewrite paid history');
 await db.exec(`alter table invoices add column if not exists deleted_at timestamptz,add column if not exists issued_at timestamptz,add column if not exists order_code text,add column if not exists promotion_discount numeric default 0;
 alter table branches add tenant_id uuid,add branch_type text default 'store';update branches set tenant_id='${id(2)}';
 create table shipping_orders(id uuid primary key,invoice_id uuid,tenant_id uuid);
 create function get_user_tenant_id() returns uuid language sql stable as $$select tenant_id from profiles where id=auth.uid()$$;
 create function get_user_accessible_branches(uuid) returns table(branch_id uuid) language sql stable as $$select '${id(3)}'::uuid$$;`);
 const filterMigration=fs.readFileSync('supabase/migrations/202610230005_fnb_invoice_service_filters.sql','utf8');await db.exec(filterMigration);await db.exec(filterMigration);
 assert((await db.query('select fnb_table_label_20261023(i) label,fnb_area_label_20261023(i) area from invoices i where id=$1',[paid.invoice_id])).rows[0].label==='TN 03','filter uses frozen table name, not renamed table');
 assert((await db.query('select fnb_area_label_20261023(i) area from invoices i where id=$1',[paid.invoice_id])).rows[0].area==='Trong nhà','filter uses frozen area name');
 const opts=(await db.query('select get_fnb_invoice_filter_options_20261023($1) result',[id(3)])).rows[0].result;
 assert(opts.areas.includes('Trong nhà') && opts.tables.some(t=>t.label==='TN 03'),'historical options remain selectable after rename');
 const filtered=(await db.query(`select * from get_invoice_list_summary_fnb_context_20261023($1,null,null,array['completed'],null,'all','all','TN 03','Trong nhà')`,[id(3)])).rows[0];
 const exact=(await db.query(`select count(*) n,coalesce(sum(total),0) total from invoices i where branch_id=$1 and status='completed' and fnb_table_label_20261023(i)='TN 03' and fnb_area_label_20261023(i)='Trong nhà'`,[id(3)])).rows[0];
 assert(Number(filtered.so_dong_theo_bo_loc)===Number(exact.n) && Number(filtered.gia_tri_hoan_thanh)===Number(exact.total),'KPI uses identical service predicate as paginated list/export');
 let denied=false;try{await db.query('select get_fnb_invoice_filter_options_20261023($1)',[id(999)]);}catch(e){denied=/BRANCH_ACCESS_DENIED/.test(e.message);}assert(denied,'options reject foreign branch');
 await db.exec(`create or replace function user_has_permission(uuid,text) returns boolean language sql as $$select false$$;`);
 denied=false;try{await db.query('select get_fnb_invoice_filter_options_20261023($1)',[id(3)]);}catch(e){denied=/INVOICE_VIEW_REQUIRED/.test(e.message);}assert(denied,'options enforce invoice/POS viewing permission');
 console.log('PASS: real payment/BOM chain, zero bill stock posting/no cash, active shift/invalid/empty guards, sibling and final table release, payment replay, frozen table/zone/times/POS note, no old invoice backfill. Auth adapters remain bounded fixture stubs.');
} catch(e){console.error(e.message,e.where??'');process.exitCode=1;} finally {await db.close();fs.rmSync(temporary,{recursive:true,force:true});}

