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
  const sale = await createSale();
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
  await db.exec(`create or replace function user_has_branch_access(uuid,uuid) returns boolean language sql as 'select false'`);
  await assert.rejects(db.query(`select get_internal_receiving_workspace('${context.dest}')`),/BRANCH_DENIED/);
  await assert.rejects(receive(1,'93000000-0000-0000-0000-000000000006'),/BRANCH_DENIED/);
  console.log('PASS: historical stock unchanged; dispatch does not receive; 8/10 then 3 after correction; replay; oversupply rollback; stale revision; original cost delta; unchanged invoice debt; cancel before/after receipt; branch denial; no cost disclosure.');
} catch (e) { console.error(e.message, e.where ?? ''); process.exitCode = 1; }
finally { await db.close(); fs.rmSync(dir,{recursive:true,force:true}); }
