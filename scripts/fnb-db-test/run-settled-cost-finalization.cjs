// Real PostgreSQL semantics in an isolated PGlite database; no network/production.
const fs=require('node:fs');
const assert=require('node:assert/strict');
const readSql = path => fs.readFileSync(path,'utf8').replace(/\r\n/g,'\n');
const {PGlite}=require(process.env.FNB_PGLITE_DIR||'@electric-sql/pglite');
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const migration='supabase/migrations/20261029103039_fnb_settled_invoice_cost_finalize.sql';
const hotfix='supabase/migrations/20261029131731_fnb_invoice_line_cost_total_variable_hotfix.sql';
(async()=>{const db=new PGlite();try{
const schema=`do $$begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;
end$$;create schema private;create schema auth;
create function auth.uid() returns uuid language sql as $$ select '${id(1)}'::uuid $$;
create table products(id uuid primary key,inventory_role text);
create table invoices(id uuid primary key,tenant_id uuid,branch_id uuid,source text,status text,deleted_at timestamptz,created_by uuid);
create table invoice_items(id uuid primary key,invoice_id uuid,product_id uuid,quantity numeric,unit_cost numeric(15,4),total numeric default 0);
create table sales_returns(id uuid primary key,invoice_id uuid,status text);
create table fnb_branch_product_cost_events(id uuid primary key default gen_random_uuid(),tenant_id uuid,branch_id uuid,product_id uuid,direction text,source_type text,source_reference_type text,source_reference_id uuid,source_stock_movement_id uuid,quantity numeric,unit_cost numeric,total_cost numeric,note text,created_by uuid);
create table fnb_invoice_item_bom_snapshot_components_00410(id bigint generated always as identity,invoice_item_id uuid,material_id uuid,quantity numeric);
create table fnb_sale_cost_shortfalls_00473(id uuid primary key,tenant_id uuid,branch_id uuid,product_id uuid,invoice_id uuid,cost_event_id uuid,quantity numeric,pending_quantity numeric,estimated_unit_cost numeric,settled_actual_cost numeric,created_at timestamptz default now(),updated_at timestamptz default now(),cost_known boolean default false);
create table audit_log(tenant_id uuid,user_id uuid not null,action text,entity_type text,entity_id uuid,old_data jsonb,new_data jsonb);
insert into products values('${id(3)}','fnb_menu_item');`;
await db.exec(schema);
const oldSnapshot=readSql('scripts/fnb-db-test/fixtures/snapshot-cost-before-finalization.sql','utf8');
await db.exec(oldSnapshot);
await db.exec(readSql(migration));
await db.exec(readSql(hotfix));
if(process.env.FNB_RECORD_COST_SQL){
 const seed=`insert into invoices values('${id(900)}','${id(1)}','${id(2)}','fnb','completed',null,'${id(1)}');
 insert into invoice_items values('${id(901)}','${id(900)}','${id(3)}',1,null);
 insert into fnb_branch_product_cost_events(id,tenant_id,branch_id,product_id,direction,source_type,source_reference_type,source_reference_id,source_stock_movement_id,quantity,unit_cost,total_cost) values('${id(902)}','${id(1)}','${id(2)}','${id(4)}','out','bom_consume','bom_consume','${id(900)}','${id(904)}',10,0,0);
 insert into fnb_invoice_item_bom_snapshot_components_00410(invoice_item_id,material_id,quantity) values('${id(901)}','${id(4)}',10);
 insert into fnb_sale_cost_shortfalls_00473(id,tenant_id,branch_id,product_id,invoice_id,cost_event_id,quantity,pending_quantity,estimated_unit_cost,settled_actual_cost) values('${id(903)}','${id(1)}','${id(2)}','${id(4)}','${id(900)}','${id(902)}',10,10,0,0);`;
 fs.writeFileSync(process.env.FNB_RECORD_COST_SQL,schema+'\n'+oldSnapshot+'\n'+readSql(migration)+'\n'+readSql(hotfix)+'\n'+seed);
}
const value=async(sql,params=[])=> (await db.query(sql,params)).rows;
async function setup(n,{mapped=false,pending=10,quantity=1,price=0,source='fnb',material=4,saleTotal=0}={}){
 const inv=id(n),line=id(n+1),event=id(n+2),short=id(n+3);
 await db.query(`insert into invoices values($1,$2,$3,$4,'completed',null,$2)`,[inv,id(1),id(2),source]);
 await db.query(`insert into invoice_items values($1,$2,$3,$4,null,$5)`,[line,inv,id(3),quantity,saleTotal]);
 await db.query(`insert into fnb_branch_product_cost_events(id,tenant_id,branch_id,product_id,direction,source_type,source_reference_type,source_reference_id,source_stock_movement_id,quantity,unit_cost,total_cost) values($1,$2,$3,$4,'out','bom_consume','bom_consume',$5,$6,10,$7::numeric,10*$7::numeric)`,[event,id(1),id(2),id(material),inv,id(n+4),price]);
 await db.query(`insert into fnb_invoice_item_bom_snapshot_components_00410(invoice_item_id,material_id,quantity) values($1,$2,10)`,[line,id(material)]);
 await db.query(`insert into fnb_sale_cost_shortfalls_00473(id,tenant_id,branch_id,product_id,invoice_id,cost_event_id,quantity,pending_quantity,estimated_unit_cost,settled_actual_cost) values($1,$2,$3,$4,$5,$6,10,$7,$8,0)`,[short,id(1),id(2),id(material),inv,event,pending,price]);
 if(mapped) await db.query(`select public._snapshot_fnb_invoice_line_cost_00412($1,0,0)`,[line]);
 return {inv,line,event,short};
}
const cost=async line=>(await value('select unit_cost from invoice_items where id=$1',[line]))[0].unit_cost;
// Real invoice rows also have a sale `total`. Execute the ordinary checkout
// path with no shortage, rather than only testing its early-return branch.
const sufficient=await setup(50,{mapped:true,pending:0,quantity:2,price:3,saleTotal:99000});
assert.equal(Number(await cost(sufficient.line)),15);
assert.equal(Number((await value('select total from invoice_items where id=$1',[sufficient.line]))[0].total),99000);
assert.equal((await value('select count(*)::int n from private.fnb_cost_event_lines_20261029 where invoice_item_id=$1',[sufficient.line]))[0].n,1);
await db.query(`insert into invoice_items values($1,$2,$3,4,null,88000)`,[id(60),sufficient.inv,id(3)]);
await db.query(`insert into fnb_branch_product_cost_events(id,tenant_id,branch_id,product_id,direction,source_type,source_reference_type,source_reference_id,quantity,unit_cost,total_cost) values($1,$2,$3,$4,'out','bom_consume','bom_consume',$5,10,4,40)`,[id(61),id(1),id(2),id(4),sufficient.inv]);
await db.query('select public._snapshot_fnb_invoice_line_cost_00412($1,1,30)',[id(60)]);
assert.equal(Number(await cost(id(60))),10);
assert.equal(Number(await cost(sufficient.line)),15);
assert.equal(Number((await value('select total from invoice_items where id=$1',[id(60)]))[0].total),88000);
// Partial receipt keeps the unknown snapshot; two actual receipt prices finish it.
const a=await setup(100,{mapped:true});
assert.equal((await value('select count(*)::int n from private.fnb_cost_event_lines_20261029 where invoice_item_id=$1',[a.line]))[0].n,1);
await db.query('update fnb_sale_cost_shortfalls_00473 set pending_quantity=6,settled_actual_cost=8 where id=$1',[a.short]);
assert.equal(await cost(a.line),null);
await db.query('update fnb_sale_cost_shortfalls_00473 set pending_quantity=0,settled_actual_cost=26 where id=$1',[a.short]);
assert.equal(Number(await cost(a.line)),26);
assert.equal((await value('select count(*)::int n from audit_log'))[0].n,1);
// Replayed settlement does not write another audit or inflate cost.
await db.query('update fnb_sale_cost_shortfalls_00473 set pending_quantity=0,settled_actual_cost=26 where id=$1',[a.short]);
assert.equal((await value('select count(*)::int n from audit_log'))[0].n,1);
// Legacy quantities with a unique price can be reconstructed; no current products price exists.
const legacy=await setup(200);
await db.query('update fnb_sale_cost_shortfalls_00473 set pending_quantity=0,settled_actual_cost=31 where id=$1',[legacy.short]);
assert.equal(Number(await cost(legacy.line)),31);
// Attribution can recover two identical quantities at DIFFERENT settled prices.
const multi=await setup(300,{mapped:true});
await db.query(`insert into invoice_items values($1,$2,$3,1,null)`,[id(310),multi.inv,id(3)]);
await db.query(`insert into fnb_branch_product_cost_events(id,tenant_id,branch_id,product_id,direction,source_type,source_reference_type,source_reference_id,source_stock_movement_id,quantity,unit_cost,total_cost) values($1,$2,$3,$4,'out','bom_consume','bom_consume',$5,$6,10,0,0)`,[id(311),id(1),id(2),id(4),multi.inv,id(312)]);
await db.query(`insert into fnb_sale_cost_shortfalls_00473(id,tenant_id,branch_id,product_id,invoice_id,cost_event_id,quantity,pending_quantity,estimated_unit_cost,settled_actual_cost) values($1,$2,$3,$4,$5,$6,10,10,0,0)`,[id(313),id(1),id(2),id(4),multi.inv,id(311)]);
await db.query('select public._snapshot_fnb_invoice_line_cost_00412($1,1,0)',[id(310)]);
await db.query('update fnb_sale_cost_shortfalls_00473 set pending_quantity=0,settled_actual_cost=20 where id=$1',[multi.short]);
assert.equal(await cost(multi.line),null);
await db.query('update fnb_sale_cost_shortfalls_00473 set pending_quantity=0,settled_actual_cost=30 where id=$1',[id(313)]);
assert.equal(Number(await cost(multi.line)),20);assert.equal(Number(await cost(id(310))),30);
// Without attribution the same ambiguous legacy shapes must remain unknown.
await db.query('delete from private.fnb_cost_event_lines_20261029 where invoice_item_id in ($1,$2)',[multi.line,id(310)]);
const ambiguous=(await value('select private.preview_fnb_settled_cost_20261029($1) p',[multi.inv]))[0].p;
assert.equal(ambiguous.complete,false);
// Mismatched historical quantity never fills an invoice cost.
const mismatch=await setup(400);
await db.query('update fnb_invoice_item_bom_snapshot_components_00410 set quantity=9 where invoice_item_id=$1',[mismatch.line]);
await db.query('update fnb_sale_cost_shortfalls_00473 set pending_quantity=0,settled_actual_cost=20 where id=$1',[mismatch.short]);
assert.equal(await cost(mismatch.line),null);
// Retail is never queued/finalized even if it has similarly shaped records.
const retail=await setup(500,{source:'retail'});
await db.query('update fnb_sale_cost_shortfalls_00473 set pending_quantity=0,settled_actual_cost=40 where id=$1',[retail.short]);
assert.equal(await cost(retail.line),null);
// A void invoice is not finalized.
const cancelled=await setup(600);
await db.query("update invoices set status='cancelled' where id=$1",[cancelled.inv]);
await db.query('update fnb_sale_cost_shortfalls_00473 set pending_quantity=0,settled_actual_cost=40 where id=$1',[cancelled.short]);
assert.equal(await cost(cancelled.line),null);
// Returns require explicit reconciliation; never silently rewrite their basis.
const returned=await setup(650);
await db.query("insert into sales_returns values($1,$2,'completed')",[id(660),returned.inv]);
await db.query('update fnb_sale_cost_shortfalls_00473 set pending_quantity=0,settled_actual_cost=30 where id=$1',[returned.short]);
assert.equal(await cost(returned.line),null);
// A known estimate must be replaced by actual incoming value when fully settled.
const known=await setup(700,{mapped:true,price:2});
assert.equal(await cost(known.line),null);
await db.query('update fnb_sale_cost_shortfalls_00473 set pending_quantity=0,settled_actual_cost=35 where id=$1',[known.short]);
assert.equal(Number(await cost(known.line)),35);
// Exercise the actual incoming weighted-average/deficit function, not a mock.
await db.exec(`create table fnb_branch_product_cost_balances(tenant_id uuid,branch_id uuid,product_id uuid,costed_quantity numeric default 0,total_cost numeric default 0,unit_cost numeric default 0,deficit_quantity numeric default 0,updated_by uuid,updated_at timestamptz,primary key(tenant_id,branch_id,product_id));`);
const negativeMigration=fs.readFileSync('supabase/migrations/00473_branch_negative_sale_policy.sql','utf8');
const start=negativeMigration.indexOf('create or replace function public._post_fnb_branch_cost_in_00390(');
const end=negativeMigration.indexOf('end; $$;',start)+'end; $$;'.length;
await db.exec(negativeMigration.slice(start,end));
const receipt=await setup(800,{mapped:true,material:804});
await db.query('insert into fnb_branch_product_cost_balances(tenant_id,branch_id,product_id,deficit_quantity) values($1,$2,$3,10)',[id(1),id(2),id(804)]);
const receive=async(qty,price,movement)=>db.query("select _post_fnb_branch_cost_in_00390($1,$2,$3,$4,$5,'purchase_receipt','purchase_order',$6,$7,null,$8)",[id(1),id(2),id(804),qty,price,id(805),movement,id(1)]);
await receive(4,2,id(806));assert.equal(await cost(receipt.line),null);
await receive(6,3,id(807));assert.equal(Number(await cost(receipt.line)),26);
await receive(6,3,id(807));assert.equal(Number(await cost(receipt.line)),26);
assert.equal((await value('select deficit_quantity=0 and costed_quantity=0 and total_cost=0 ok from fnb_branch_product_cost_balances where product_id=$1',[id(804)]))[0].ok,true);
// A maintenance failure must not cancel a valid incoming receipt. It is retried.
const failure=await setup(850,{mapped:true,material:854});
await db.exec("alter table audit_log add constraint inject_finalize_failure check(action<>'fnb_invoice_cost_finalized') not valid");
await db.query('update fnb_sale_cost_shortfalls_00473 set pending_quantity=0,settled_actual_cost=29 where id=$1',[failure.short]);
assert.equal(await cost(failure.line),null);
assert.equal((await value('select pending_quantity=0 ok from fnb_sale_cost_shortfalls_00473 where id=$1',[failure.short]))[0].ok,true);
assert.match((await value('select reason from private.fnb_cost_finalize_queue_20261029 where invoice_id=$1',[failure.inv]))[0].reason,/^retry:/);
await db.exec('alter table audit_log drop constraint inject_finalize_failure');
await db.query('select process_fnb_cost_finalize_queue_20261029($1,100)',[id(1)]);
assert.equal(Number(await cost(failure.line)),29);
for(const role of ['anon','authenticated']) {
 assert.equal((await value("select has_function_privilege($1,'public.process_fnb_cost_finalize_queue_20261029(uuid,integer)','execute') allowed",[role]))[0].allowed,false);
 assert.equal((await value("select has_table_privilege($1,'private.fnb_cost_event_lines_20261029','select') allowed",[role]))[0].allowed,false);
}
assert.equal((await value("select has_function_privilege('service_role','public.process_fnb_cost_finalize_queue_20261029(uuid,integer)','execute') allowed"))[0].allowed,true);
console.log('PASS: partial/multiple receipts, replay, legacy exact match, per-line attribution with differing costs, ambiguous/mismatched rejection, Retail/void isolation and ACL.');
// Run the new migration against the same PostgreSQL fixture and the real
// receipt / production cost posting function above.
const salePricing = 'supabase/migrations/20261117070747_fnb_provisional_line_cost.sql';
await db.exec(`
 create view private.report_invoice_items_final_cost_20261029 as
 select ii.id,ii.invoice_id,ii.quantity,
  case when i.source='fnb' and exists(select 1 from fnb_sale_cost_shortfalls_00473 f
     where f.invoice_id=i.id and f.pending_quantity>0) then null::numeric
     else ii.unit_cost end as unit_cost
 from invoice_items ii join invoices i on i.id=ii.invoice_id;
 create function public.get_profit_and_loss_report_v2(timestamptz,timestamptz,timestamptz,timestamptz,uuid,boolean)
 returns jsonb language sql as $report$
 with sales_cost_totals as (
  select coalesce(sum(ii.unit_cost*ii.quantity),0) sales_cogs,
         count(*) filter (where ii.unit_cost is null) as missing_cost_lines
  from private.report_invoice_items_final_cost_20261029 ii where ii.invoice_id=$5
 ), rows as (
  select coalesce(sc.missing_cost_lines, 0) as missing_sales_cost_lines, sc.sales_cogs
  from sales_cost_totals sc
 )
 select to_jsonb(rows) from rows;
 $report$;
`);
await db.exec("alter table products add column name text not null default 'Món kiểm thử';");
await db.exec(readSql(salePricing));
await db.exec(readSql('supabase/migrations/20261117073859_fnb_cost_missing_keeps_checkout.sql'));
const premium = await setup(1000,{material:1004,price:2,saleTotal:52000});
await db.query('update fnb_sale_cost_shortfalls_00473 set cost_known=true where id=$1',[premium.short]);
await db.query('select public._snapshot_fnb_invoice_line_cost_00412($1,0,0)',[premium.line]);
const lineStatus = async line => (await value('select unit_cost,fnb_cost_state,total from invoice_items where id=$1',[line]))[0];
const report = async invoice => (await value('select get_profit_and_loss_report_v2(null,null,null,null,$1,true) p',[invoice]))[0].p;
assert.equal((await lineStatus(premium.line)).fnb_cost_state,'estimated');
assert.equal(Number(await cost(premium.line)),20);
assert.deepEqual(await report(premium.inv),{sales_cogs:20,missing_sales_cost_lines:0,estimated_sales_cost_lines:1});
// An unknown-cost line still posts and preserves the link to incoming costs.
// The other line must keep its estimate until its own receipt arrives.
await db.exec(`
 insert into invoice_items (id,invoice_id,product_id,quantity,total)
 values('${id(1010)}','${premium.inv}','${id(3)}',1,47000);
 insert into fnb_branch_product_cost_events(id,tenant_id,branch_id,product_id,direction,source_type,source_reference_type,source_reference_id,quantity,unit_cost,total_cost)
 values('${id(1011)}','${id(1)}','${id(2)}','${id(1014)}','out','bom_consume','bom_consume','${premium.inv}',5,0,0);
 insert into fnb_sale_cost_shortfalls_00473(id,tenant_id,branch_id,product_id,invoice_id,cost_event_id,quantity,pending_quantity,estimated_unit_cost,settled_actual_cost)
 values('${id(1012)}','${id(1)}','${id(2)}','${id(1014)}','${premium.inv}','${id(1011)}',5,5,0,0);
`);
await db.query('select public._snapshot_fnb_invoice_line_cost_00412($1,1,20)',[id(1010)]);
assert.equal((await lineStatus(id(1010))).unit_cost,null);
assert.equal((await lineStatus(id(1010))).fnb_cost_state,'missing');
assert.equal((await value('select count(*)::int n from private.fnb_cost_event_lines_20261029 where invoice_item_id=$1',[id(1010)]))[0].n,1);
assert.equal(Number((await lineStatus(id(1010))).total),47000);
assert.deepEqual(await report(premium.inv),{sales_cogs:20,missing_sales_cost_lines:1,estimated_sales_cost_lines:1});

await db.query('insert into fnb_branch_product_cost_balances(tenant_id,branch_id,product_id,deficit_quantity) values($1,$2,$3,10),($1,$2,$4,5)',[id(1),id(2),id(1004),id(1014)]);
const postCost = (material,qty,price,source,movement) => db.query(
 "select _post_fnb_branch_cost_in_00390($1,$2,$3,$4,$5,$6,$6,$7,$8,null,$1)",
 [id(1),id(2),id(material),qty,price,source,id(1100),id(movement)],
);
await postCost(1004,4,3,'production_complete',1101);
assert.equal(Number(await cost(premium.line)),24);
assert.equal((await lineStatus(premium.line)).fnb_cost_state,'estimated');
await postCost(1004,6,4,'purchase_receipt',1102);
assert.equal(Number(await cost(premium.line)),36);
assert.equal((await lineStatus(premium.line)).fnb_cost_state,'final');
await postCost(1004,6,4,'purchase_receipt',1102);
assert.equal(Number(await cost(premium.line)),36);
await postCost(1014,5,0,'purchase_receipt',1103);
assert.equal(Number(await cost(id(1010))),0);
assert.equal((await lineStatus(id(1010))).fnb_cost_state,'final');
assert.deepEqual(await report(premium.inv),{sales_cogs:36,missing_sales_cost_lines:0,estimated_sales_cost_lines:0});
assert.equal(Number((await lineStatus(premium.line)).total),52000);
assert.equal((await lineStatus(retail.line)).fnb_cost_state,null);
const free = await setup(1250,{material:1254,price:0});
await db.query('update fnb_sale_cost_shortfalls_00473 set cost_known=true where id=$1',[free.short]);
await db.query('select public._snapshot_fnb_invoice_line_cost_00412($1,0,0)',[free.line]);
assert.equal(Number(await cost(free.line)),0);
assert.equal((await lineStatus(free.line)).fnb_cost_state,'estimated');
console.log('PASS: F&B estimate, unknown-cost checkout, automatic settlement, partial production, receipt, confirmed zero, replay and reporting.');
}catch(e){console.error(e);process.exitCode=1;}finally{await db.close();}})();
