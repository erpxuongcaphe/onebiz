// Guarded one-off operation, with the real current branch WAC in/out functions.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
const {PGlite}=await import(process.argv[2]?pathToFileURL(path.resolve(process.argv[2])).href:'@electric-sql/pglite');const db=new PGlite();
const sql=fs.readFileSync('supabase/operations/20261021_xtb_recipe_stock_correction.sql','utf8');
const tenant='148e8ac5-b891-4de3-9055-cfa41f39ddb0',branch='0dfc218e-0b32-4096-8205-d5f82ab42492',actor='7f763419-5392-49de-9796-af2402c8cd23';
const honey='0a398b76-4de8-4317-8e34-0e594fe59b0b',lemon='34617a2e-d6e4-40b3-b20a-3587266ddf9b',tac='64ce6219-d22d-4313-97b7-49add8a8bd6b';
function extract(file,name){const s=fs.readFileSync(file,'utf8');const m=new RegExp('create or replace function public\\.'+name+'\\s*\\(','i').exec(s);assert(m);const rest=s.slice(m.index),tag=/\bas\s+(\$[a-z_]*\$)/i.exec(rest);return rest.slice(0,rest.indexOf(tag[1],tag.index+tag[0].length)+tag[1].length)+';';}
const list=name=>[...sql.match(new RegExp(name+" uuid\\[\\]:=array\\[([\\s\\S]*?)\\]::uuid\\[\\]"))[1].matchAll(/'([a-f0-9-]+)'/g)].map(m=>m[1]);
const rows=async query=>(await db.query(query)).rows;
try{
await db.exec(`create schema auth;create schema extensions;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table profiles(id uuid,tenant_id uuid,is_active boolean,role text);
create table products(id uuid primary key,stock numeric);
create table invoices(id uuid primary key,code text,tenant_id uuid,branch_id uuid,status text);
create table invoice_items(id uuid primary key,invoice_id uuid,product_id uuid,quantity numeric);
create table fnb_invoice_item_bom_snapshots_00410(invoice_item_id uuid,invoice_id uuid,tenant_id uuid,branch_id uuid,created_at timestamptz);
create table fnb_invoice_item_bom_snapshot_components_00410(invoice_item_id uuid,material_id uuid,quantity numeric);
create table sales_returns(invoice_id uuid,status text);
create table branch_stock(tenant_id uuid,branch_id uuid,product_id uuid,variant_id uuid,quantity numeric);
create table stock_movements(id uuid default gen_random_uuid(),tenant_id uuid,branch_id uuid,product_id uuid,type text,quantity numeric,reference_type text,reference_id uuid,note text,created_by uuid);
create table audit_log(tenant_id uuid,user_id uuid,action text,entity_type text,entity_id uuid,old_data jsonb,new_data jsonb);
create table fnb_branch_product_cost_balances(tenant_id uuid,branch_id uuid,product_id uuid,costed_quantity numeric default 0,total_cost numeric default 0,unit_cost numeric default 0,deficit_quantity numeric default 0,opening_cost_confirmed boolean default true,updated_by uuid,updated_at timestamptz,primary key(tenant_id,branch_id,product_id));
create table fnb_branch_product_cost_events(id uuid default gen_random_uuid(),tenant_id uuid,branch_id uuid,product_id uuid,direction text,source_type text,source_reference_type text,source_reference_id uuid,source_stock_movement_id uuid,quantity numeric,unit_cost numeric,total_cost numeric,note text,created_by uuid,created_at timestamptz default now());
create table fnb_sale_cost_shortfalls_00473(id uuid,tenant_id uuid,branch_id uuid,product_id uuid,cost_event_id uuid,invoice_id uuid,quantity numeric,pending_quantity numeric,estimated_unit_cost numeric,cost_known boolean,settled_actual_cost numeric,updated_at timestamptz,created_at timestamptz);
create function _allow_negative_sale_00473(uuid,uuid) returns boolean language sql as $$select false$$;
insert into profiles values('${actor}','${tenant}',true,'owner');`);
await db.exec(extract('supabase/migrations/00473_branch_negative_sale_policy.sql','_post_fnb_branch_cost_in_00390'));
await db.exec(extract('supabase/migrations/00473_branch_negative_sale_policy.sql','_post_fnb_branch_cost_out_00390'));
// An adapter supplies the existing authenticated batch-RPC boundary. Actual WAC posting is not mocked.
await db.exec(`create function apply_manual_stock_movement_atomic(uuid,uuid,uuid,jsonb) returns jsonb language plpgsql as $$
declare item jsonb; movement uuid;unit_cost numeric;begin
if auth.uid() is distinct from '${actor}'::uuid then raise exception 'DENIED';end if;
for item in select * from jsonb_array_elements($4) loop
 if item->>'product_id'='${honey}' and current_setting('test.fail_after_first',true)='yes' then raise exception 'TEST_BATCH_FAILURE';end if;
 insert into stock_movements(tenant_id,branch_id,product_id,type,quantity,reference_type,reference_id,note,created_by)
 values('${tenant}',$2,(item->>'product_id')::uuid,item->>'type',(item->>'quantity')::numeric,item->>'reference_type',(item->>'reference_id')::uuid,item->>'note',auth.uid()) returning id into movement;
 if item->>'type'='in' then
  select cb.unit_cost into unit_cost from fnb_branch_product_cost_balances cb where cb.product_id=(item->>'product_id')::uuid;
  perform _post_fnb_branch_cost_in_00390('${tenant}',$2,(item->>'product_id')::uuid,(item->>'quantity')::numeric,unit_cost,'inventory_adjustment','stock_adjustment',(item->>'reference_id')::uuid,movement,item->>'note',auth.uid());
 else perform _post_fnb_branch_cost_out_00390('${tenant}',$2,(item->>'product_id')::uuid,(item->>'quantity')::numeric,'inventory_adjustment','stock_adjustment',(item->>'reference_id')::uuid,movement,item->>'note',auth.uid());end if;
 update branch_stock set quantity=quantity+case when item->>'type'='in' then 1 else -1 end*(item->>'quantity')::numeric where branch_id=$2 and product_id=(item->>'product_id')::uuid;
 update products set stock=stock+case when item->>'type'='in' then 1 else -1 end*(item->>'quantity')::numeric where id=(item->>'product_id')::uuid;
end loop;return jsonb_build_object('count',jsonb_array_length($4));end$$;`);
for(const [material,qty,cost] of [[honey,1.6666,135000],[lemon,38.5,1000],[tac,56,500]])await db.exec(`insert into products values('${material}',${qty});insert into branch_stock values('${tenant}','${branch}','${material}',null,${qty});insert into fnb_branch_product_cost_balances(tenant_id,branch_id,product_id,costed_quantity,total_cost,unit_cost) values('${tenant}','${branch}','${material}',${qty},${qty*cost},${cost});`);
for(const [name,product,materials] of [['v_honey_items','240e906d-e95e-4e9b-bdba-dea969feca96',[[honey,.0003]]],['v_lemon_items','dd1f9569-604b-458c-a43e-eb5217a4c736',[[lemon,2],[tac,1]]]]){
 for(const item of list(name)){
 await db.exec(`insert into invoices values('${item}','FIXTURE-${item}','${tenant}','${branch}','completed');insert into invoice_items values('${item}','${item}','${product}',1);insert into fnb_invoice_item_bom_snapshots_00410 values('${item}','${item}','${tenant}','${branch}','2026-10-21 12:00+07');`);
 for(const [material,quantity] of materials)await db.exec(`insert into fnb_invoice_item_bom_snapshot_components_00410 values('${item}','${material}',${quantity});`);
 }
}
const before=await rows('select * from branch_stock order by product_id'),snapshots=await rows('select * from fnb_invoice_item_bom_snapshot_components_00410 order by invoice_item_id,material_id');
const guarded=sql.replace(/^begin;$/m,'').replace(/^commit;$/m,'');
for(const [change,error] of [
 ["update invoices set status='cancelled' where id=(select id from invoices limit 1)",'BILL_EVIDENCE_CHANGED'],
 ["update invoice_items set quantity=2 where id=(select id from invoice_items limit 1)",'BILL_EVIDENCE_CHANGED'],
 ["insert into sales_returns select id,'completed' from invoices limit 1",'BILL_EVIDENCE_CHANGED'],
 ["update fnb_branch_product_cost_balances set costed_quantity=0 where product_id='"+honey+"'",'COST_REVIEW_REQUIRED'],
 ["select set_config('test.fail_after_first','yes',true)",'TEST_BATCH_FAILURE']
]){
 await db.exec('begin');await db.exec(change);await assert.rejects(()=>db.exec(guarded),new RegExp(error));await db.exec('rollback');
 assert.deepEqual(await rows('select * from branch_stock order by product_id'),before);
 assert.equal((await rows('select count(*)::int n from stock_movements'))[0].n,0);
 assert.equal((await rows('select count(*)::int n from fnb_branch_product_cost_events'))[0].n,0);
}
await db.exec(sql);await db.exec(sql);
for(const [material,qty,total] of [[honey,1.5796,213246],[lemon,42.5,42500],[tac,60,30000]]){
 const stock=(await rows(`select quantity from branch_stock where product_id='${material}'`))[0];
 const cost=(await rows(`select costed_quantity,total_cost from fnb_branch_product_cost_balances where product_id='${material}'`))[0];
 assert.equal(Number(stock.quantity),qty);assert.equal(Number(cost.costed_quantity),qty);assert.equal(Number(cost.total_cost),total);
}
assert.equal((await rows('select count(*)::int n from stock_movements'))[0].n,3);
assert.equal((await rows('select count(*)::int n from fnb_branch_product_cost_events'))[0].n,3);
assert.equal((await rows('select count(*)::int n from audit_log'))[0].n,1);
assert.deepEqual(await rows('select * from fnb_invoice_item_bom_snapshot_components_00410 order by invoice_item_id,material_id'),snapshots);
console.log('PASS: audited one-off inventory corrections +4 lemon / +4 tac / -0.087 honey bottles, actual WAC ledger, 21 source rows, unchanged closed snapshots, cancelled/returned/changed bill guards, cost mismatch, full batch rollback and replay once');
}finally{await db.close();}
