import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(process.env.ONEBIZ_PGLITE_MODULE ? pathToFileURL(process.env.ONEBIZ_PGLITE_MODULE).href : '@electric-sql/pglite');

const db = new PGlite();
const actor = '00000000-0000-0000-0000-000000000001';
const tenant = '00000000-0000-0000-0000-000000000002';
const branch = '00000000-0000-0000-0000-000000000003';
const order = '00000000-0000-0000-0000-000000000004';
const product = '00000000-0000-0000-0000-000000000005';

await db.exec(`
  create role anon;
  create role authenticated;
  create schema auth;
  create function auth.uid() returns uuid language sql as $$
    select '${actor}'::uuid
  $$;
  create function get_user_tenant_id() returns uuid language sql as $$
    select '${tenant}'::uuid
  $$;
  create function user_has_branch_access(uuid,uuid) returns boolean language sql as $$
    select $2 = '${branch}'::uuid
  $$;
  create function _staff_permission_at_scope(uuid,text,uuid) returns boolean language sql as $$
    select $2 <> coalesce(current_setting('test.denied', true), '')
  $$;
  create table profiles(id uuid,tenant_id uuid,is_active boolean);
  create table purchase_orders(id uuid,tenant_id uuid,branch_id uuid,status text,paid numeric);
  create table purchase_order_items(purchase_order_id uuid,product_id uuid,received_quantity numeric,product_name text,unit text);
  create table supplier_returns(purchase_order_id uuid,tenant_id uuid,status text);
  create table branch_stock(tenant_id uuid,branch_id uuid,product_id uuid,variant_id uuid,quantity numeric,reserved numeric);
  create table products(id uuid,tenant_id uuid,stock numeric);
  create table product_lots(purchase_order_id uuid,tenant_id uuid,branch_id uuid,product_id uuid,status text,current_qty numeric,initial_qty numeric);
  create function revert_received_purchase_order_atomic(uuid,uuid,boolean)
  returns jsonb language plpgsql as $$
  begin
    if $3 then raise exception 'UNEXPECTED_ALLOW_NEGATIVE'; end if;
    update public.purchase_orders set status='draft' where id=$1;
    update public.branch_stock set quantity=quantity-5;
    return '{}'::jsonb;
  end $$;
  create function set_purchase_order_state_atomic(uuid,text,text)
  returns jsonb language plpgsql as $$
  begin
    if current_setting('test.fail', true) = 'yes' then raise exception 'INJECTED_FAILURE'; end if;
    update public.purchase_orders set status=$2 where id=$1;
    return jsonb_build_object('purchase_order_id',$1,'status',$2);
  end $$;
  insert into profiles values ('${actor}','${tenant}',true);
  insert into purchase_orders values ('${order}','${tenant}','${branch}','completed',0);
  insert into purchase_order_items values ('${order}','${product}',5,'Đường','Kg');
  insert into products values ('${product}','${tenant}',20);
  insert into branch_stock values ('${tenant}','${branch}','${product}',null,8,0);
`);

await db.exec(await readFile(new URL('../supabase/migrations/20261117101000_atomic_supplier_receipt_cancel.sql', import.meta.url), 'utf8'));
const cancel = () => db.query('select public.cancel_supplier_receipt_atomic($1,$2)', [order,'Nhập trùng']);
const preview = async () => (await db.query('select public.get_supplier_receipt_cancel_risks($1) as risks', [order])).rows[0].risks;
const state = async () => (await db.query('select status,quantity::int as stock from purchase_orders cross join branch_stock')).rows[0];

await db.exec("set test.fail = 'yes'");
await assert.rejects(cancel, /INJECTED_FAILURE/);
assert.deepEqual(await state(), {status:'completed',stock:8});
await db.exec("set test.fail = 'no'; set test.denied = 'inventory.adjust'");
await assert.rejects(cancel, /PURCHASE_CANCEL_SCOPE_DENIED/);
await db.exec("set test.denied = ''; update branch_stock set reserved=4");
assert.deepEqual(await preview(), [{product_name:'Đường',unit:'Kg',needed:5}]);
await assert.rejects(cancel, /PURCHASE_CANCEL_STOCK_REVIEW_REQUIRED/);
await db.exec(`update branch_stock set reserved=0; insert into product_lots values
  ('${order}','${tenant}','${branch}','${product}','active',4,5);`);
assert.deepEqual(await preview(), [{product_name:'Đường',unit:'Kg',needed:5}]);
await assert.rejects(cancel, /PURCHASE_CANCEL_RECEIPT_ALREADY_USED/);
await db.exec('update product_lots set current_qty=initial_qty');
assert.deepEqual(await preview(), []);
await db.exec("update branch_stock set reserved=0; update purchase_orders set paid=100");
await assert.rejects(cancel, /PURCHASE_CANCEL_PAYMENT_REVIEW_REQUIRED/);
await db.exec("update purchase_orders set paid=0");
await cancel();
await cancel();
assert.deepEqual(await state(), {status:'cancelled',stock:3});
await db.close();
console.log('Atomic cancellation: rollback, permission, available stock, payment, success, retry passed.');
