import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(process.env.ONEBIZ_PGLITE_MODULE ? pathToFileURL(process.env.ONEBIZ_PGLITE_MODULE).href : '@electric-sql/pglite');

const db = new PGlite();
const id = n => '00000000-0000-0000-0000-' + String(n).padStart(12,'0');
const [actor, tenant, branch, order, product, line, stock, lot, invoice] = Array.from({length:9},(_,i)=>id(i+1));
await db.exec(`
  create role anon; create role authenticated; create schema auth; create schema private;
  create function auth.uid() returns uuid language sql as $$ select '${actor}'::uuid $$;
  create function get_user_tenant_id() returns uuid language sql as $$ select '${tenant}'::uuid $$;
  create function user_has_branch_access(uuid,uuid) returns boolean language sql as $$ select $2 = '${branch}'::uuid $$;
  create function _staff_permission_at_scope(uuid,text,uuid) returns boolean language sql as $$
    select $2 <> coalesce(current_setting('test.denied', true), '') $$;
  create function user_has_permission(uuid,text) returns boolean language sql as $$ select true $$;
  create function _fnb_branch_cost_tracking_enabled_00390(uuid,uuid) returns boolean language sql as $$ select true $$;
  create table profiles(id uuid,tenant_id uuid,is_active boolean);
  create table purchase_orders(id uuid,tenant_id uuid,branch_id uuid,status text,closed_short boolean,
    total numeric,paid numeric,debt numeric,subtotal numeric,tax_amount numeric,code text,updated_at timestamptz);
  create table purchase_order_items(id uuid,purchase_order_id uuid,product_id uuid,received_quantity numeric,quantity numeric,
    unit_price numeric,transaction_unit_price numeric,transaction_quantity numeric,conversion_factor numeric,unit_price_missing boolean,
    unit text,discount numeric,vat_rate numeric,total numeric,vat_amount numeric);
  create table input_invoices(id uuid,purchase_order_id uuid,tenant_id uuid,status text,total_amount numeric,tax_amount numeric,updated_at timestamptz);
  create table supplier_returns(purchase_order_id uuid,tenant_id uuid,status text);
  create table fnb_purchase_sales_order_links(purchase_order_id uuid);
  create table branch_stock(id uuid,tenant_id uuid,branch_id uuid,product_id uuid,variant_id uuid,quantity numeric,reserved numeric,updated_at timestamptz);
  create table products(id uuid,tenant_id uuid,stock numeric,updated_at timestamptz);
  create table product_lots(id uuid,tenant_id uuid,branch_id uuid,product_id uuid,purchase_order_id uuid,initial_qty numeric,current_qty numeric,status text);
  create table fnb_branch_product_cost_balances(tenant_id uuid,branch_id uuid,product_id uuid,costed_quantity numeric,total_cost numeric,deficit_quantity numeric,
    unit_cost numeric,updated_by uuid,updated_at timestamptz);
  create table fnb_branch_product_cost_events(id uuid default gen_random_uuid(),tenant_id uuid,branch_id uuid,product_id uuid,
    direction text,source_type text,source_reference_type text,source_reference_id uuid,quantity numeric,unit_cost numeric,total_cost numeric,note text,created_by uuid,
    created_at timestamptz default now());
  create table stock_movements(tenant_id uuid,branch_id uuid,product_id uuid,type text,quantity numeric,reference_type text,reference_id uuid,note text,created_by uuid);
  create table audit_log(tenant_id uuid,user_id uuid,action text,entity_type text,entity_id uuid,old_data jsonb,new_data jsonb);
  insert into profiles values ('${actor}','${tenant}',true);
  insert into purchase_orders values ('${order}','${tenant}','${branch}','completed',false,220000,0,220000,220000,0,'PO000520',now());
  insert into purchase_order_items values ('${line}','${order}','${product}',10000,10000,22,22,10000,1,false,'Kg',0,0,220000,0);
  insert into input_invoices values ('${invoice}','${order}','${tenant}','unrecorded',220000,0,now());
  insert into products values ('${product}','${tenant}',10008.611,now());
  insert into branch_stock values ('${stock}','${tenant}','${branch}','${product}',null,9994.525,0,now());
  insert into product_lots values ('${lot}','${tenant}','${branch}','${product}','${order}',10000,9994.525,'active');
  insert into fnb_branch_product_cost_balances values ('${tenant}','${branch}','${product}',9994.525,249964.1584,0,25.010109,null,now());
  insert into fnb_branch_product_cost_events (tenant_id,branch_id,product_id,direction,source_type,source_reference_type,source_reference_id,
      quantity,unit_cost,total_cost,created_at)
  values ('${tenant}','${branch}','${product}','in','opening','opening','${product}',1.076,28000,30128,'2026-11-10'),
    ('${tenant}','${branch}','${product}','in','purchase_receipt','purchase_order','${order}',10000,22,220000,'2026-11-11'),
    ('${tenant}','${branch}','${product}','out','production_consume','production_order','${product}',6.551,25.010109,163.8416,'2026-11-12');`);

await db.exec(await readFile(new URL('../supabase/migrations/20261117105442_supplier_receipt_correction.sql', import.meta.url), 'utf8'));
const args = [order,line,10,22000,'Nhập sai quy đổi'];
const preview = async (input = args) => (await db.query('select public.preview_supplier_receipt_correction($1,$2,$3,$4,$5) as p',input)).rows[0].p;
const apply = async token => (await db.query('select public.apply_supplier_receipt_correction($1,$2,$3,$4,$5,$6) as p',[...args,token])).rows[0].p;
const plan = await preview();
assert.equal(plan.stockAfter,4.525);
assert.equal(plan.lotAfter,4.525);
assert.equal(plan.newValue,102187.5406);
assert.equal(plan.newDebt,220000);
assert.equal((await db.query('select quantity::float stock from branch_stock')).rows[0].stock,9994.525);
await assert.rejects(() => preview([order,line,5,22000,args[4]]), /PURCHASE_CORRECTION_STOCK_SHORT/);
await db.exec("update purchase_orders set paid=200000,debt=20000");
await assert.rejects(() => preview([order,line,10,18000,args[4]]), /PURCHASE_CORRECTION_DEBT_REVIEW/);
await db.exec("update purchase_orders set paid=0,debt=220000; update input_invoices set status='recorded'");
await assert.rejects(preview, /PURCHASE_CORRECTION_INPUT_INVOICE_REVIEW/);
await db.exec("update input_invoices set status='unrecorded'; update purchase_order_items set conversion_factor=2,transaction_quantity=5000,transaction_unit_price=44");
const converted = await preview([order,line,5,44000,args[4]]);
assert.equal(converted.stockAfter,4.525);
assert.equal(converted.newDebt,220000);
await db.exec("update purchase_order_items set conversion_factor=1,transaction_quantity=10000,transaction_unit_price=22");
await db.exec("set test.denied = 'inventory.adjust'");
await assert.rejects(preview, /PURCHASE_CORRECTION_SCOPE_DENIED/);
await db.exec("set test.denied = ''; update purchase_orders set updated_at=updated_at+interval '1 second'");
await assert.rejects(() => apply(plan.token), /PURCHASE_CORRECTION_PREVIEW_STALE/);

await db.exec(`create function public.test_fail_audit() returns trigger language plpgsql as $$
  begin raise exception 'INJECTED_AUDIT_FAILURE'; end $$;
  create trigger test_fail_audit before insert on audit_log for each row execute function public.test_fail_audit();`);
const refreshed = await preview();
await assert.rejects(() => apply(refreshed.token), /INJECTED_AUDIT_FAILURE/);
assert.equal((await db.query('select quantity::float stock from branch_stock')).rows[0].stock,9994.525);
assert.equal((await db.query('select count(*)::int count from stock_movements')).rows[0].count,0);
await db.exec('drop trigger test_fail_audit on audit_log');

assert.equal((await apply(refreshed.token)).applied,true);
const actual = (await db.query(`select s.quantity::float stock, l.current_qty::float lot, l.initial_qty::float initial,
  p.stock::float global_stock, i.quantity::float received, i.unit_price::float price, po.debt::float debt, po.status,
  c.total_cost::float valuation,
  (select sum(case direction when 'in' then total_cost else -total_cost end)::float from fnb_branch_product_cost_events) journal,
  (select sum(case direction when 'in' then quantity else -quantity end)::float from fnb_branch_product_cost_events) journal_stock
  from branch_stock s, product_lots l, products p, purchase_order_items i, purchase_orders po, fnb_branch_product_cost_balances c`)).rows[0];
assert.deepEqual(actual,{stock:4.525,lot:4.525,initial:10,global_stock:18.611,received:10,price:22000,debt:220000,
  status:'completed',valuation:102187.5406,journal:102187.5406,journal_stock:4.525});
await assert.rejects(() => apply(refreshed.token), /PURCHASE_CORRECTION_NO_CHANGE/);
assert.equal((await db.query('select count(*)::int count from audit_log')).rows[0].count,1);
const priceOnly = [order,line,10,23000,'Chỉnh lại đơn giá'];
const repriced = await preview(priceOnly);
assert.equal(repriced.stockAfter,4.525);
assert.equal(repriced.newDebt,230000);
await db.query('select public.apply_supplier_receipt_correction($1,$2,$3,$4,$5,$6)', [...priceOnly,repriced.token]);
assert.equal((await db.query('select count(*)::int count from stock_movements')).rows[0].count,1);
assert.equal((await db.query('select total_amount::int total from input_invoices')).rows[0].total,230000);
await db.close();
console.log('Receipt correction: preview, cost replay, stock/lot balance, permission, stale preview, rollback, apply and duplicate guard passed.');
