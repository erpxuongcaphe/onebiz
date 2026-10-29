import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

export async function runUnifiedWarehouseUom(db,{id,tenant,actor,store,warehouse,product,submit}) {
  await db.exec(`create table if not exists uom_conversions(tenant_id uuid,product_id uuid,from_unit text,to_unit text,factor numeric,is_active boolean);
    alter table purchase_order_items add column if not exists unit text,add column if not exists unit_price numeric,add column if not exists transaction_quantity numeric,add column if not exists transaction_unit text,add column if not exists transaction_unit_price numeric,add column if not exists conversion_factor numeric;
    update products set unit='Lon' where id='${product}';
    insert into uom_conversions(tenant_id,product_id,from_unit,to_unit,factor,is_active) values('${tenant}','${product}','Thùng','Lon',12,true),('${tenant}','${product}','Lon','G',1000,true);`);
  const resolver=readFileSync('supabase/migrations/00320_uom_accounting_snapshots.sql','utf8').match(/create or replace function public\.resolve_product_uom_factor[\s\S]*?\n\$\$;/i)[0];
  await db.exec(resolver);
  // Reuse the real PO UOM save engine already installed by the fixture.
  const before=(await db.query('select * from effects')).rows;
  await db.exec('create table internal_sale_items(id uuid);');
  // The fixture has no reporting view; verify its unchanged scope predicate in production rollback validation.
  await db.exec(readFileSync('supabase/migrations/20261028120921_unified_transaction_uom.sql','utf8').replace(/-- BEGIN scoped snapshot view[\s\S]*?-- END scoped snapshot view/,'').replace(/-- BEGIN production drift guard[\s\S]*?-- END production drift guard/,''));
  await db.exec(`set test.actor='${actor}';set test.branch='${store}';set test.denied='no';`);
  const input=[{productId:product,quantity:2,unit:'Thùng',expectedFactor:12,note:'Giao nguyên thùng'}];
  const result=await submit(id(9971),input);
  const po=(await db.query('select * from purchase_order_items where purchase_order_id=$1',[result.purchaseOrderId])).rows[0];
  const so=(await db.query('select * from invoice_items where invoice_id=$1',[result.salesOrderId])).rows[0];
  assert.equal(Number(po.quantity),24); assert.equal(po.unit,'Lon');
  assert.equal(Number(po.transaction_quantity),2); assert.equal(po.transaction_unit,'Thùng');
  assert.equal(Number(po.conversion_factor),12); assert.equal(so.unit,'Lon'); assert.equal(Number(so.quantity),24);
  assert.equal(so.transaction_unit,'Thùng'); assert.equal(Number(so.transaction_quantity),2);
  assert.equal(Number(so.transaction_unit_price),Number(po.transaction_unit_price)); assert.equal(Number(so.unit_price),Number(po.unit_price)); assert.equal(so.note,input[0].note);
  assert.deepEqual(await submit(id(9971),input),result,'retry must return original paired demand');
  const detail=(await db.query('select get_fnb_warehouse_order_for_change($1) d',[result.purchaseOrderId])).rows[0].d;
  assert.equal(detail.items[0].unit,'Thùng'); assert.equal(Number(detail.items[0].quantity),2);
  for (const bad of [{...input[0],unit:'Missing'},{...input[0],expectedFactor:11}]) {
    await assert.rejects(()=>submit(id(9972),[bad]),/UOM_/);
  }
  await assert.rejects(()=>submit(id(9971),[{...input[0],unit:'Lon'}]),/nội dung khác/);
  const changed=(await db.query('select change_fnb_warehouse_order($1,0,$2,$3,$4::jsonb,$5,$6) d',[result.purchaseOrderId,id(9973),'edit',JSON.stringify([{...input[0],quantity:3}]),'Đổi nhu cầu','Thêm một thùng'])).rows[0].d;
  assert.equal(changed.revision,1);
  const edited=(await db.query('select * from purchase_order_items where purchase_order_id=$1',[result.purchaseOrderId])).rows[0];
  assert.equal(Number(edited.quantity),36); assert.equal(Number(edited.transaction_quantity),3); assert.equal(edited.transaction_unit,'Thùng');
  assert.deepEqual((await db.query('select * from effects')).rows,before,'demand must not post stock or cash');
  await db.exec(`alter table invoices add column if not exists deleted_at timestamptz,add column if not exists updated_at timestamptz;
    create table shipping_orders(id uuid,code text,tenant_id uuid,invoice_id uuid,status text,created_at timestamptz,updated_at timestamptz,shipping_fee numeric,cod_amount numeric,partner_id uuid);
    create table delivery_partners(id uuid,tenant_id uuid,is_active boolean);`);
  const save=async(orderId,items)=> (await db.query('select save_sales_order_atomic($1,null,$2,null,$3::jsonb,0,null,null,null,null,null) r',[orderId,store,JSON.stringify(items)])).rows[0].r;
  const salesLines=[{product_id:product,unit:'Thùng',quantity:2,unit_price:120000,note:'Sales UOM'}];
  const sales=await save(null,salesLines);
  const salesRow=(await db.query('select * from invoice_items where invoice_id=$1',[sales.order_id])).rows[0];
  assert.equal(Number(salesRow.quantity),24); assert.equal(salesRow.unit,'Lon'); assert.equal(Number(salesRow.unit_price),10000);
  assert.equal(Number(salesRow.transaction_quantity),2); assert.equal(salesRow.transaction_unit,'Thùng'); assert.equal(Number(salesRow.total),240000);
  await save(sales.order_id,[{...salesLines[0],quantity:3}]);
  assert.equal(Number((await db.query('select quantity from invoice_items where invoice_id=$1',[sales.order_id])).rows[0].quantity),36);
  await assert.rejects(()=>save(null,[{...salesLines[0],unit:'Undefined'}]),/UOM_/);
  await db.exec("set test.denied='yes'"); await assert.rejects(()=>save(null,salesLines),/ORDER_SAVE_DENIED/); await db.exec("set test.denied='no'");
  assert.deepEqual((await db.query('select * from effects')).rows,before);
  await db.exec('create view invoice_items_scoped as select id from invoice_items;');
  await db.exec(readFileSync('supabase/migrations/20261029005434_restore_uom_scoped_view_barrier.sql','utf8'));
  assert.deepEqual((await db.query("select reloptions from pg_class where oid='invoice_items_scoped'::regclass")).rows[0].reloptions,['security_barrier=true']);
  console.log('PASS unified UOM: paired PO/order, server pricing, selected-unit readback, retry, conversion guard and edit; no stock/cash effects');
}


