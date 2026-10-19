import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'onebiz-receiving-'));
const generated = new Map();
for (const name of ['internal-sale-stock-out', 'internal-sale-documents', 'supply-cost-flow']) {
  const file = path.join(dir, `${name}.sql`);
  execFileSync(process.execPath, [`scripts/fnb-db-test/extract-${name}.mjs`, file]);
  generated.set(`/tmp/fnb-${name}.sql`, file);
}
function expand(file) { return fs.readFileSync(file, 'utf8').replace(/^\\i(r?)\s+(.+)$/gm, (_, relative, target) => expand(generated.get(target.trim()) ?? path.resolve(path.dirname(file), target.trim()))).replace(/^\\set.*$/gm, ''); }
const db = new PGlite();
try {
  await db.exec('create role anon; create role authenticated;');
  await db.exec(expand('supabase/tests/00419_fnb_internal_sale_complete_chain.integration.sql'));
  await db.exec(`
    create table tenants(id uuid primary key); insert into tenants select distinct tenant_id from profiles;
    create table auth.users(id uuid primary key); insert into auth.users select id from profiles;
    alter table profiles add column full_name text default 'Fixture operator';
    alter table branches add column name text default 'Fixture branch';
    alter table internal_sales add column created_at timestamptz default now(),add column updated_at timestamptz default now();
    alter table internal_sale_items add column id uuid primary key default gen_random_uuid();
    alter table stock_movements add column id uuid default gen_random_uuid();
    alter table branch_stock add column variant_id uuid;
    alter table audit_log add column old_data jsonb;
    create table sales_returns(id uuid default gen_random_uuid(),invoice_id uuid,status text);
    create function get_user_tenant_id() returns uuid language sql stable as 'select tenant_id from profiles where id=auth.uid()';
    create function _cancel_internal_sale_draft_00471(uuid,text) returns jsonb language sql as $$select '{}'::jsonb$$;
    update products set stock=stock+100 where code='NVL-ISOLATED';
    update branch_stock set quantity=quantity+100 where product_id=(select id from products where code='NVL-ISOLATED');
  `);
  const beforeMigration = (await db.query('select branch_id,product_id,quantity from branch_stock order by branch_id,product_id')).rows;
  await db.exec(fs.readFileSync('supabase/migrations/00510_fnb_internal_actual_receiving.sql','utf8'));
  assert.deepEqual((await db.query('select branch_id,product_id,quantity from branch_stock order by branch_id,product_id')).rows,beforeMigration);
  const context = (await db.query(`select p.id actor,p.tenant_id,c.id customer,c.branch_id dest,pr.id product,pr.unit
    from profiles p cross join customers c cross join products pr join fnb_supply_catalog catalog on catalog.product_id=pr.id
    where pr.inventory_role <> 'fnb_menu_item' limit 1`)).rows[0];
  const source = '20000000-0000-0000-0000-000000000001';
  const stock = async () => Number((await db.query(`select coalesce((select quantity from branch_stock where branch_id='${context.dest}' and product_id='${context.product}'),0) q`)).rows[0].q);
  const ledger = async () => Number((await db.query(`select coalesce((select costed_quantity from fnb_branch_product_cost_balances where branch_id='${context.dest}' and product_id='${context.product}'),0) q`)).rows[0].q);
  const createSale = async () => (await db.query(`select create_internal_sale_atomic('${context.tenant_id}','${source}','${context.dest}','${context.actor}',null,null,null,null,
    '${JSON.stringify([{productId:context.product,quantity:10,unitPrice:100,vatRate:0}])}'::jsonb,'debt',false,'Actual receiving test') r`)).rows[0].r;
  const initial = await stock(); const initialCost = await ledger();
  // Any physical Retail SKU can be dispatched to F&B, even when it is not a
  // recipe ingredient. The recipe catalog itself must remain unchanged.
  await db.exec(`alter table products add column product_type text default 'sku', add column channel text default 'retail';
    delete from fnb_supply_catalog where product_id='${context.product}' and branch_id='${context.dest}';`);
  await assert.rejects(createSale(),/FNB_SUPPLY_CATALOG_REQUIRED/);
  await db.exec(`
    alter table cash_transactions add column id uuid primary key default gen_random_uuid(),
      add column status text default 'completed',add column transaction_date date default current_date,
      add column occurred_at timestamptz default now(),add column performed_by_name text;
    alter table invoice_items add column unit_cost numeric;
    alter table bom add column id uuid default gen_random_uuid(),add column tenant_id uuid,
      add column batch_size numeric default 1,add column yield_qty numeric default 1;
    update bom set tenant_id='${context.tenant_id}';
    create table bom_items(bom_id uuid,material_id uuid,quantity numeric,unit text,waste_percent numeric default 0);
    create table fnb_product_branch_menu_scopes(tenant_id uuid,product_id uuid,branch_id uuid);
    create table fnb_product_branch_menu_policies(tenant_id uuid,product_id uuid,mode text);
    create function get_active_bom_for_branch(uuid,uuid,uuid) returns uuid language sql as $$
      select id from bom where product_id=$1 and is_active and (branch_id=$2 or branch_id is null)
      order by (branch_id is not null) desc limit 1 $$;
    create function resolve_product_uom_factor(uuid,uuid,text) returns numeric language sql as $$select 1::numeric$$;
    insert into products(id,tenant_id,code,name,unit,inventory_role,is_active,has_bom,stock,product_type,channel)
    values('30000000-0000-0000-0000-000000000004','${context.tenant_id}','MENU-FIXTURE','Fixture drink','Ly','fnb_menu_item',true,true,0,'sku','fnb');
    insert into bom(product_id,branch_id,is_active,tenant_id) values('30000000-0000-0000-0000-000000000004','${context.dest}',true,'${context.tenant_id}');
    insert into bom_items select id,'${context.product}',1,'${context.unit}',0 from bom where product_id='30000000-0000-0000-0000-000000000004';
  `);
  await db.exec(fs.readFileSync('supabase/migrations/00438_management_income_expense_ledger.sql','utf8'));
  await db.exec("alter table management_finance_categories add column cash_flow_activity text default 'unclassified'");
  // Load the real report definitions; report facts are exercised separately by
  // the snapshot-report database suite, while this suite verifies receipt data.
  const reportSource=fs.readFileSync('supabase/migrations/00406_profit_loss_snapshot_cogs.sql','utf8');
  for(const name of ['get_profit_and_loss_report_v2','get_branch_profit_and_loss_report_v2']) {
    const marker=`create or replace function public.${name}(`;
    const start=reportSource.indexOf(marker); const end=reportSource.indexOf('\n$$;',start);
    await db.exec(reportSource.slice(start,end+4));
  }
  await db.exec(fs.readFileSync('supabase/migrations/00439_management_finance_pnl_recognition.sql','utf8'));
  const uomSource=fs.readFileSync('supabase/migrations/00515_operational_uom_snapshots.sql','utf8');
  const uomTableStart=uomSource.indexOf('create table if not exists public.operational_uom_requests (');
  const uomTableEnd=uomSource.indexOf('\ncreate index',uomTableStart);
  assert.ok(uomTableStart>=0 && uomTableEnd>uomTableStart,'real operational unit snapshot table found');
  await db.exec(uomSource.slice(uomTableStart,uomTableEnd));
  const uomStart=uomSource.indexOf('create or replace function public.receive_internal_sale_with_uom(');
  const uomEnd=uomSource.indexOf('end;$$;',uomStart);
  await db.exec(uomSource.slice(uomStart,uomEnd+'end;$$;'.length));
  if(process.env.FNB_RECEIVING_DEFINITIONS) {
    const definitions=JSON.parse(fs.readFileSync(process.env.FNB_RECEIVING_DEFINITIONS,'utf8'));
    for(const definition of Object.values(definitions)) await db.exec(definition);
  }
  const beforeSkuMigration=(await db.query('select * from branch_stock order by branch_id,product_id')).rows;
  await db.exec(fs.readFileSync('supabase/migrations/00570_internal_receiving_retail_skus.sql','utf8').replace(/\r?\n/g,'\r\n'));
  assert.deepEqual((await db.query('select * from branch_stock order by branch_id,product_id')).rows,beforeSkuMigration);
  for(const invalid of ["product_type='material'", "channel='fnb'", "inventory_role='fnb_menu_item'", "is_active=false"]) {
    await db.exec('begin');
    await db.exec(`update products set ${invalid} where id='${context.product}'`);
    await assert.rejects(createSale(),/INTERNAL_SALE_RETAIL_SKU_REQUIRED/);
    await db.exec('rollback');
  }
  const sale = await createSale();
  assert.equal(Number((await db.query(`select count(*) n from fnb_supply_catalog where branch_id='${context.dest}' and product_id='${context.product}'`)).rows[0].n),0);
  assert.equal(await stock(),initial); assert.equal(await ledger(),initialCost);
  assert.equal((await db.query(`select receipt_mode from internal_sales where id='${sale.internal_sale_id}'`)).rows[0].receipt_mode,'actual');
  const item = (await db.query(`select id from internal_sale_items where internal_sale_id='${sale.internal_sale_id}'`)).rows[0].id;
  const receive = (quantity,key,receipt=null,revision=null,note='Receiving test') => db.query(`select receive_internal_sale_actual('${sale.internal_sale_id}',
    '${JSON.stringify([{itemId:item,quantity}])}'::jsonb,'${key}','${note}',${receipt ? `'${receipt}'` : 'null'},${revision ?? 'null'}) r`);
  const key = '93000000-0000-0000-0000-000000000001';
  const first = (await receive(8,key)).rows[0].r;
  assert.equal(await stock(),initial+8); assert.equal(await ledger(),initialCost+8);
  assert.equal((await receive(8,key)).rows[0].r.replayed,true); assert.equal(await stock(),initial+8);
  await assert.rejects(receive(9,key),/REQUEST_CHANGED/);
  await assert.rejects(receive(3,'93000000-0000-0000-0000-000000000002'),/EXCEEDS_DISPATCHED/);
  assert.equal(await stock(),initial+8);
  const ws=(await db.query(`select get_internal_receiving_workspace('${context.dest}') r`)).rows[0].r;
  assert.equal(Number(ws.find(o=>o.id===sale.internal_sale_id).items[0].received),8);
  assert.ok(!JSON.stringify(ws).includes('unit_price')); assert.ok(!JSON.stringify(ws).includes('unitCost'));
  // Correct 8 to 7: subtract only one from physical stock and its ORIGINAL receipt cost.
  const corrected=(await receive(7,'93000000-0000-0000-0000-000000000003',first.receiptId,1,'Actual count correction')).rows[0].r;
  assert.equal(corrected.revision,2); assert.equal(await stock(),initial+7); assert.equal(await ledger(),initialCost+7);
  await assert.rejects(receive(8,'93000000-0000-0000-0000-000000000004',first.receiptId,1),/REVISION_CHANGED/);
  await receive(3,'93000000-0000-0000-0000-000000000005');
  assert.equal(await stock(),initial+10); assert.equal(await ledger(),initialCost+10);
  assert.equal(Number((await db.query(`select debt from invoices where id='${sale.invoice_id}'`)).rows[0].debt),1000);
  await db.query(`select cancel_internal_sale_atomic('${sale.internal_sale_id}','Test paired reversal after actual receipts')`);
  assert.equal(await stock(),initial); assert.equal(await ledger(),initialCost);
  const beforeCancel = await stock(); const empty = await createSale();
  await db.query(`select cancel_internal_sale_atomic('${empty.internal_sale_id}','Test cancellation before any actual receipt')`);
  assert.equal(await stock(),beforeCancel);
  const operationsProduct='30000000-0000-0000-0000-000000000003';
  const makeOperationsSale=async(quantity=10,unitPrice=100)=>(await db.query(`select create_internal_sale_atomic('${context.tenant_id}','${source}','${context.dest}','${context.actor}',null,null,null,null,
   '${JSON.stringify([{productId:operationsProduct,quantity,unitPrice,vatRate:0}])}'::jsonb,'debt',false,'Operations expense fixture') r`)).rows[0].r;
  const operationsSale=await makeOperationsSale();
  const operationsItem=(await db.query(`select * from internal_sale_items where internal_sale_id='${operationsSale.internal_sale_id}'`)).rows[0];
  assert.equal(operationsItem.receiving_treatment,'expense');
  await assert.rejects(db.exec(`update internal_sale_items set receiving_treatment='stock' where id='${operationsItem.id}'`),/SNAPSHOT_IMMUTABLE/);
  await db.exec(`update invoice_items set unit_cost=60 where invoice_id='${operationsSale.invoice_id}'`);
  const receiveOperations=(quantity,key,receipt=null,revision=null)=>db.query(`select receive_internal_sale_actual('${operationsSale.internal_sale_id}',
   '${JSON.stringify([{itemId:operationsItem.id,quantity}])}'::jsonb,'${key}','Operations count correction',${receipt ? `'${receipt}'` : 'null'},${revision ?? 'null'}) r`);
  const operationsStock=async()=>Number((await db.query(`select coalesce(sum(quantity),0) n from branch_stock where branch_id='${context.dest}' and product_id='${operationsProduct}'`)).rows[0].n);
  const cashBefore=Number((await db.query('select count(*) n from cash_transactions')).rows[0].n);
  const operationsStockBefore=await operationsStock();
  const opFirst=(await receiveOperations(8,'94000000-0000-0000-0000-000000000001')).rows[0].r;
  assert.equal(await operationsStock(),operationsStockBefore);
  assert.equal(Number((await db.query('select count(*) n from cash_transactions')).rows[0].n),cashBefore);
  const financeTotals=async(branch=null)=>(await db.query(`select management_finance_period_totals_00570('${context.tenant_id}',now()-interval '1 day',now()+interval '1 day',${branch ? `'${branch}'` : 'null'},${branch ? 'false' : 'true'}) r`)).rows[0].r;
  assert.equal(Number((await financeTotals(context.dest)).expense),800);
  assert.equal(Number((await financeTotals()).expense),480);
  assert.equal(Number((await financeTotals()).internal_expense_elimination),320);
  await receiveOperations(8,'94000000-0000-0000-0000-000000000001');
  assert.equal(Number((await financeTotals(context.dest)).expense),800);
  const financeEvent=(await db.query(`select event_id from internal_receipt_expense_sources where receipt_id='${opFirst.receiptId}'`)).rows[0].event_id;
  await assert.rejects(db.query(`select cancel_management_finance_event('${financeEvent}','Do not cancel recognition separately')`),/FINANCE_SOURCE_LOCKED/);
  await assert.rejects(db.query(`select settle_management_finance_event('${financeEvent}',gen_random_uuid(),'{}')`),/FINANCE_SOURCE_LOCKED/);
  const financeWorkspace=(await db.query(`select get_management_finance_workspace(current_date-1,current_date+1,'${context.dest}') r`)).rows[0].r;
  assert.equal(financeWorkspace.items[0].source_type,'internal_receipt');
  assert.equal(financeWorkspace.items[0].source_sale_id,operationsSale.internal_sale_id);
  await db.exec(`create or replace function user_has_branch_access(uuid,uuid) returns boolean language sql as $$select $2<>'${source}'::uuid$$`);
  const limitedFinance=(await db.query(`select get_management_finance_workspace(current_date-1,current_date+1,'${context.dest}') r`)).rows[0].r.items[0];
  assert.equal(limitedFinance.can_view_consolidated_cost,false); assert.equal(limitedFinance.consolidated_amount,null);
  await db.exec(`create or replace function user_has_branch_access(uuid,uuid) returns boolean language sql as $$select $2 in ('${source}'::uuid,'${context.dest}'::uuid)$$`);
  assert.equal(Number((await db.query(`select get_management_finance_workspace(current_date-1,current_date+1,'${context.dest}',null,null,null,0,50,null,'unpaid') r`)).rows[0].r.total),0);
  await receiveOperations(7,'94000000-0000-0000-0000-000000000002',opFirst.receiptId,1);
  assert.equal(Number((await financeTotals(context.dest)).expense),700);
  await receiveOperations(3,'94000000-0000-0000-0000-000000000003');
  assert.equal(Number((await financeTotals(context.dest)).expense),1000);
  assert.equal(Number((await financeTotals()).expense),600);
  assert.equal(await operationsStock(),operationsStockBefore);
  assert.equal(Number((await db.query(`select debt from invoices where id='${operationsSale.invoice_id}'`)).rows[0].debt),1000);
  await db.query(`select cancel_internal_sale_atomic('${operationsSale.internal_sale_id}','Cancel operations-only internal sale')`);
  assert.equal(Number((await financeTotals(context.dest)).expense),0);
  assert.equal(Number((await financeTotals()).expense),0);
  assert.equal(await operationsStock(),operationsStockBefore);
  // Unknown historical source cost must remain unknown in consolidated P&L.
  const unknownSale=await makeOperationsSale();
  const unknownItem=(await db.query(`select id from internal_sale_items where internal_sale_id='${unknownSale.internal_sale_id}'`)).rows[0].id;
  await db.query(`select receive_internal_sale_actual('${unknownSale.internal_sale_id}','${JSON.stringify([{itemId:unknownItem,quantity:1}])}',gen_random_uuid(),'Unknown source cost')`);
  assert.equal(Number((await financeTotals()).missing_expense_cost_lines),1);
  assert.equal(Number((await financeTotals(context.dest)).expense),100);
  await db.query(`select cancel_internal_sale_atomic('${unknownSale.internal_sale_id}','Cancel unknown cost fixture')`);
  const roundedSale=await makeOperationsSale(3,1/3);
  const roundedItem=(await db.query(`select id from internal_sale_items where internal_sale_id='${roundedSale.internal_sale_id}'`)).rows[0].id;
  await db.exec(`update invoice_items set unit_cost=0.2 where invoice_id='${roundedSale.invoice_id}'`);
  const roundedReceipts=[];
  for(let n=0;n<3;n++) roundedReceipts.push((await db.query(`select receive_internal_sale_actual('${roundedSale.internal_sale_id}','${JSON.stringify([{itemId:roundedItem,quantity:1}])}',gen_random_uuid(),'Partial rounding fixture') r`)).rows[0].r);
  assert.equal(Number((await financeTotals(context.dest)).expense),1);
  await db.query(`select receive_internal_sale_actual('${roundedSale.internal_sale_id}','${JSON.stringify([{itemId:roundedItem,quantity:0.5}])}',gen_random_uuid(),'Correct fractional count','${roundedReceipts[1].receiptId}',1)`);
  assert.equal(Number((await financeTotals(context.dest)).expense),0.83);
  await db.query(`select receive_internal_sale_actual('${roundedSale.internal_sale_id}','${JSON.stringify([{itemId:roundedItem,quantity:0.5}])}',gen_random_uuid(),'Receive remaining half')`);
  assert.equal(Number((await financeTotals(context.dest)).expense),1);
  assert.equal(Number((await financeTotals()).expense),0.6);
  await db.query(`select cancel_internal_sale_atomic('${roundedSale.internal_sale_id}','Cancel fractional receipt fixture')`);
  const freeSale=await makeOperationsSale(2,0);
  const freeItem=(await db.query(`select id from internal_sale_items where internal_sale_id='${freeSale.internal_sale_id}'`)).rows[0].id;
  await db.exec(`update invoice_items set unit_cost=60 where invoice_id='${freeSale.invoice_id}'`);
  await db.query(`select receive_internal_sale_actual('${freeSale.internal_sale_id}','${JSON.stringify([{itemId:freeItem,quantity:2}])}',gen_random_uuid(),'Free internal item still carries source cost')`);
  assert.equal(Number((await financeTotals(context.dest)).expense),0);
  assert.equal(Number((await financeTotals()).expense),120);
  await db.query(`select cancel_internal_sale_atomic('${freeSale.internal_sale_id}','Cancel free operations fixture')`);
  assert.equal(Number((await financeTotals()).expense),0);
  const packProduct='30000000-0000-0000-0000-000000000005';
  await db.exec(`insert into bom_items select id,'30000000-0000-0000-0000-000000000002',1,'Goi',0 from bom where product_id='${context.product}';
    insert into products(id,tenant_id,code,name,unit,inventory_role,is_active,has_bom,stock,product_type,channel)
    values('${packProduct}','${context.tenant_id}','SKU-PACK-FIXTURE','Twelve-unit pack','Thung','retail_sku',true,true,0,'sku','retail');
    insert into bom(product_id,branch_id,is_active,tenant_id) values('${packProduct}','${source}',true,'${context.tenant_id}');
    insert into bom_items select id,'30000000-0000-0000-0000-000000000002',12,'Goi',0 from bom where product_id='${packProduct}';`);
  const packSale=(await db.query(`select create_internal_sale_atomic('${context.tenant_id}','${source}','${context.dest}','${context.actor}',null,null,null,null,
   '${JSON.stringify([{productId:packProduct,quantity:2,unitPrice:1200,vatRate:0}])}'::jsonb,'debt',false,'Pack conversion fixture') r`)).rows[0].r;
  const packItem=(await db.query(`select * from internal_sale_items where internal_sale_id='${packSale.internal_sale_id}'`)).rows[0];
  assert.equal(packItem.receiving_treatment,'stock'); assert.equal(packItem.receiving_product_id,context.product); assert.equal(Number(packItem.receiving_factor),12);
  const packStockBefore=await stock(); const packCostBefore=Number((await db.query(`select total_cost from fnb_branch_product_cost_balances where branch_id='${context.dest}' and product_id='${context.product}'`)).rows[0].total_cost);
  await db.query(`select receive_internal_sale_actual('${packSale.internal_sale_id}','${JSON.stringify([{itemId:packItem.id,quantity:2}])}',gen_random_uuid(),'Receive two packs as 24 ingredient units')`);
  assert.equal(await stock(),packStockBefore+24);
  assert.equal(Number((await db.query(`select total_cost from fnb_branch_product_cost_balances where branch_id='${context.dest}' and product_id='${context.product}'`)).rows[0].total_cost),packCostBefore+2400);
  assert.equal(Number((await financeTotals(context.dest)).expense),0);
  await db.query(`select cancel_internal_sale_atomic('${packSale.internal_sale_id}','Cancel converted ingredient receipt')`);
  assert.equal(await stock(),packStockBefore);
  await db.exec('begin');
  const secondIngredient='30000000-0000-0000-0000-000000000006';
  await db.exec(`insert into products(id,tenant_id,code,name,unit,inventory_role,is_active,has_bom,stock,product_type,channel)
    values('${secondIngredient}','${context.tenant_id}','SKU-SECOND-FIXTURE','Second ingredient pack','Goi','retail_sku',true,true,0,'sku','retail');
    insert into bom(product_id,branch_id,is_active,tenant_id) values('${secondIngredient}','${source}',true,'${context.tenant_id}');
    insert into bom_items select id,'30000000-0000-0000-0000-000000000002',1,'Goi',0 from bom where product_id='${secondIngredient}';
    insert into bom_items select id,'${secondIngredient}',1,'Goi',0 from bom where product_id='30000000-0000-0000-0000-000000000004';`);
  assert.equal((await db.query(`select _internal_receiving_policy_00570('${context.tenant_id}','${source}','${context.dest}','${packProduct}') r`)).rows[0].r.treatment,'review');
  await db.exec('rollback');
  await db.exec('begin');
  await db.exec(`update bom_items set quantity=0.00001 where bom_id=(select id from bom where product_id='${packProduct}')`);
  const tinySale=(await db.query(`select create_internal_sale_atomic('${context.tenant_id}','${source}','${context.dest}','${context.actor}',null,null,null,null,
    '${JSON.stringify([{productId:packProduct,quantity:2,unitPrice:1200,vatRate:0}])}'::jsonb,'debt',false,'Unsafe precision fixture') r`)).rows[0].r;
  const tinyItem=(await db.query(`select id from internal_sale_items where internal_sale_id='${tinySale.internal_sale_id}'`)).rows[0].id;
  await db.exec('savepoint unsafe_receipt');
  await assert.rejects(db.query(`select receive_internal_sale_actual('${tinySale.internal_sale_id}','${JSON.stringify([{itemId:tinyItem,quantity:2}])}',gen_random_uuid(),'Reject imprecise target stock')`),/INTERNAL_RECEIVE_CONVERSION_PRECISION_REVIEW/);
  await db.exec('rollback to savepoint unsafe_receipt');
  assert.equal(await stock(),packStockBefore);
  await db.exec('rollback');
  const confirmedSale=await makeOperationsSale();
  const confirmedItem=(await db.query(`select id from internal_sale_items where internal_sale_id='${confirmedSale.internal_sale_id}'`)).rows[0].id;
  const confirmationRequest='95000000-0000-0000-0000-000000000001';
  const confirmationPayload=JSON.stringify([{itemId:confirmedItem,quantity:2,inputUnit:'Goi',expectedFactor:1,receivingTreatment:'stock'}]);
  const confirm=()=>db.query(`select receive_internal_sale_with_uom('${confirmedSale.internal_sale_id}','${confirmationPayload}','${confirmationRequest}','Ingredient pending recipe setup') r`);
  const stockBeforeConfirmation=await operationsStock();
  await db.exec(`create or replace function user_has_permission(uuid,text) returns boolean language sql as $$select $2<>'products.edit'$$`);
  await assert.rejects(confirm(),/INTERNAL_RECEIVE_USAGE_DENIED/);
  assert.equal(await operationsStock(),stockBeforeConfirmation);
  assert.equal(Number((await db.query('select count(*) n from internal_receiving_usage_confirmations')).rows[0].n),0);
  await db.exec(`create or replace function user_has_permission(uuid,text) returns boolean language sql as $$select true$$`);
  const confirmed=(await confirm()).rows[0].r;
  assert.ok(confirmed.receiptId); assert.equal(await operationsStock(),stockBeforeConfirmation+2);
  assert.equal((await confirm()).rows[0].r.replayed,true); assert.equal(await operationsStock(),stockBeforeConfirmation+2);
  assert.equal(Number((await financeTotals(context.dest)).expense),0);
  await assert.rejects(db.query(`select receive_internal_sale_actual('${confirmedSale.internal_sale_id}','${JSON.stringify([{itemId:confirmedItem,quantity:1,receivingTreatment:'expense'}])}',gen_random_uuid(),'Cannot change frozen usage')`),/INTERNAL_RECEIVE_USAGE_LOCKED/);
  await db.query(`select cancel_internal_sale_atomic('${confirmedSale.internal_sale_id}','Cancel confirmed stock fixture')`);
  assert.equal(await operationsStock(),stockBeforeConfirmation);
  const mixedSale=(await db.query(`select create_internal_sale_atomic('${context.tenant_id}','${source}','${context.dest}','${context.actor}',null,null,null,null,
    '${JSON.stringify([{productId:context.product,quantity:2,unitPrice:100,vatRate:0},{productId:operationsProduct,quantity:3,unitPrice:100,vatRate:0}])}'::jsonb,'debt',false,'Mixed stock and expense fixture') r`)).rows[0].r;
  await db.exec(`update invoice_items set unit_cost=60 where invoice_id='${mixedSale.invoice_id}'`);
  const mixedItems=(await db.query(`select id,product_id from internal_sale_items where internal_sale_id='${mixedSale.internal_sale_id}'`)).rows;
  const mixedPayload=JSON.stringify(mixedItems.map(line=>({itemId:line.id,quantity:line.product_id===context.product ? 2 : 3})));
  const mixedStockBefore=await stock(),mixedOperationsBefore=await operationsStock();
  await db.query(`select receive_internal_sale_actual('${mixedSale.internal_sale_id}','${mixedPayload}',gen_random_uuid(),'Receive mixed-purpose lines')`);
  assert.equal(await stock(),mixedStockBefore+2);
  assert.equal(await operationsStock(),mixedOperationsBefore);
  assert.equal(Number((await financeTotals(context.dest)).expense),300);
  assert.equal(Number((await financeTotals()).expense),180);
  assert.equal(Number((await db.query(`select debt from invoices where id='${mixedSale.invoice_id}'`)).rows[0].debt),500);
  assert.equal(Number((await db.query('select count(*) n from cash_transactions')).rows[0].n),cashBefore);
  await db.query(`select cancel_internal_sale_atomic('${mixedSale.internal_sale_id}','Cancel mixed-purpose fixture')`);
  assert.equal(await stock(),mixedStockBefore);
  assert.equal(await operationsStock(),mixedOperationsBefore);
  assert.equal(Number((await financeTotals(context.dest)).expense),0);
  await db.exec(`create or replace function user_has_branch_access(uuid,uuid) returns boolean language sql as 'select false'`);
  await assert.rejects(db.query(`select get_internal_receiving_workspace('${context.dest}')`),/BRANCH_DENIED/);
  await assert.rejects(receive(1,'93000000-0000-0000-0000-000000000006'),/BRANCH_DENIED/);
  console.log('PASS: uncatalogued Retail SKU dispatch and actual receipt without changing recipe approvals; invalid/menu/inactive products rejected; historical stock unchanged; partial receiving/correction/replay; original cost; debt; cancellation; branch denial.');
  console.log('PASS: operations receipts post linked expenses without inventory or cash; branch/consolidated cost and internal elimination; receipt correction/replay/cancellation; no separate settlement or void; missing source cost remains flagged.');
  const reportDb=new PGlite();
  try {
    await reportDb.exec('create role anon; create role authenticated;');
    await reportDb.exec(expand('supabase/tests/00439_management_finance_pnl_recognition.integration.sql').replace(/select 'create role[\s\S]*?\\gexec/g,''));
    const pnl=async(exclude)=>(await reportDb.query(`select get_profit_and_loss_report_v2('2026-08-31T17:00:00Z','2026-09-30T17:00:00Z','2026-09-30T17:00:00Z','2026-10-31T17:00:00Z',null,${exclude}) r`)).rows[0].r.current;
    const baseConsolidated=await pnl(true),baseGross=await pnl(false);
    await reportDb.exec(`create table internal_sales(id uuid primary key,tenant_id uuid,to_branch_id uuid,status text);
      create table internal_sale_receipts(id uuid primary key,tenant_id uuid,created_at timestamptz);
      create table internal_receipt_expense_sources(id uuid primary key default gen_random_uuid(),tenant_id uuid,event_id uuid,consolidated_amount numeric,amount numeric,quantity numeric,is_active boolean default true,sale_id uuid,receipt_id uuid);
      insert into internal_sales values('c0000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','completed');
      insert into internal_sale_receipts values('c0000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','2026-09-30T12:00:00Z');
      insert into management_finance_events values('a0000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001','expense','posted');
      insert into management_finance_allocations values('a0000000-0000-0000-0000-000000000004','40000000-0000-0000-0000-000000000001','2026-09-30',1000);
      insert into internal_receipt_expense_sources(tenant_id,event_id,consolidated_amount,amount,quantity,sale_id,receipt_id) values('20000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000004',600,1000,10,'c0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000002');`);
    const fullMigration=fs.readFileSync('supabase/migrations/00570_internal_receiving_retail_skus.sql','utf8');
    const overlay=fullMigration.slice(fullMigration.indexOf('create function public.management_finance_period_totals_00570'),fullMigration.lastIndexOf('\ncommit;'));
    await reportDb.exec(overlay);
    assert.equal(Number((await pnl(true)).operating_expense),Number(baseConsolidated.operating_expense)+600);
    assert.equal(Number((await pnl(true)).internal_expense_elimination),400);
    assert.equal(Number((await pnl(false)).operating_expense),Number(baseGross.operating_expense)+1000);
    await reportDb.exec('update internal_receipt_expense_sources set consolidated_amount=null');
    assert.equal((await pnl(true)).cogs_complete,false);
    assert.equal(Number((await pnl(true)).missing_expense_cost_lines),1);
    assert.equal((await pnl(false)).cogs_complete,baseGross.cogs_complete);
    assert.equal(await reportDb.query("select has_function_privilege('authenticated','management_finance_period_totals_00570(uuid,timestamptz,timestamptz,uuid,boolean)','execute') allowed").then(r=>r.rows[0].allowed),false);
    console.log('PASS: actual P&L report retains historic facts, eliminates internal expense markup only in consolidated mode, flags unknown source cost and keeps private totals inaccessible.');
  } finally {await reportDb.close();}
} catch (e) { console.error(e.message, e.where ?? ''); process.exitCode = 1; }
finally { await db.close(); fs.rmSync(dir,{recursive:true,force:true}); }
