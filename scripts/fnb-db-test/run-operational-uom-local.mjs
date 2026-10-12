import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const pglite=path.resolve(process.argv[2]);
const resolver=fs.readFileSync('supabase/migrations/00320_uom_accounting_snapshots.sql','utf8').match(/create or replace function public\.resolve_product_uom_factor[\s\S]*?\n\$\$;/i)[0];
const install=`
 await db.exec(\`create table if not exists tenants(id uuid primary key); insert into tenants select distinct tenant_id from profiles on conflict do nothing;
 create table if not exists branches(id uuid primary key,tenant_id uuid);
 create or replace function _can_read_branch_inventory_00476(uuid,uuid,uuid) returns boolean language sql as $$select user_has_branch_access($1,$3)$$;
 create table uom_conversions(tenant_id uuid,product_id uuid,from_unit text,to_unit text,factor numeric,is_active boolean);
 alter table products add column if not exists is_active boolean default true; alter table products add column if not exists unit text default 'G';
 alter table products add column if not exists name text default 'Fixture product'; alter table products add column if not exists code text default 'FIXTURE';\`);
 await db.exec(${JSON.stringify(resolver)});
 const beforeUom=(await db.query('select branch_id,product_id,quantity from branch_stock order by branch_id,product_id')).rows;
 await db.exec(fs.readFileSync('supabase/migrations/00515_operational_uom_snapshots.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/00515_operational_uom_snapshots.sql','utf8'));
 assert.deepEqual((await db.query('select branch_id,product_id,quantity from branch_stock order by branch_id,product_id')).rows,beforeUom,'migration preserves every existing stock quantity');
`;
const prod=`
 ${install}
 await db.exec(\`insert into branches(id,tenant_id) values('${'20000000-0000-0000-0000-000000000002'}','${'10000000-0000-0000-0000-000000000001'}') on conflict do nothing;
 update products set unit='Mẻ' where id='\${prepared}'; update products set unit='Tui' where id='\${raw}';
 insert into uom_conversions values('\${tenant}','\${prepared}','Mẻ','G',1100,true),('\${tenant}','\${raw}','Tui','G',500,true);\`);
 const order=crypto.randomUUID(),inputQty=550;
 await db.exec(\`insert into production_orders(id,tenant_id,branch_id,product_id,code,created_by,status,planned_qty) values('\${order}','\${tenant}','\${branch}','\${prepared}','SX-UOM','\${actor}','planned',1);
 insert into production_order_materials(id,production_order_id,product_id,planned_qty,unit,unit_cost) values(gen_random_uuid(),'\${order}','\${raw}',.5,'Tui',12500);\`);
 const beforeRaw=await qty(raw),beforePrepared=await qty(prepared);
 const materialInputs=JSON.stringify([{productId:raw,quantity:250,unit:'G',expectedFactor:.002}]);
 const call=() => db.query(\`select complete_production_with_uom('\${order}',550,'G',round(1::numeric/1100,12),'UOM',current_date,null,'\${materialInputs}'::jsonb) id\`);
 const lot=(await call()).rows[0].id;
 assert.equal(await qty(raw),beforeRaw-.5); assert.equal(await qty(prepared),beforePrepared+.5);
 const snap=(await db.query(\`select snapshots from operational_uom_requests where request_id='\${order}'\`)).rows[0].snapshots[0];
 assert.equal(Number(snap.inputQuantity),550); assert.equal(Number(snap.stockQuantity),.5); assert.equal(snap.stockUnit,'Mẻ');
 const materialSnap=(await db.query(\`select snapshots->1 s from operational_uom_requests where request_id='\${order}'\`)).rows[0].s;
 assert.equal(Number(materialSnap.inputQuantity),250);assert.equal(Number(materialSnap.stockQuantity),.5);assert.equal(materialSnap.role,'material');
 await db.exec('update uom_conversions set factor=1000');
 assert.equal((await call()).rows[0].id,lot,'replay uses original snapshot after factor changes');
 assert.equal(await qty(raw),beforeRaw-.5); assert.equal(await qty(prepared),beforePrepared+.5);
 await assert.rejects(db.query(\`select complete_production_with_uom('\${order}',600,'G',null,'UOM',current_date,null)\`),/REQUEST_CHANGED/);
 // Delegate fixtures isolate normalization/idempotency from the already tested
 // real production/receiving stock chains. Preserve real RPC response shapes.
 await db.exec(\`create table unit_delegate_calls(kind text,items jsonb);
 create or replace function create_stock_transfer_atomic(uuid,uuid,text,jsonb) returns jsonb language plpgsql as $$begin
 insert into unit_delegate_calls values('transfer',$4);return jsonb_build_object('transfer_id',gen_random_uuid(),'code','CK-UOM');end;$$;
 create or replace function create_disposal_export_atomic(uuid,text,text,jsonb) returns jsonb language plpgsql as $$begin
 insert into unit_delegate_calls values('disposal',$4);return jsonb_build_object('id',gen_random_uuid(),'code','XH-UOM','cost',123456);end;$$;
 create or replace function create_internal_export_atomic(uuid,text,text,jsonb) returns jsonb language plpgsql as $$begin
 insert into unit_delegate_calls values('internal_export',$4);return jsonb_build_object('id',gen_random_uuid(),'code','XN-UOM','cost',123456);end;$$;
 create or replace function create_and_apply_inventory_check_atomic(uuid,text,jsonb) returns jsonb language plpgsql as $$begin
 insert into unit_delegate_calls values('inventory_check',$3);return jsonb_build_object('check_id',gen_random_uuid(),'code','KK-UOM','status','balanced','cost',123456);end;$$;\`);
 for(const kind of ['transfer','disposal','internal_export','inventory_check']) {
   const key=crypto.randomUUID(),rawQuantity=kind==='inventory_check'?0:250;
   const args=JSON.stringify([{product_id:prepared,quantity:rawQuantity,inputUnit:'G',expectedFactor:.001}]);
   const invoke=()=>db.query(\`select create_stock_operation_with_uom('\${kind}','\${branch}','\${args}'::jsonb,'\${key}','\${branch}','Test',null) r\`);
   const result=(await invoke()).rows[0].r;
   assert.ok(result.id && result.code);assert.equal(result.cost,undefined,'unit metadata cannot leak costs');
   if(kind==='transfer')assert.equal(result.transfer_id,result.id);
   if(kind==='inventory_check'){assert.equal(result.check_id,result.id);assert.equal(result.status,'balanced');}
   const call=(await db.query(\`select items from unit_delegate_calls where kind='\${kind}'\`)).rows[0].items[0];
   assert.equal(Number(call[kind==='inventory_check'?'actual_stock':'quantity']),kind==='inventory_check'?0:.25);
   await db.exec('update uom_conversions set factor=900');
   assert.deepEqual((await invoke()).rows[0].r,result,'retry after factor change returns original result');
   assert.equal(Number((await db.query(\`select count(*) n from unit_delegate_calls where kind='\${kind}'\`)).rows[0].n),1);
   await assert.rejects(db.query(\`select create_stock_operation_with_uom('\${kind}','\${branch}','\${args}'::jsonb,'\${crypto.randomUUID()}','\${branch}','Test',null)\`),/CONVERSION_CHANGED/);
   await db.exec('update uom_conversions set factor=1000');
 }
 console.log('PASS operational transfer/export/count wrappers: fractional quantities, zero count, actual response shapes, private cost masking, retry exactly once and stale factor rejection.');
 const packArgs=JSON.stringify([{product_id:prepared,quantity:.5,inputUnit:'Mẻ',expectedFactor:1,parts:[{quantity:.25,unit:'Mẻ',expectedFactor:1},{quantity:250,unit:'G',expectedFactor:.001}]}]);
 const packKey=crypto.randomUUID();
 await db.query(\`select create_stock_operation_with_uom('inventory_check','\${branch}','\${packArgs}'::jsonb,'\${packKey}',null,null,null)\`);
 const packSnap=(await db.query(\`select snapshots->0 s from operational_uom_requests where request_id='\${packKey}'\`)).rows[0].s;
 assert.equal(packSnap.parts.length,2);assert.equal(Number(packSnap.stockQuantity),.5);
 await db.exec('update uom_conversions set factor=900');
 await assert.rejects(db.query(\`select create_stock_operation_with_uom('inventory_check','\${branch}','\${packArgs}'::jsonb,'\${crypto.randomUUID()}',null,null,null)\`),/CONVERSION_CHANGED/);
 console.log('PASS count packaging: original full-pack and loose quantities retained; stale pack conversion rejected.');
 await db.exec(\`create or replace function user_has_branch_access(uuid,uuid) returns boolean language sql as $$select false$$;\`);
 await assert.rejects(call(),/BRANCH_ACCESS_DENIED/);
 console.log('PASS operational production: exact legacy conversion; immutable original weight/factor; actual NVL unchanged; factor-change replay; changed payload and branch denial; migration leaves historical stock intact.');
`;
const receive=`
 ${install}
 await db.exec(\`insert into uom_conversions values('\${context.tenant_id}','\${context.product}','\${context.unit}','G',500,true);\`);
 const unitSale=await createSale(); const unitItem=(await db.query(\`select id from internal_sale_items where internal_sale_id='\${unitSale.internal_sale_id}'\`)).rows[0].id;
 const req=crypto.randomUUID(),unitBefore=await stock();
 const unitCall=(q=375,key=req)=>db.query(\`select receive_internal_sale_with_uom('\${unitSale.internal_sale_id}','\${JSON.stringify([{itemId:unitItem,quantity:q,inputUnit:'G',expectedFactor:.002}])}'::jsonb,'\${key}',null,null,null) r\`);
 const received=(await unitCall()).rows[0].r;
 assert.equal(await stock(),unitBefore+.75);
 const snap=(await db.query(\`select snapshots from operational_uom_requests where request_id='\${req}'\`)).rows[0].snapshots[0];
 assert.equal(Number(snap.inputQuantity),375); assert.equal(Number(snap.stockQuantity),.75);
 await db.exec('update uom_conversions set factor=600');
 assert.equal((await unitCall()).rows[0].r.replayed,true); assert.equal(await stock(),unitBefore+.75);
 await assert.rejects(unitCall(376),/REQUEST_CHANGED/);
 await assert.rejects(unitCall(375,crypto.randomUUID()),/CONVERSION_CHANGED/);
 assert.equal(await stock(),unitBefore+.75);
 console.log('PASS operational receiving: gram receipt; immutable factor snapshot; no duplicate receipt after conversion changes; stale conversion denied without stock changes.');
`;
for(const [source,extra,anchor] of [
 ['run-actual-prepared-yield-local.mjs',prod,"  console.log('PASS: under/over"],
 ['run-actual-receiving-local.mjs',receive,"  await db.exec(`create or replace function user_has_branch_access"],
]) {
 const code=fs.readFileSync('scripts/fnb-db-test/'+source,'utf8'); const offset=code.indexOf(anchor); if(offset<0)throw new Error('anchor');
 const file=path.resolve('.tmp/uom-'+source); fs.writeFileSync(file,code.slice(0,offset)+extra+'\n'+code.slice(offset));
 execFileSync(process.execPath,[file,pglite],{stdio:'inherit'});
}
