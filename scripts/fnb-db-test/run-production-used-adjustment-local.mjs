import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const source=fs.readFileSync('scripts/fnb-db-test/run-actual-prepared-yield-local.mjs','utf8');
const setup=`
 await db.exec(\`alter table products add column unit text default 'Tui';alter table products add column name text default 'Fixture';alter table products add column code text default 'FIX';
 alter table stock_movements add column unit_cost numeric;alter table stock_movements add column created_at timestamptz default now();
 alter table production_orders add column notes text;alter table product_lots add column updated_at timestamptz;
 create table tenants(id uuid primary key);create table branches(id uuid primary key);
 insert into tenants values('10000000-0000-0000-0000-000000000001');insert into branches values('20000000-0000-0000-0000-000000000002');
 create table lot_allocations(id uuid primary key default gen_random_uuid(),tenant_id uuid,lot_id uuid,source_type text,source_id uuid,quantity numeric,reverted_at timestamptz);
 create function resolve_product_uom_factor(uuid,uuid,text) returns numeric language sql as $$select case when $3='G' and (select unit from products where id=$2)<>'G' then .002 else 1 end$$;
 alter table fnb_branch_product_cost_events drop constraint if exists fnb_branch_product_cost_events_source_type_check;
 create table preserved_bills(id uuid primary key,total numeric,payment jsonb,bom jsonb);\`);
 await db.exec(fs.readFileSync('supabase/migrations/00526_production_quantity_corrections.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/202610230002_production_correction_lot_scope.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/202610230003_production_used_adjustment.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/202610230003_production_used_adjustment.sql','utf8'));
`;
const checks=`
{
 // Reconcile the bounded nested-input fixture before exercising real adjustment logic.
 await db.exec(\`update product_lots set current_qty=current_qty-((select sum(current_qty) from product_lots where product_id='\${prepared}')-(select quantity from branch_stock where product_id='\${prepared}')) where id=(select id from product_lots where product_id='\${prepared}' order by current_qty desc limit 1);
 update branch_stock set quantity=quantity+10 where product_id='\${raw}';update products set stock=stock+10 where id='\${raw}';update fnb_branch_product_cost_balances set costed_quantity=costed_quantity+10,total_cost=total_cost+10*unit_cost where product_id='\${raw}';\`);
 // Seed the source lot in the bounded receipt fixture (commercial receipts are stubs).
 await db.exec(\`insert into product_lots(tenant_id,branch_id,product_id,lot_number,source_type,initial_qty,current_qty,status) select tenant_id,branch_id,product_id,'RAW-RECEIPT','purchase',quantity,quantity,'active' from branch_stock where product_id='\${raw}'\`);
 const usedOrder=crypto.randomUUID(),bill=crypto.randomUUID();
 await db.exec(\`update products set unit='G' where id='\${prepared}';insert into production_orders(id,tenant_id,branch_id,product_id,code,created_by,status,planned_qty) values('\${usedOrder}','\${tenant}','\${branch}','\${prepared}','SX-USED','\${actor}','planned',1000);
 insert into production_order_materials values(gen_random_uuid(),'\${usedOrder}','\${raw}',.2,null,'Tui',12500);\`);
 await db.query('select complete_production_atomic($1,1000,$2,current_date,null)',[usedOrder,'USED']);
 const own=(await db.query('select id from product_lots where production_order_id=$1',[usedOrder])).rows[0].id;
 const issue=async n=>{
  const uc=Number((await db.query('select unit_cost from fnb_branch_product_cost_balances where product_id=$1',[prepared])).rows[0].unit_cost);
  await db.exec(\`update product_lots set current_qty=current_qty-\${n},status=case when current_qty=\${n} then 'consumed' else status end where id='\${own}';update branch_stock set quantity=quantity-\${n} where product_id='\${prepared}';update products set stock=stock-\${n} where id='\${prepared}';update fnb_branch_product_cost_balances set costed_quantity=costed_quantity-\${n},total_cost=total_cost-\${n*uc} where product_id='\${prepared}';insert into lot_allocations(tenant_id,lot_id,source_type,source_id,quantity) values('\${tenant}','\${own}','invoice','\${bill}',\${n});\`);
 };
 await db.exec(\`insert into preserved_bills values('\${bill}',50000,'{"method":"transfer","paid":50000}','{"sugar":"100%","quantity":400}')\`);
 await issue(400);
 const frozen=await db.query('select * from preserved_bills');
 const stamp=async()=>String((await db.query('select updated_at::text value from production_orders where id=$1',[usedOrder])).rows[0].value);
 const input=(q=.2)=>JSON.stringify([{productId:raw,quantity:q,unit:'Tui',expectedFactor:1}]);
 const preview=async(output=800,materials=input(),version=null)=>(await db.query('select preview_production_used_adjustment($1,$2,$3,$4,$5) result',[usedOrder,version??await stamp(),output,materials,'Measured correction'])).rows[0].result;
 const apply=async(plan,version,request=crypto.randomUUID(),materials=input())=>(await db.query('select apply_production_used_adjustment($1,$2,$3,$4,$5,$6,$7) result',[usedOrder,version,plan.outputAfter,materials,'Measured correction',request,plan.token])).rows[0].result;
 const physical=async()=>(await db.query('select * from branch_stock order by product_id')).rows;
 let version=await stamp(),before=await physical();
 const beforeAudit=(await db.query('select count(*) n from audit_log')).rows[0].n;
 let plan=await preview();
 assert.equal(plan.usedQuantity,400);assert.equal(plan.remainingAfter,400);assert.equal(plan.stockDelta,-200);
 assert.deepEqual(await physical(),before,'preview is read-only');assert.equal((await db.query('select count(*) n from audit_log')).rows[0].n,beforeAudit);
 assert.ok(Math.abs(plan.inventoryCostDelta+plan.usedCostDelta-(plan.batchCostAfter-plan.batchCostBefore))<.0001,'cost partition conserves total');
 await issue(10);
 await assert.rejects(()=>apply(plan,version),/PRODUCTION_ADJUSTMENT_PREVIEW_STALE/,'sale invalidates preview even without order stamp change');
 plan=await preview(); const req=crypto.randomUUID();
 const oldAlloc=(await db.query('select * from lot_allocations order by id')).rows;
 const baseline=await qty(prepared);
 const res=await apply(plan,version,req);
 assert.equal(await qty(prepared),baseline-200);assert.equal(Number((await db.query('select current_qty from product_lots where id=$1',[own])).rows[0].current_qty),390);
 assert.deepEqual((await db.query('select * from lot_allocations order by id')).rows,oldAlloc,'bill allocations untouched');
 await apply(plan,version,req);assert.equal(await qty(prepared),baseline-200,'retry does not apply twice');
 await assert.rejects(()=>apply({...plan,outputAfter:900},version,req),/PRODUCTION_CORRECTION_REQUEST_CHANGED/);
 await assert.rejects(()=>preview(900,input(),version),/PRODUCTION_CORRECTION_STALE/);
 await assert.rejects(()=>preview(409),/PRODUCTION_ADJUSTMENT_BELOW_USED/);
 assert.deepEqual((await db.query('select * from preserved_bills')).rows,frozen.rows,'paid totals, sugar/BOM and payments unchanged');
 await db.exec(\`update product_lots set current_qty=(select quantity from branch_stock where product_id='\${raw}') where product_id='\${raw}'\`);
 version=await stamp(); before=await physical(); plan=await preview(800,input(.25));
 assert.ok(plan.materials[0].stockDelta<0,'understated ingredient consumes delta only');
 assert.ok(plan.usedCostDelta>0,'used portion variance stored separately');
 await db.exec(\`create function fail_used_adjustment() returns trigger language plpgsql as $$begin if new.action='production_used_adjustment' then raise exception 'TEST_LATE_FAILURE';end if;return new;end$$;create trigger fail_used before insert on audit_log for each row execute function fail_used_adjustment();\`);
 const costs=(await db.query('select * from fnb_branch_product_cost_balances order by product_id')).rows;
 await assert.rejects(()=>apply(plan,version,crypto.randomUUID(),input(.25)),/TEST_LATE_FAILURE/);
 assert.deepEqual(await physical(),before,'late failure rolls back both sides');assert.deepEqual((await db.query('select * from fnb_branch_product_cost_balances order by product_id')).rows,costs,'cost rollback');
 await db.exec('drop trigger fail_used on audit_log;drop function fail_used_adjustment();');
 await apply(plan,version,crypto.randomUUID(),input(.25));
 assert.ok(Math.abs(await qty(raw)-(Number(before.find(r=>r.product_id===raw).quantity)-.05))<.0001);
 await db.exec(\`update product_lots set current_qty=(select quantity from branch_stock where product_id='\${raw}') where product_id='\${raw}'\`);
 version=await stamp(); plan=await preview(800,input(.2));await apply(plan,version); // restore only surplus .05
 assert.ok(Math.abs(await qty(raw)-Number(before.find(r=>r.product_id===raw).quantity))<.0001);
 // Fully used batch permits cost-only correction; its remaining inventory value stays zero.
 await db.exec(\`update product_lots set current_qty=(select quantity from branch_stock where product_id='\${raw}') where product_id='\${raw}'\`);
 await issue(390); version=await stamp();plan=await preview(800,input(.21));assert.equal(plan.remainingAfter,0);assert.equal(plan.inventoryCostDelta,0);assert.ok(plan.usedCostDelta>0);
 await apply(plan,version,crypto.randomUUID(),input(.21));
 // Increasing measured output reopens a fully consumed lot without changing sold quantity.
 version=await stamp();plan=await preview(900,input(.21));assert.equal(plan.remainingAfter,100);await apply(plan,version,crypto.randomUUID(),input(.21));
 assert.equal((await db.query('select status from product_lots where id=$1',[own])).rows[0].status,'active');
 await db.exec(\`update product_lots set current_qty=(select quantity from branch_stock where product_id='\${raw}') where product_id='\${raw}'\`);
 // Second SKU with direct BTP + raw inputs uses exactly the same code path.
 const secondStamp=String((await db.query('select updated_at::text value from production_orders where id=$1',[nested])).rows[0].value);
 const secondInputs=JSON.stringify([{productId:prepared,quantity:40,unit:'G',expectedFactor:1},{productId:raw,quantity:.01,unit:'Tui',expectedFactor:1}]);
 const secondPlan=(await db.query('select preview_production_used_adjustment($1,$2,90,$3,$4) result',[nested,secondStamp,secondInputs,'Other SKU'])).rows[0].result;
 const raw2=await qty(raw),btp2=await qty(prepared);
 await db.query('select apply_production_used_adjustment($1,$2,90,$3,$4,$5,$6)',[nested,secondStamp,secondInputs,'Other SKU',crypto.randomUUID(),secondPlan.token]);
 assert.equal(await qty(raw),raw2,'BTP adjustment never explodes its BOM');assert.equal(await qty(prepared),btp2+10);
 for(const id of [raw,prepared,mix]) assert.ok(Math.abs(Number((await db.query('select costed_quantity from fnb_branch_product_cost_balances where product_id=$1',[id])).rows[0].costed_quantity)-await qty(id))<.0001);
 // The inherited lot-reconcile helper is a bounded stub: align the returned BTP 10g.
 await db.exec(\`update product_lots set current_qty=current_qty+10 where id=(select id from product_lots where product_id='\${prepared}' and id<>'\${own}' order by current_qty desc limit 1)\`);
 // Drift, insufficient ingredient stock, UOM changes, permissions all fail before writes.
 await assert.rejects(()=>preview(900,input(9999)),/PRODUCTION_CORRECTION_STOCK_REQUIRED/);
 await assert.rejects(()=>preview(900,JSON.stringify([{productId:raw,quantity:1,unit:'G',expectedFactor:1}])),/UOM_CONVERSION_CHANGED/);
 await db.exec(\`update product_lots set current_qty=current_qty-1 where id='\${own}'\`);
 await assert.rejects(()=>preview(900,input(.21)),/PRODUCTION_CORRECTION_LOT_RECONCILIATION_REQUIRED/);
 // New correction-to-zero must still permit cancellation of an unused batch.
 await db.exec(\`update product_lots set current_qty=current_qty+1 where id='\${own}'\`);
 const zeroStamp=String((await db.query('select updated_at::text value from production_orders where id=$1',[nested])).rows[0].value);
 const zeroInputs=JSON.stringify([{productId:prepared,quantity:40,unit:'G',expectedFactor:1},{productId:raw,quantity:0,unit:'Tui',expectedFactor:1}]);
 const zeroPlan=(await db.query('select preview_production_used_adjustment($1,$2,90,$3,$4) result',[nested,zeroStamp,zeroInputs,'Wrong ingredient'])).rows[0].result;
 await db.query('select apply_production_used_adjustment($1,$2,90,$3,$4,$5,$6)',[nested,zeroStamp,zeroInputs,'Wrong ingredient',crypto.randomUUID(),zeroPlan.token]);
 const cancelStamp=String((await db.query('select updated_at::text value from production_orders where id=$1',[nested])).rows[0].value);
 await db.query('select correct_production_order_quantities($1,$2,$3,0,$4,$5,true)',[nested,cancelStamp,crypto.randomUUID(),'[]','Cancel adjusted unused batch']);
 assert.equal(await qty(mix),0,'cancel withdraws all of the corrected unused output');
 // Non-F&B/variant production without branch cost tracking follows the same API
 // and updates global inventory valuation rather than creating F&B balances.
 const generic=crypto.randomUUID(),genericRaw=crypto.randomUUID(),genericOrder=crypto.randomUUID(),genericVariant=crypto.randomUUID(),genericLot=crypto.randomUUID();
 await db.exec(\`update fnb_supply_branch_scopes set enforcement_enabled=false;
 insert into products(id,tenant_id,is_fnb_stock_item,stock,cost_price,unit) values ('\${generic}','\${tenant}',false,600,.3,'G'),('\${genericRaw}','\${tenant}',false,10,100,'G');
 insert into branch_stock(tenant_id,branch_id,product_id,variant_id,quantity) values ('\${tenant}','\${branch}','\${generic}','\${genericVariant}',600),('\${tenant}','\${branch}','\${genericRaw}',null,10);
 insert into production_orders(id,tenant_id,branch_id,product_id,variant_id,code,status,planned_qty,completed_qty,cogs_amount,updated_at) values ('\${genericOrder}','\${tenant}','\${branch}','\${generic}','\${genericVariant}','SX-GENERIC','completed',1000,1000,300,now());
 insert into production_order_materials values(gen_random_uuid(),'\${genericOrder}','\${genericRaw}',3,3,'G',100);
 insert into product_lots(id,tenant_id,branch_id,product_id,variant_id,production_order_id,lot_number,source_type,initial_qty,current_qty,status) values('\${genericLot}','\${tenant}','\${branch}','\${generic}','\${genericVariant}','\${genericOrder}','GENERIC','production',1000,600,'active');
 insert into product_lots(tenant_id,branch_id,product_id,lot_number,source_type,initial_qty,current_qty,status) values('\${tenant}','\${branch}','\${genericRaw}','GENERIC-RAW','purchase',10,10,'active');
 insert into lot_allocations(tenant_id,lot_id,source_type,source_id,quantity) values('\${tenant}','\${genericLot}','invoice','\${bill}',400);\`);
 const genericStamp=String((await db.query('select updated_at::text value from production_orders where id=$1',[genericOrder])).rows[0].value);
 const genericInput=JSON.stringify([{productId:genericRaw,quantity:2,unit:'G',expectedFactor:1}]);
 const genericPlan=(await db.query('select preview_production_used_adjustment($1,$2,800,$3,$4) result',[genericOrder,genericStamp,genericInput,'Generic SKU'])).rows[0].result;
 await db.query('select apply_production_used_adjustment($1,$2,800,$3,$4,$5,$6)',[genericOrder,genericStamp,genericInput,'Generic SKU',crypto.randomUUID(),genericPlan.token]);
 assert.equal(await qty(generic),400);assert.equal(await qty(genericRaw),11);
 assert.equal(Number((await db.query('select cost_price from products where id=$1',[generic])).rows[0].cost_price),.25,'global valuation after used-output and ingredient correction');
 assert.equal(Number((await db.query('select count(*) n from fnb_branch_product_cost_balances where product_id=$1',[generic])).rows[0].n),0,'generic SKU creates no F&B cost balance');
 const history=(await db.query('select preview,reason,created_by,created_at,inventory_cost_delta,used_cost_delta from production_used_adjustments where production_order_id=$1 order by created_at desc',[genericOrder])).rows[0];
 assert.equal(history.reason,'Generic SKU');assert.equal(history.created_by,actor);assert.equal(history.preview.outputBefore,1000);assert.equal(history.preview.outputAfter,800);assert.equal(history.preview.usedQuantity,400);
 assert.equal(Number(history.inventory_cost_delta)+Number(history.used_cost_delta),-100);
 await db.exec('update fnb_supply_branch_scopes set enforcement_enabled=true;');
 // RLS exposes no adjustment rows to another tenant or anonymous client.
 await db.exec('grant select on profiles to authenticated;grant usage on schema auth to authenticated;');
 await db.exec(\`select set_config('request.jwt.claim.sub',gen_random_uuid()::text,false);set role authenticated;\`);
 assert.equal(Number((await db.query('select count(*) n from production_used_adjustments')).rows[0].n),0);
 await db.exec(\`reset role;select set_config('request.jwt.claim.sub','\${actor}',false);\`);
 await db.exec(\`create or replace function user_has_permission(uuid,text) returns boolean language sql stable as $$select false$$;\`);
 await assert.rejects(()=>preview(900,input(.21)),/PRODUCTION_CORRECTION_PERMISSION_REQUIRED/);
 assert.equal((await db.query(\`select has_function_privilege('authenticated','public._production_used_adjustment(uuid,timestamptz,numeric,jsonb,text,boolean,uuid,text)','execute') allowed\`)).rows[0].allowed,false);
 assert.deepEqual((await db.query('select * from preserved_bills')).rows,frozen.rows);
 console.log('PASS: used batch preview/apply, exact stock deltas, cost partition, full use, stale sale, replay, rollback, multiple SKUs/BTP, permissions and immutable bills');
`;
const generated=source.replace('  const branch=',()=>setup+'\n  const branch=').replace("  console.log('PASS: BTP-to-BTP",()=>checks+'}'+"\n  console.log('PASS: BTP-to-BTP");
fs.mkdirSync('.tmp',{recursive:true});const target=path.resolve('.tmp/run-production-used-adjustment-generated.mjs');fs.writeFileSync(target,generated);
execFileSync(process.execPath,[target,path.resolve(process.argv[2])],{stdio:'inherit'});
