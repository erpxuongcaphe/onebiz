import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const source=fs.readFileSync('scripts/fnb-db-test/run-actual-prepared-yield-local.mjs','utf8');
const setup=`
  await db.exec(\`alter table products add column unit text default 'Tui'; alter table products add column name text default 'Fixture'; alter table products add column code text default 'FIX';
    alter table stock_movements add column unit_cost numeric; alter table stock_movements add column created_at timestamptz default now();
    alter table production_orders add column notes text; alter table product_lots add column updated_at timestamptz;
    create table lot_allocations(id uuid primary key default gen_random_uuid(),tenant_id uuid,lot_id uuid,source_type text,source_id uuid,quantity numeric,reverted_at timestamptz);
    create table operational_uom_requests(reference_type text,request_id uuid,tenant_id uuid,branch_id uuid,reference_id uuid,payload jsonb,snapshots jsonb,result jsonb,created_by uuid,created_at timestamptz default now(),primary key(reference_type,request_id));
    alter table fnb_branch_product_cost_events drop constraint if exists fnb_branch_product_cost_events_source_type_check;
    alter table product_lots add constraint lot_status_test check(status in ('active','expired','consumed','disposed','cancelled'));
    create function resolve_product_uom_factor(uuid,uuid,text) returns numeric language sql as $$select case when $3='G' and (select unit from products where id=$2)<>'G' then .002 else 1 end$$;\`);
  await db.exec(fs.readFileSync('supabase/migrations/00526_production_quantity_corrections.sql','utf8'));
  await db.exec(fs.readFileSync('supabase/migrations/202610230002_production_correction_lot_scope.sql','utf8'));
  await db.exec(fs.readFileSync('supabase/migrations/202610230002_production_correction_lot_scope.sql','utf8'));
`;
const checks=`
  // The inherited fixture bounds lot reconciliation to a stub. Align its prior
  // nested-production issue before testing the real correction/lot guards.
  await db.exec(\`update product_lots set current_qty=current_qty-((select sum(current_qty) from product_lots where product_id='\${prepared}')-(select quantity from branch_stock where product_id='\${prepared}'))
    where id=(select id from product_lots where product_id='\${prepared}' order by current_qty desc limit 1);\`);
  const corrected=crypto.randomUUID(),req=crypto.randomUUID();
  await db.exec(\`update branch_stock set quantity=quantity+10 where product_id='\${raw}';update products set stock=stock+10 where id='\${raw}';
    update fnb_branch_product_cost_balances set costed_quantity=costed_quantity+10,total_cost=total_cost+10*unit_cost where product_id='\${raw}';\`);
  const rawBefore=await qty(raw); let preparedBefore=await qty(prepared);
  const costBefore=(await db.query(\`select product_id,total_cost from fnb_branch_product_cost_balances where branch_id='\${branch}'\`)).rows;
  await db.exec(\`update products set unit='G' where id='\${prepared}';
    insert into production_orders(id,tenant_id,branch_id,product_id,code,created_by,status,planned_qty) values('\${corrected}','\${tenant}','\${branch}','\${prepared}','SX-CORRECT','\${actor}','planned',585);
    insert into production_order_materials values(gen_random_uuid(),'\${corrected}','\${raw}',3.441,null,'Tui',12500);\`);
  await db.query(\`select complete_production_atomic('\${corrected}',585,'CORRECT',current_date,null)\`);
  // Regression for SX000091: an 80g sale AFTER completion, allocated to an
  // older lot. It must not prevent correcting/cancelling this untouched lot.
  const olderLot=(await db.query(\`select id,current_qty from product_lots where product_id='\${prepared}' and production_order_id is distinct from '\${corrected}'::uuid order by current_qty desc limit 1\`)).rows[0];
  const soldCost=Math.round(80*Number((await db.query(\`select unit_cost from fnb_branch_product_cost_balances where product_id='\${prepared}'\`)).rows[0].unit_cost)*10000)/10000;
  preparedBefore-=80;
  const costBaseline=costBefore.find(b=>b.product_id===prepared);
  costBaseline.total_cost=Number(costBaseline.total_cost)-soldCost;
  await db.exec(\`update product_lots set current_qty=current_qty-80 where id='\${olderLot.id}';
    update branch_stock set quantity=quantity-80 where product_id='\${prepared}'; update products set stock=stock-80 where id='\${prepared}';
    update fnb_branch_product_cost_balances set costed_quantity=costed_quantity-80,total_cost=total_cost-\${soldCost},unit_cost=(total_cost-\${soldCost})/(costed_quantity-80) where product_id='\${prepared}';
    insert into stock_movements(tenant_id,branch_id,product_id,type,quantity,reference_type,reference_id,created_at,created_by) values('\${tenant}','\${branch}','\${prepared}','out',80,'fixture_existing_lot_sale',gen_random_uuid(),now(),'\${actor}');
    insert into lot_allocations(tenant_id,lot_id,source_type,source_id,quantity) values('\${tenant}','\${olderLot.id}','invoice',gen_random_uuid(),80);\`);
  const stamp=(await db.query(\`select updated_at::text stamp from production_orders where id='\${corrected}'\`)).rows[0].stamp;
  const call=(request= req,reason='Correct mistaken input',stampOverride=stamp,materials=[{productId:raw,quantity:200,unit:'G',expectedFactor:.002}])=>
    db.query('select correct_production_order_quantities($1,$2,$3,$4,$5,$6,false)',[corrected,stampOverride,request,585,JSON.stringify(materials),reason]);
  const physical=()=>db.query('select branch_id,product_id,quantity from branch_stock order by branch_id,product_id');
  const beforeInvalid=(await physical()).rows;
  await db.exec(fs.readFileSync('supabase/migrations/00526_production_quantity_corrections.sql','utf8'));
  await assert.rejects(()=>call(),/PRODUCTION_CORRECTION_OUTPUT_USED/,'old function reproduces the false block after another-lot sale');
  assert.deepEqual((await physical()).rows,beforeInvalid,'old rejected attempt changed no stock');
  await db.exec(fs.readFileSync('supabase/migrations/202610230002_production_correction_lot_scope.sql','utf8'));
  await assert.rejects(()=>call(crypto.randomUUID(),'bad unit',stamp,[{productId:raw,quantity:200,unit:'G',expectedFactor:1}]),/UOM_CONVERSION_CHANGED/);
  assert.deepEqual((await physical()).rows,beforeInvalid,'invalid conversion is atomic');
  await call();
  assert.ok(Math.abs(await qty(raw)-(rawBefore-.4))<.0001,'correcting an oversized ingredient returns only excess stock');
  assert.equal(await qty(prepared),preparedBefore+585,'cost-only correction preserves measured output');
  const correctedCost=Number((await db.query(\`select cogs_amount from production_orders where id='\${corrected}'\`)).rows[0].cogs_amount);
  const issuedUnitCost=Number((await db.query(\`select unit_cost from production_order_materials where production_order_id='\${corrected}'\`)).rows[0].unit_cost);
  assert.equal(correctedCost,Math.round(.4*issuedUnitCost*100)/100,'cost corrected using recorded issue price');
  const preparedCostAfter=Number((await db.query(\`select total_cost from fnb_branch_product_cost_balances where branch_id='\${branch}' and product_id='\${prepared}'\`)).rows[0].total_cost);
  assert.ok(Math.abs(preparedCostAfter-(Number(costBefore.find(b=>b.product_id===prepared).total_cost)+correctedCost))<.01,'output valuation removes the oversized batch cost');
  const afterCorrection=(await physical()).rows;
  await call();
  assert.deepEqual((await physical()).rows,afterCorrection,'same request replay cannot restore twice');
  await assert.rejects(()=>call(req,'changed request'),/PRODUCTION_CORRECTION_REQUEST_CHANGED/);
  await assert.rejects(()=>call(crypto.randomUUID(),'stale request'),/PRODUCTION_CORRECTION_STALE/);
  for(const id of [raw,prepared]) {
    const balance=(await db.query(\`select costed_quantity from fnb_branch_product_cost_balances where branch_id='\${branch}' and product_id='\${id}'\`)).rows[0];
    assert.ok(Math.abs(Number(balance.costed_quantity)-await qty(id))<.0001,'corrected cost quantity agrees with physical stock');
  }
  const newStamp=(await db.query(\`select updated_at::text stamp from production_orders where id='\${corrected}'\`)).rows[0].stamp;
  const ownLot=(await db.query(\`select id from product_lots where production_order_id='\${corrected}'\`)).rows[0].id;
  await db.exec(\`insert into lot_allocations(tenant_id,lot_id,source_type,source_id,quantity) values('\${tenant}','\${ownLot}','invoice',gen_random_uuid(),1);\`);
  await assert.rejects(()=>call(crypto.randomUUID(),'active allocation',newStamp),/PRODUCTION_CORRECTION_OUTPUT_USED/);
  assert.deepEqual((await physical()).rows,afterCorrection,'an active allocation blocks even if cached lot quantity is full');
  await assert.rejects(()=>db.transaction(async tx=>{
    await tx.exec(\`update lot_allocations set reverted_at=now() where lot_id='\${ownLot}'\`);
    const allowed=await tx.query('select correct_production_order_quantities($1,$2,$3,585,$4,$5,false)',[corrected,newStamp,crypto.randomUUID(),JSON.stringify([{productId:raw,quantity:200,unit:'G',expectedFactor:.002}]),'Fully returned allocation']);
    assert.equal(allowed.rows[0].correct_production_order_quantities.status,'completed','reverted allocation does not block');
    throw new Error('TEST_ROLLBACK_RETURNED_ALLOCATION');
  }),/TEST_ROLLBACK_RETURNED_ALLOCATION/);
  await db.exec(\`delete from lot_allocations where lot_id='\${ownLot}';
    update product_lots set current_qty=current_qty-1 where id='\${olderLot.id}';\`);
  await assert.rejects(()=>call(crypto.randomUUID(),'unreconciled ledger',newStamp),/PRODUCTION_CORRECTION_LOT_RECONCILIATION_REQUIRED/);
  assert.deepEqual((await physical()).rows,afterCorrection,'unallocated ledger drift cannot partially restore stock');
  await db.exec(\`update product_lots set current_qty=current_qty+1 where id='\${olderLot.id}'\`);
  await db.exec(\`create function fail_correction_audit() returns trigger language plpgsql as $$begin if new.action='production_quantity_correction' then raise exception 'TEST_CORRECTION_LATE_FAILURE';end if;return new;end$$;
    create trigger fail_correction_audit before insert on audit_log for each row execute function fail_correction_audit();\`);
  await assert.rejects(()=>db.transaction(tx=>tx.query('select correct_production_order_quantities($1,$2,$3,$4,$5,$6,false)',
    [corrected,newStamp,crypto.randomUUID(),600,JSON.stringify([{productId:raw,quantity:300,unit:'G',expectedFactor:.002}]),'Late failure'])),/TEST_CORRECTION_LATE_FAILURE/);
  assert.deepEqual((await physical()).rows,afterCorrection,'late audit failure rolls back material and output movements');
  assert.equal(Number((await db.query(\`select total_cost from fnb_branch_product_cost_balances where branch_id='\${branch}' and product_id='\${prepared}'\`)).rows[0].total_cost),preparedCostAfter,'late failure rolls back valuation too');
  await db.exec('drop trigger fail_correction_audit on audit_log;drop function fail_correction_audit();');
  await db.exec(\`update product_lots set current_qty=current_qty-1 where production_order_id='\${corrected}'\`);
  await assert.rejects(()=>call(crypto.randomUUID(),'used output',newStamp),/PRODUCTION_CORRECTION_OUTPUT_USED/);
  assert.deepEqual((await physical()).rows,afterCorrection,'used output cannot cause a partial reversal');
  await db.exec(\`update product_lots set current_qty=0,status='consumed' where production_order_id='\${corrected}'\`);
  await assert.rejects(()=>call(crypto.randomUUID(),'fully consumed lot',newStamp),/PRODUCTION_CORRECTION_OUTPUT_USED/);
  await db.exec(\`update product_lots set current_qty=initial_qty,status='active' where production_order_id='\${corrected}'\`);
  const cancelReq=crypto.randomUUID();
  await db.query('select correct_production_order_quantities($1,$2,$3,0,$4,$5,true)',[corrected,newStamp,cancelReq,'[]','Cancel erroneous batch']);
  assert.ok(Math.abs(await qty(raw)-rawBefore)<.0001,'cancel restores precisely the corrected material quantity');
  assert.equal(await qty(prepared),preparedBefore,'cancel removes only this batch output');
  assert.ok(Math.abs(Number((await db.query(\`select total_cost from fnb_branch_product_cost_balances where branch_id='\${branch}' and product_id='\${prepared}'\`)).rows[0].total_cost)-Number(costBefore.find(b=>b.product_id===prepared).total_cost))<.01,'cancel restores original output valuation');
  assert.equal((await db.query(\`select status from production_orders where id='\${corrected}'\`)).rows[0].status,'cancelled');
  assert.equal(Number((await db.query(\`select current_qty from product_lots where production_order_id='\${corrected}'\`)).rows[0].current_qty),0);
  await db.query('select correct_production_order_quantities($1,$2,$3,0,$4,$5,true)',[corrected,newStamp,cancelReq,'[]','Cancel erroneous batch']);
  assert.equal(await qty(prepared),preparedBefore,'cancel replay leaves stock unchanged');
  // A different output SKU with TWO inputs (one BTP and one raw material)
  // uses the same correction/cancellation function; no SKU-specific exception.
  const preparedBeforeSecond=await qty(prepared),rawBeforeSecond=await qty(raw);
  await db.exec(\`update products set unit='G' where id='\${mix}'\`);
  const nestedStamp=(await db.query(\`select updated_at::text stamp from production_orders where id='\${nested}'\`)).rows[0].stamp;
  await db.query('select correct_production_order_quantities($1,$2,$3,80,$4,$5,false)',[nested,nestedStamp,crypto.randomUUID(),JSON.stringify([
    {productId:prepared,quantity:40,unit:'G',expectedFactor:1},{productId:raw,quantity:.01,unit:'Tui',expectedFactor:1}
  ]),'Correct second prepared SKU']);
  assert.equal(await qty(mix),80,'another SKU supports actual output correction');
  assert.equal(await qty(prepared),preparedBeforeSecond+10,'second SKU returns only excess BTP input');
  const nestedUpdated=(await db.query(\`select updated_at::text stamp from production_orders where id='\${nested}'\`)).rows[0].stamp;
  await db.query('select correct_production_order_quantities($1,$2,$3,0,$4,$5,true)',[nested,nestedUpdated,crypto.randomUUID(),'[]','Cancel second SKU']);
  assert.equal(await qty(mix),0,'another SKU supports cancel and output withdrawal');
  assert.equal(await qty(prepared),preparedBeforeSecond+50,'BTP input is restored directly, not exploded to its raw BOM');
  assert.ok(Math.abs(await qty(raw)-(rawBeforeSecond+.01))<.0001,'second SKU restores its own raw input only');
  for(const product of [raw,prepared,mix]) {
    const b=(await db.query(\`select costed_quantity from fnb_branch_product_cost_balances where product_id='\${product}'\`)).rows[0];
    assert.ok(Math.abs(Number(b.costed_quantity)-await qty(product))<.0001,'all SKU cost quantities stay aligned after correction/cancel');
  }
  console.log('PASS: shared correction/cancel across multiple output SKUs with raw and prepared inputs');
  await db.exec(\`create or replace function user_has_permission(uuid,text) returns boolean language sql stable as $$select false$$;\`);
  await assert.rejects(()=>call(crypto.randomUUID(),'denied'),/PRODUCTION_CORRECTION_PERMISSION_REQUIRED/);
  assert.equal(Number((await db.query(\`select current_qty from product_lots where id='\${olderLot.id}'\`)).rows[0].current_qty),Number(olderLot.current_qty)-80,'cancelling does not rewrite other lots or their invoice allocation');
  console.log('PASS: other-lot sale allows correction and cancel; own active/used lot blocked; returned allocations allowed; ledger drift rejected; other-lot history preserved');
  console.log('PASS: correction/cancel, conversion validation, issue cost, physical-cost balance, used-output guard, stale version, idempotency and permissions');
`;
const generated=source.replace("  const branch=",()=>setup+"\n  const branch=").replace("  console.log('PASS: BTP-to-BTP",()=>checks+"\n  console.log('PASS: BTP-to-BTP");
const target=path.resolve('.tmp/run-production-corrections-generated.mjs');fs.writeFileSync(target,generated);
execFileSync(process.execPath,[target,path.resolve(process.argv[2])],{stdio:'inherit'});
