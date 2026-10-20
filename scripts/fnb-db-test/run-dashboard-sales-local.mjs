import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const runtime = process.argv[2];
if (!runtime) throw new Error('Pass the isolated PGlite module path.');
const { PGlite } = await import(pathToFileURL(path.resolve(runtime)).href);
const db = new PGlite();
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const tenant = id(1), otherTenant = id(2), store = id(10), warehouse = id(11), otherStore = id(12);
const manager = id(20), cashier = id(21), owner = id(22), inactive = id(23);
await db.exec(`
create role anon; create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.actor',true),'')::uuid $$;
create table profiles(id uuid primary key,tenant_id uuid,is_active boolean);
create table branches(id uuid primary key,tenant_id uuid,branch_type text);
create table test_permissions(actor uuid,code text);
create table test_branches(actor uuid,branch uuid);
create function public.user_has_permission(a uuid,c text) returns boolean language sql stable as $$ select exists(select 1 from public.test_permissions where actor=a and code=c) $$;
create function public.can_read_branch_document_00567(t uuid,b uuid) returns boolean language sql stable as $$ select exists(select 1 from public.profiles p join public.branches x on x.tenant_id=p.tenant_id where p.id=auth.uid() and p.is_active and p.tenant_id=t and x.id=b and (exists(select 1 from public.test_branches where actor=p.id and branch=b) or public.user_has_permission(p.id,'reports.view_all_branches'))) $$;
create table invoices(id uuid primary key,tenant_id uuid,branch_id uuid,source text,status text,ngay_chung_tu timestamptz,total numeric,discount_amount numeric,deleted_at timestamptz);
create table kitchen_orders(id uuid primary key,tenant_id uuid,branch_id uuid,invoice_id uuid,order_type text,status text);
create table sales_returns(id uuid primary key,tenant_id uuid,branch_id uuid,invoice_id uuid,status text,created_at timestamptz,total numeric);
create table cash_transactions(id uuid primary key,tenant_id uuid,branch_id uuid,type text,status text,transaction_date date,amount numeric,payment_method text,reference_type text,reference_id uuid);
insert into profiles values ('${manager}','${tenant}',true),('${cashier}','${tenant}',true),('${owner}','${tenant}',true),('${inactive}','${tenant}',false);
insert into branches values ('${store}','${tenant}','store'),('${warehouse}','${tenant}','warehouse'),('${otherStore}','${otherTenant}','store');
insert into test_branches values ('${manager}','${store}'),('${cashier}','${store}');
insert into test_permissions values ('${manager}','pos_fnb.view_sales_summary'),('${cashier}','finance.view_cash_book'),('${owner}','reports.dashboard'),('${owner}','reports.view_all_branches'),('${owner}','pos_fnb.view_sales_summary'),('${inactive}','pos_fnb.view_sales_summary');
insert into invoices values
('${id(100)}','${tenant}','${store}','fnb','completed','2026-10-19 17:00:00Z',900,100,null),
('${id(101)}','${tenant}','${store}','fnb','completed','2026-10-20 16:59:59Z',500,0,null),
('${id(102)}','${tenant}','${store}','fnb','cancelled','2026-10-20 08:00:00Z',300,0,null),
('${id(103)}','${tenant}','${store}','fnb','completed','2026-10-20 17:00:00Z',700,0,null),
('${id(104)}','${tenant}','${warehouse}','internal','completed','2026-10-20 08:00:00Z',800,0,null),
('${id(105)}','${otherTenant}','${otherStore}','fnb','completed','2026-10-20 08:00:00Z',999999,0,null),
('${id(106)}','${tenant}','${store}','fnb','completed','2026-10-20 08:00:00Z',999,0,now());
insert into kitchen_orders values
('${id(200)}','${tenant}','${store}','${id(100)}','takeaway','completed'),
('${id(201)}','${tenant}','${store}','${id(100)}','takeaway','completed'),
('${id(202)}','${tenant}','${store}','${id(101)}','dine_in','completed');
insert into sales_returns values ('${id(300)}','${tenant}','${store}','${id(100)}','completed','2026-10-20 10:00:00Z',200),('${id(301)}','${tenant}','${store}','${id(102)}','completed','2026-10-20 10:00:00Z',300);
insert into cash_transactions values
('${id(400)}','${tenant}','${store}','receipt','completed','2026-10-20',900,'cash','invoice','${id(100)}'),
('${id(401)}','${tenant}','${store}','receipt','completed','2026-10-20',500,'transfer','invoice','${id(101)}'),
('${id(402)}','${tenant}','${store}','receipt','completed','2026-10-19',300,'transfer','invoice','${id(102)}'),
('${id(403)}','${tenant}','${store}','payment','completed','2026-10-20',300,'transfer','invoice_void','${id(102)}'),
('${id(404)}','${tenant}','${store}','payment','completed','2026-10-20',200,'cash','sales_return','${id(300)}'),
('${id(405)}','${tenant}','${store}','receipt','cancelled','2026-10-20',999,'cash','invoice','${id(100)}'),
('${id(406)}','${tenant}','${warehouse}','receipt','completed','2026-10-20',800,'cash','invoice','${id(104)}'),
('${id(407)}','${otherTenant}','${otherStore}','receipt','completed','2026-10-20',999999,'cash','invoice','${id(105)}'),
('${id(408)}','${tenant}','${store}','payment','completed','2026-10-20',999,'cash','purchase_order','${id(100)}');
`);
const snapshot = async () => (await db.query(`select jsonb_build_array((select jsonb_agg(i order by id) from invoices i),(select jsonb_agg(c order by id) from cash_transactions c),(select jsonb_agg(r order by id) from sales_returns r)) value`)).rows[0].value;
const before = await snapshot();
await db.exec(await readFile('supabase/migrations/202610200007_operational_sales_dashboard.sql', 'utf8'));
const as = actor => db.query(`select set_config('test.actor',$1,false)`, [actor]);
const report = async (branch = store, from = '2026-10-20', to = from, grain = 'hour') => (await db.query(`select public.get_operational_sales_dashboard($1,$2,$3,$4) value`, [branch, from, to, grain])).rows[0].value;
await as(manager);
const day = await report();
assert.equal(day.sales, 1200, 'invoice net value minus returns, not minus discounts twice');
assert.equal(day.discounts, 100);
assert.equal(day.orders, 2, 'multiple kitchen rows must not multiply invoice counts');
assert.equal(day.received, 1400); assert.equal(day.refunded, 500); assert.equal(day.collected, 900);
assert.deepEqual(day.methods, { cash: 700, transfer: 200 });
assert.equal(day.buckets.length, 24);
assert.equal(day.buckets[0].sales, 900, 'Vietnam midnight belongs to the correct day');
assert.equal(day.buckets[23].sales, 500);
assert.equal(day.buckets.reduce((n, b) => n + b.sales, 0), day.sales);
assert.equal(day.modes.reduce((n, m) => n + m.orders, 0), 2);
assert.equal(day.modes.find(m => m.mode === 'takeaway').sales, 700);
await assert.rejects(report(warehouse), /BRANCH_DENIED/);
await assert.rejects(report(otherStore), /BRANCH_DENIED/);
await assert.rejects(report(null), /ALL_BRANCHES_DENIED/);
await assert.rejects(report(store, '2026-10-21', '2026-10-20'), /RANGE_INVALID/);
await assert.rejects(report(store, '2026-01-01', '2026-10-20', 'hour'), /TOO_MANY_BUCKETS/);
await as(cashier); await assert.rejects(report(), /SALES_PERMISSION_DENIED/);
await as(inactive); await assert.rejects(report(), /ACTIVE_PROFILE_REQUIRED/);
await as(owner);
assert.equal((await report(null)).sales, 1200, 'all-company excludes internal sale and other tenant');
assert.equal((await report(warehouse)).sales, 800, 'selected branch retains internal activity');
assert.equal((await report(null, '2026-10-01', '2026-10-31', 'day')).buckets.length, 31);
assert.equal((await report(null, '2026-01-01', '2026-12-31', 'month')).buckets.length, 12);
assert.equal((await report(null, '2022-01-01', '2026-12-31', 'year')).buckets.length, 5);
assert.deepEqual(await snapshot(), before, 'migration and reads leave business data unchanged');
await db.exec(`insert into invoices select ('10000000-0000-0000-0000-'||lpad(g::text,12,'0'))::uuid,'${tenant}','${store}','retail','completed','2026-10-20 08:00:00Z',1,0,null from generate_series(1,1200) g`);
assert.equal((await report(null)).orders, 1202, 'aggregation is not truncated by API page limits');
await db.exec(`insert into cash_transactions values ('${id(409)}','${tenant}','${store}','receipt','completed','2026-10-20',10,null,'invoice','${id(100)}')`);
assert.equal((await report()).methods.unknown, 10, 'unknown method must not be silently called cash');
const privileges = (await db.query(`select has_function_privilege('anon','public.get_operational_sales_dashboard(uuid,date,date,text)','execute') anon,has_function_privilege('authenticated','public.get_operational_sales_dashboard(uuid,date,date,text)','execute') authenticated`)).rows[0];
assert.deepEqual(privileges, { anon: false, authenticated: true });
await db.close();
console.log('PASS: sales, returns, refund methods, Vietnam dates, grains, branch/permission denial, no writes, 1200+ invoices.');
