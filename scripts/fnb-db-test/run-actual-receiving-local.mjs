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
  if(process.env.FNB_RECEIVING_WORKSPACE_DEFINITIONS) {
    for(const definition of Object.values(JSON.parse(fs.readFileSync(process.env.FNB_RECEIVING_WORKSPACE_DEFINITIONS,'utf8')))) await db.exec(definition);
  }
  await db.exec(fs.readFileSync('supabase/migrations/00571_internal_receiving_management_workspace.sql','utf8').replace(/\r?\n/g,'\r\n'));
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
  assert.equal(financeWorkspace.items[0].source_product_code,operationsItem.product_code);
  assert.equal(Number(financeWorkspace.items[0].source_quantity),8);
  assert.equal(Number(financeWorkspace.items[0].source_unit_price),100);
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
  const managementList=(await db.query(`select get_internal_receiving_workspace('${context.dest}') r`)).rows[0].r;
  assert.equal(managementList.find(row=>row.id===mixedSale.internal_sale_id).status,'cancelled');
  assert.equal(managementList.find(row=>row.id===mixedSale.internal_sale_id).toBranchId,context.dest);
  assert.ok(managementList.some(row=>row.receiptMode==='legacy'),'legacy receiving history remains visible');
  await assert.rejects(db.query(`select receive_internal_sale_actual('${mixedSale.internal_sale_id}','${mixedPayload}',gen_random_uuid(),'Cannot receive cancelled document')`),/ORDER_NOT_OPEN/);
  await db.exec(`create or replace function user_has_branch_access(uuid,uuid) returns boolean language sql as 'select false'`);
  await assert.rejects(db.query(`select get_internal_receiving_workspace('${context.dest}')`),/BRANCH_DENIED/);
  await assert.rejects(receive(1,'93000000-0000-0000-0000-000000000006'),/BRANCH_DENIED/);
  console.log('PASS: uncatalogued Retail SKU dispatch and actual receipt without changing recipe approvals; invalid/menu/inactive products rejected; historical stock unchanged; partial receiving/correction/replay; original cost; debt; cancellation; branch denial.');
  console.log('PASS: operations receipts post linked expenses without inventory or cash; branch/consolidated cost and internal elimination; receipt correction/replay/cancellation; no separate settlement or void; missing source cost remains flagged.');

  // Reproduce variant-only packaging: the parent/default recipe uses 250g,
  // while the 500g variant references a different tracked packaging SKU.
  await db.exec(`create or replace function user_has_branch_access(uuid,uuid) returns boolean language sql as 'select true';
    create role service_role;
    alter table products add column bom_code text;
    alter table bom add column code text,add column variant_id uuid,add column version integer default 1;
    create table product_variants(id uuid primary key,tenant_id uuid,product_id uuid,bom_code text,is_active boolean);
  `);
  const resolverSource=fs.readFileSync('supabase/migrations/00147_variant_aware_bom_lookup.sql','utf8');
  const resolverStart=resolverSource.indexOf('create or replace function public.get_active_bom_for_branch(');
  const resolverEnd=resolverSource.indexOf('\n$$;',resolverStart);
  await db.exec(resolverSource.slice(resolverStart,resolverEnd+4));
  const roast='96000000-0000-0000-0000-000000000001',zip250='96000000-0000-0000-0000-000000000002',zip500='96000000-0000-0000-0000-000000000003';
  const variant250='96000000-0000-0000-0000-000000000004',variant500='96000000-0000-0000-0000-000000000005';
  const bom250='96000000-0000-0000-0000-000000000006',bom500='96000000-0000-0000-0000-000000000007';
  await db.exec(`insert into products(id,tenant_id,code,name,unit,inventory_role,is_active,has_bom,stock,product_type,channel,bom_code) values
    ('${roast}','${context.tenant_id}','ROAST-FIXTURE','Roast coffee','Tui','fnb_menu_item',true,true,0,'sku','fnb','ZIP250'),
    ('${zip250}','${context.tenant_id}','ZIP250-FIXTURE','Zip 250g','Tui','retail_sku',true,false,100,'sku','retail',null),
    ('${zip500}','${context.tenant_id}','ZIP500-FIXTURE','Zip 500g','Tui','retail_sku',true,false,100,'sku','retail',null);
    insert into branch_stock(tenant_id,branch_id,product_id,quantity) values('${context.tenant_id}','${source}','${zip250}',100),('${context.tenant_id}','${source}','${zip500}',100);
    insert into product_variants values('${variant250}','${context.tenant_id}','${roast}','ZIP250',true),('${variant500}','${context.tenant_id}','${roast}','ZIP500',true);
    insert into bom(id,tenant_id,product_id,variant_id,branch_id,code,is_active) values
    ('${bom250}','${context.tenant_id}','${roast}','${variant250}',null,'ZIP250',true),('${bom500}','${context.tenant_id}','${roast}','${variant500}',null,'ZIP500',true);
    insert into bom_items values('${bom250}','${zip250}',1,'Tui',0),('${bom500}','${zip500}',1,'Tui',0);
  `);
  const zipPolicy=async product=>(await db.query(`select _internal_receiving_policy_00570('${context.tenant_id}','${source}','${context.dest}','${product}') r`)).rows[0].r;
  const zipStock=async()=>Number((await db.query(`select coalesce(sum(quantity),0) n from branch_stock where tenant_id='${context.tenant_id}' and branch_id='${context.dest}' and product_id='${zip500}'`)).rows[0].n);
  assert.equal((await zipPolicy(zip250)).treatment,'stock');
  assert.equal((await zipPolicy(zip500)).treatment,'expense','reproduces production: parent lookup misses 500g');
  const makeZipSale=async(extra=false)=> (await db.query(`select create_internal_sale_atomic('${context.tenant_id}','${source}','${context.dest}','${context.actor}',null,null,null,null,
    '${JSON.stringify([{productId:zip500,quantity:20,unitPrice:100,vatRate:0},...(extra?[{productId:operationsProduct,quantity:1,unitPrice:40,vatRate:0}]:[])])}'::jsonb,'debt',false,'Variant zip fixture') r`)).rows[0].r;
  const oldZip=await makeZipSale(true);
  const oldZipItem=(await db.query(`select id from internal_sale_items where internal_sale_id='${oldZip.internal_sale_id}' and product_id='${zip500}'`)).rows[0].id;
  await db.query(`select receive_internal_sale_actual('${oldZip.internal_sale_id}','${JSON.stringify([{itemId:oldZipItem,quantity:20}])}',gen_random_uuid(),'Old expense fixture')`);
  const beforeVariantStock=await zipStock(),beforeVariantExpense=Number((await financeTotals(context.dest)).expense);
  const variantMigration=fs.readFileSync('supabase/migrations/202610210004_internal_receiving_variant_recipes.sql','utf8');
  await db.exec(variantMigration);await db.exec(variantMigration);
  assert.equal(await zipStock(),beforeVariantStock,'install never updates old stock');
  assert.equal(Number((await financeTotals(context.dest)).expense),beforeVariantExpense,'install never rewrites historical expense');
  assert.equal((await db.query(`select receiving_treatment from internal_sale_items where id='${oldZipItem}'`)).rows[0].receiving_treatment,'expense','historical classification remains frozen');
  for(const product of [zip250,zip500]) assert.deepEqual(await zipPolicy(product),{treatment:'stock',productId:product,factor:1,reason:'recipe_ingredient'});
  for(const change of [
    `update product_variants set is_active=false where id='${variant500}'`,
    `update bom set is_active=false where id='${bom500}'`,
    `update product_variants set tenant_id=gen_random_uuid() where id='${variant500}'`,
    `insert into fnb_product_branch_menu_scopes values('${context.tenant_id}','${roast}','${source}')`,
    `insert into fnb_product_branch_menu_scopes values('${context.tenant_id}','${roast}','${context.dest}'); insert into fnb_product_branch_menu_policies values('${context.tenant_id}','${roast}','except')`,
  ]) {
    await db.exec('begin');await db.exec(change);
    assert.equal((await zipPolicy(zip500)).treatment,'expense','inactive, foreign-tenant or excluded menu cannot classify packaging as stock');
    await db.exec('rollback');
  }
  await db.exec('begin');
  await db.exec(`insert into bom(id,tenant_id,product_id,variant_id,branch_id,code,is_active,version) values(gen_random_uuid(),'${context.tenant_id}','${roast}','${variant500}','${context.dest}','ZIP500',true,2);
    insert into bom_items select id,'${zip250}',1,'Tui',0 from bom where branch_id='${context.dest}' and code='ZIP500';`);
  assert.equal((await zipPolicy(zip500)).treatment,'expense','branch override replaces global variant recipe');
  await db.exec('rollback');
  await db.exec('begin');
  await db.exec(`update products set bom_code='ZIP-REAL-BASE' where id='${roast}';
    insert into bom(id,tenant_id,product_id,branch_id,code,is_active,version) values(gen_random_uuid(),'${context.tenant_id}','${roast}',null,'ZIP-REAL-BASE',true,1);
    insert into bom_items select id,'${operationsProduct}',1,'Goi',0 from bom where code='ZIP-REAL-BASE';`);
  assert.equal((await zipPolicy(operationsProduct)).treatment,'stock','a real parent recipe remains reachable alongside variant recipes');
  assert.equal((await zipPolicy(zip500)).treatment,'stock');
  await db.exec('rollback');
  assert.equal((await db.query("select has_function_privilege('authenticated','public._internal_receiving_recipe_boms_20261021(uuid,uuid,uuid)','execute') allowed")).rows[0].allowed,false);
  const newZip=await makeZipSale();
  const newZipItem=(await db.query(`select id from internal_sale_items where internal_sale_id='${newZip.internal_sale_id}'`)).rows[0].id;
  assert.equal((await db.query(`select receiving_treatment from internal_sale_items where id='${newZipItem}'`)).rows[0].receiving_treatment,'stock');
  const zipRequest='96000000-0000-0000-0000-000000000008';
  const receiveZip=()=>db.query(`select receive_internal_sale_actual('${newZip.internal_sale_id}','${JSON.stringify([{itemId:newZipItem,quantity:20}])}','${zipRequest}','Receive variant packaging') r`);
  await receiveZip();assert.equal(await zipStock(),beforeVariantStock+20);
  assert.equal(Number((await financeTotals(context.dest)).expense),beforeVariantExpense,'new packaging receipt is inventory, not a duplicate expense');
  assert.equal((await receiveZip()).rows[0].r.replayed,true);assert.equal(await zipStock(),beforeVariantStock+20);
  await db.query(`select cancel_internal_sale_atomic('${newZip.internal_sale_id}','Cancel packaging fixture')`);
  assert.equal(await zipStock(),beforeVariantStock);
  assert.equal(Number((await financeTotals(context.dest)).expense),beforeVariantExpense);
  console.log('PASS: actual variant BOM resolver; 250g/500g packaging, active variants/menu/tenant/branch overrides; unchanged history; stock receipt +20 without expense, replay once and paired cancellation.');

  {
  await db.exec(fs.readFileSync('supabase/migrations/202610210006_internal_receipt_reclassification.sql','utf8'));
  const oldReceipt=(await db.query(`select r.id,r.revision from internal_sale_receipts r where r.internal_sale_id='${oldZip.internal_sale_id}'`)).rows[0];
  const reclassRequest='96000000-0000-0000-0000-000000000009';
  const otherReceiptLines=(await db.query(`select * from internal_sale_receipt_items where receipt_id='${oldReceipt.id}' and sale_item_id<>'${oldZipItem}' order by sale_item_id`)).rows;
  const reclassify=(revision=oldReceipt.revision,reason='Repair variant packaging')=>db.query(`select reclassify_internal_receipt_to_stock_20261021($1,$2,$3,$4,$5) r`,[oldReceipt.id,oldZipItem,revision,reclassRequest,reason]);
  await assert.rejects(()=>reclassify(999),/REVISION_CHANGED/);
  await db.exec(`create or replace function user_has_permission(uuid,text) returns boolean language sql as $$select coalesce(current_setting('test.reclass_permission',true),'yes')='yes'$$;select set_config('test.reclass_permission','no',false);`);
  await assert.rejects(()=>reclassify(),/RECLASS_DENIED/);
  await db.exec(`select set_config('test.reclass_permission','yes',false);
    create function fail_reclass_fixture() returns trigger language plpgsql as $$begin if new.id='${zip500}' and current_setting('test.reclass_fail',true)='yes' then raise exception 'TEST_RECLASS_FAILURE';end if;return new;end$$;
    create trigger fail_reclass_fixture before update on products for each row execute function fail_reclass_fixture();
    select set_config('test.reclass_fail','yes',false);`);
  await assert.rejects(()=>reclassify(),/TEST_RECLASS_FAILURE/);
  assert.equal(await zipStock(),beforeVariantStock,'second step failure rolls back stock');
  assert.equal(Number((await financeTotals(context.dest)).expense),beforeVariantExpense,'second step failure rolls back reversed expense');
  assert.equal((await db.query(`select count(*)::int n from internal_receiving_usage_confirmations where sale_item_id='${oldZipItem}'`)).rows[0].n,0);
  await db.exec(`select set_config('test.reclass_fail','no',false);`);
  const reclassified=(await reclassify()).rows[0].r;
  assert.equal(Number(reclassified.quantity),20);assert.equal(Number(reclassified.reversedExpense),2000);
  assert.equal(await zipStock(),beforeVariantStock+20);
  assert.equal(Number((await financeTotals(context.dest)).expense),beforeVariantExpense-2000);
  assert.deepEqual((await db.query(`select * from internal_sale_receipt_items where receipt_id='${oldReceipt.id}' and sale_item_id<>'${oldZipItem}' order by sale_item_id`)).rows,otherReceiptLines,'other receipt lines unchanged');
  assert.equal((await db.query(`select receiving_treatment from internal_sale_items where id='${oldZipItem}'`)).rows[0].receiving_treatment,'expense','frozen dispatch snapshot preserved');
  assert.equal((await db.query(`select quantity from internal_sale_receipt_items where receipt_id='${oldReceipt.id}' and sale_item_id='${oldZipItem}'`)).rows[0].quantity,'20.0000');
  assert.equal((await reclassify()).rows[0].r.replayed,true);assert.equal(await zipStock(),beforeVariantStock+20);
  await assert.rejects(()=>reclassify(oldReceipt.revision,'Changed reason'),/REQUEST_CHANGED/);
  const correctZip=(quantity,revision)=>db.query(`select receive_internal_sale_actual($1,$2,gen_random_uuid(),'Correct reclassified line',$3,$4) r`,[oldZip.internal_sale_id,JSON.stringify(otherReceiptLines.map(line=>({itemId:line.sale_item_id,quantity:Number(line.quantity)})).concat([{itemId:oldZipItem,quantity}])),oldReceipt.id,revision]);
  const corrected=(await correctZip(19,reclassified.revision)).rows[0].r;
  assert.equal(await zipStock(),beforeVariantStock+19);
  const restored=(await correctZip(20,corrected.revision)).rows[0].r;assert(restored.revision);
  assert.equal(await zipStock(),beforeVariantStock+20);
  assert.equal(Number((await financeTotals(context.dest)).expense),beforeVariantExpense-2000,'later receipt edits never reopen expense');
  await db.query(`select cancel_internal_sale_atomic('${oldZip.internal_sale_id}','Cancel reclassified fixture')`);
  assert.equal(await zipStock(),beforeVariantStock,'cancellation reverses reclassified stock through original sale');
  assert.equal(Number((await financeTotals(context.dest)).expense),beforeVariantExpense-2000);
  assert.equal((await db.query("select has_table_privilege('authenticated','public.internal_receipt_reclassification_requests_20261021','SELECT') allowed")).rows[0].allowed,false);
  console.log('PASS: historical receipt reclassification through actual RPC, linked expense reversal + stock, immutable snapshot, ACL/revision guards, rollback after expense reversal, replay, later correction and paired cancellation.');
  }


  // Exercise the real internal-sale chain with selected package units. Never use a remote database.
  {
    const migration=fs.readFileSync('supabase/migrations/20261029005208_unified_transaction_uom.sql','utf8');
    await db.exec("alter table branches add column is_active boolean default true, add column branch_type text default 'warehouse';");
    await db.exec(migration.match(/alter table public\.invoice_items[\s\S]*?;/)[0]);
    await db.exec(migration.match(/alter table public\.internal_sale_items[\s\S]*?;/)[0]);
    await db.exec(migration.match(/CREATE OR REPLACE FUNCTION public\._create_internal_sale_auth_impl_00243[\s\S]*?\$function\$\s*;/)[0]);
    const baseResolver=(await db.query("select pg_get_functiondef('resolve_product_uom_factor(uuid,uuid,text)'::regprocedure) d")).rows[0].d;
    const fixtureResolver=baseResolver.replace(/LANGUAGE plpgsql/i,'LANGUAGE sql').replace(/AS \$function\$[\s\S]*?\$function\$/i,"AS $function$ select case when $3='TestPack12' then 12 else 1 end::numeric $function$");
    assert.notEqual(fixtureResolver,baseResolver,'resolver fixture must retain the current parameter names');
    await db.exec(fixtureResolver);
    const before=await stock();
    const sourceBefore=Number((await db.query('select quantity from branch_stock where branch_id=$1 and product_id=$2',[source,context.product])).rows[0]?.quantity ?? 0);
    const sale=(await db.query(`select create_internal_sale_atomic($1,$2,$3,$4,null,null,null,null,$5::jsonb,'debt',false,'UOM isolated fixture') r`,[context.tenant_id,source,context.dest,context.actor,JSON.stringify([{productId:context.product,unit:'TestPack12',quantity:2,unitPrice:1200,vatRate:0}])])).rows[0].r;
    const row=(await db.query('select * from internal_sale_items where internal_sale_id=$1',[sale.internal_sale_id])).rows[0];
    assert.equal(Number(row.quantity),24); assert.equal(row.unit,context.unit); assert.equal(Number(row.unit_price),100);
    assert.equal(Number(row.transaction_quantity),2); assert.equal(row.transaction_unit,'TestPack12'); assert.equal(Number(row.transaction_unit_price),1200);
    assert.equal(Number(sale.total),2400); assert.equal(await stock(),before,'actual receiving stays deferred');
    const movement=(await db.query("select sum(quantity) q from stock_movements where reference_id=$1 and type='out'",[sale.invoice_id])).rows[0];
    assert.equal(Number(movement.q),24);
    await db.query(`select cancel_internal_sale_atomic($1,'Cancel UOM fixture')`,[sale.internal_sale_id]);
    assert.equal(await stock(),before);
    assert.equal(Number((await db.query('select quantity from branch_stock where branch_id=$1 and product_id=$2',[source,context.product])).rows[0]?.quantity ?? 0),sourceBefore);
    await db.exec(baseResolver);
    console.log('PASS: selected internal-sale package normalizes stock and price once, retains snapshots, defers receiving, and cancellation restores source stock.');
  }
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
