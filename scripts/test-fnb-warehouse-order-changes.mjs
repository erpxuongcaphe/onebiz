import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
export async function runChanges(db,ctx) {
 const {id,tenant,actor,store,warehouse,supplier,product,substitute,submit}=ctx;
 let checks=0; const test=async(name,fn)=>{await fn();checks++;console.log('PASS change: '+name);};
 const scalar=async(sql,params=[])=>Object.values((await db.query(sql,params)).rows[0])[0];
 const extract=(file,name)=>{const sql=readFileSync('supabase/migrations/'+file,'utf8');const start=sql.toLowerCase().indexOf('create or replace function public.'+name+'(');if(start<0)throw Error(name);const tail=sql.slice(start);const m=/\bas\s+(\$[a-z_]*\$)/i.exec(tail);const end=tail.indexOf(m[1]+';',m.index+m[0].length);return tail.slice(0,end+m[1].length+1);};
 await db.exec(`alter table purchase_orders add column supplier_id uuid default '${supplier}',add column supplier_name text,add column subtotal numeric,add column discount_amount numeric,add column tax_amount numeric,add column shipping_cost numeric,add column other_cost numeric,add column order_discount numeric,add column paid numeric default 0,add column debt numeric,add column created_by uuid,add column updated_at timestamptz default now();
 alter table purchase_order_items add column received_quantity numeric default 0,add column product_name text,add column unit text,add column unit_price numeric,add column discount numeric,add column vat_rate numeric,add column vat_amount numeric,add column total numeric,add column expiry_date date,add column lot_number text,add column transaction_quantity numeric,add column transaction_unit text,add column transaction_unit_price numeric,add column conversion_factor numeric;
 alter table invoices add column updated_at timestamptz default now(),add column deleted_at timestamptz;
 alter table audit_log add column old_data jsonb;
 create table internal_sales(invoice_id uuid,status text);
 create table uom_conversions(tenant_id uuid,product_id uuid,is_active boolean,from_unit text,to_unit text,factor numeric);
 alter function next_code(uuid,text) set search_path=public;
 alter function get_user_tenant_id() set search_path=public;
 `);
 await db.exec(extract('00299_align_purchase_order_vnd_rounding.sql','save_purchase_order_atomic'));
 await db.exec(extract('00320_uom_accounting_snapshots.sql','resolve_product_uom_factor'));
 await db.exec(extract('00320_uom_accounting_snapshots.sql','save_purchase_order_with_uom_atomic'));
 const before=(await db.query('select id,status,total,note from purchase_orders order by id')).rows;
 await db.exec(readFileSync('supabase/migrations/202610260100_fnb_warehouse_order_changes.sql','utf8'));
 await test('migration leaves old business documents untouched',async()=>assert.deepEqual((await db.query('select id,status,total,note from purchase_orders order by id')).rows,before));
 let seq=11000; const fresh=()=>submit(id(seq++),[{productId:product,quantity:2,note:'Nguyên thùng'}],'  Giao sáng\nGiữ nguyên  ');
 const change=(po,rev=0,action='edit',key=id(seq++),items=[{productId:product,quantity:3,note:'  Dòng mới\nGiữ lạnh  '}],note='  Ghi chú mới\nkhông tự chèn lý do  ',reason='Điều chỉnh nhu cầu')=>scalar('select change_fnb_warehouse_order($1,$2,$3,$4,$5::jsonb,$6,$7)',[po,rev,key,action,JSON.stringify(items),note,reason]);
 const detail=po=>scalar('select get_fnb_warehouse_order_for_change($1)',[po]);
 let saved=await fresh();let accepted;
 await test('edit changes both sides, preserves codes/UOM/notes, creates no stock or cash effects',async()=>{
  const codes=(await db.query('select * from codes order by entity')).rows;const effects=await scalar('select count(*) from effects');
  accepted=await change(saved.purchaseOrderId);
  assert.equal(accepted.code,saved.code);assert.equal(accepted.salesOrderCode,saved.salesOrderCode);assert.equal(accepted.revision,1);
  const d=await detail(saved.purchaseOrderId);assert.equal(d.note,'  Ghi chú mới\nkhông tự chèn lý do  ');assert.equal(d.items[0].note,'  Dòng mới\nGiữ lạnh  ');assert.equal(Number(d.items[0].quantity),3);
  const pi=(await db.query('select * from purchase_order_items where purchase_order_id=$1',[saved.purchaseOrderId])).rows[0];
  assert.equal(Number(pi.quantity),3);assert.equal(Number(pi.transaction_quantity),3);assert.equal(Number(pi.conversion_factor),1);assert.equal(pi.note,d.items[0].note);
  assert.equal(Number(await scalar('select total from purchase_orders where id=$1',[saved.purchaseOrderId])),375000);
  assert.equal(Number(await scalar('select total from invoices where id=$1',[saved.salesOrderId])),375000);
  assert.deepEqual((await db.query('select * from codes order by entity')).rows,codes);assert.equal(await scalar('select count(*) from effects'),effects);
 });
 await test('stale revision rejects a second editor and preserves the first change',async()=>{await assert.rejects(()=>change(saved.purchaseOrderId,0),/vừa được thay đổi/);assert.equal((await detail(saved.purchaseOrderId)).revision,1);});
 await test('lost response retry reuses result once; changed payload under same key is rejected',async()=>{
  const p=await fresh(),key=id(seq++);const first=await change(p.purchaseOrderId,0,'edit',key);const audit=await scalar('select count(*) from audit_log');
  assert.deepEqual(await change(p.purchaseOrderId,0,'edit',key),first);assert.equal(await scalar('select count(*) from audit_log'),audit);
  await assert.rejects(()=>change(p.purchaseOrderId,0,'edit',key,[{productId:substitute,quantity:9}]),/nội dung khác/);
 });
 await test('cancel synchronizes statuses, keeps rows/employee note and writes reason only to audit',async()=>{
  const p=await fresh(),d=await detail(p.purchaseOrderId),key=id(seq++);const count=await scalar('select count(*) from invoice_items where invoice_id=$1',[p.salesOrderId]);
  const result=await change(p.purchaseOrderId,0,'cancel',key);assert.deepEqual(await change(p.purchaseOrderId,0,'cancel',key),result);
  assert.equal(await scalar('select status from purchase_orders where id=$1',[p.purchaseOrderId]),'cancelled');assert.equal(await scalar('select status from invoices where id=$1',[p.salesOrderId]),'cancelled');
  assert.equal(await scalar('select count(*) from invoice_items where invoice_id=$1',[p.salesOrderId]),count);assert.equal((await detail(p.purchaseOrderId)).note,d.note);
  assert.equal(await scalar("select new_data->>'reason' from audit_log where entity_id=$1 and action='fnb_warehouse_order_cancel'",[p.purchaseOrderId]),'Điều chỉnh nhu cầu');
 });
 await test('active warehouse child blocks edit/cancel; cancelling draft permits a fresh edit',async()=>{
  const p=await fresh();const child=id(seq++);await db.query("insert into invoices(id,tenant_id,source_order_id,status,source) values($1,$2,$3,'draft','pos')",[child,tenant,p.salesOrderId]);
  assert.match((await detail(p.purchaseOrderId)).blockedReason,/đang mở/);
  for(const action of ['edit','cancel'])await assert.rejects(()=>change(p.purchaseOrderId,0,action),/đang mở/);
  await db.query("update invoices set status='cancelled' where id=$1",[child]);assert.equal((await change(p.purchaseOrderId)).revision,1);
 });
 await test('completed, even deleted, child and fulfilled parent block both actions',async()=>{
  for(const mode of ['completed','fulfilled']){const p=await fresh();
   if(mode==='completed')await db.query("insert into invoices(tenant_id,source_order_id,status,deleted_at) values($1,$2,'completed',now())",[tenant,p.salesOrderId]);
   else await db.query('update invoices set fulfilled_by_id=$1 where id=$2',[id(seq++),p.salesOrderId]);
   for(const action of ['edit','cancel'])await assert.rejects(()=>change(p.purchaseOrderId,0,action),/đã xuất/);
  }
 });
 await test('historical internal dispatch remains blocked even if its invoice was later cancelled',async()=>{
  const p=await fresh(),child=id(seq++);await db.query("insert into invoices(id,tenant_id,source_order_id,status) values($1,$2,$3,'cancelled')",[child,tenant,p.salesOrderId]);await db.query("insert into internal_sales values($1,'cancelled')",[child]);
  for(const action of ['edit','cancel'])await assert.rejects(()=>change(p.purchaseOrderId,0,action),/đã xuất/);
 });
 await test('receipt and received quantities forbid mutation',async()=>{
  for(const mode of ['receipt','quantity']){const p=await fresh();
   if(mode==='receipt'){await assert.rejects(()=>db.query('insert into input_invoices(purchase_order_id) values($1)',[p.purchaseOrderId]),/đã gửi/);await db.exec('alter table input_invoices disable trigger guard_fnb_po_receipt');await db.query('insert into input_invoices(purchase_order_id) values($1)',[p.purchaseOrderId]);await db.exec('alter table input_invoices enable trigger guard_fnb_po_receipt');}
   else {await db.exec('alter table purchase_order_items disable trigger guard_fnb_po_items');await db.query('update purchase_order_items set received_quantity=1 where purchase_order_id=$1',[p.purchaseOrderId]);await db.exec('alter table purchase_order_items enable trigger guard_fnb_po_items');}
   for(const action of ['edit','cancel'])await assert.rejects(()=>change(p.purchaseOrderId,0,action),/nhận hàng/);
  }
 });
 await test('no direct updates, fake session flag or private-table grants can bypass guards',async()=>{
  await db.exec("set onebiz.fnb_order_change='yes'");await assert.rejects(()=>db.query("update purchase_orders set note='tamper' where id=$1",[saved.purchaseOrderId]),/đã gửi/);
  await assert.rejects(()=>db.query('delete from invoices where id=$1',[saved.salesOrderId]),/Giữ đơn/);
  assert.equal(await scalar("select has_table_privilege('authenticated','private.fnb_order_changes','INSERT')"),false);
  assert.equal(await scalar('select count(*) from private.fnb_order_changes where active'),0);
 });
 await test('invalid quantity, duplicates and inactive/BTP items roll back both sides',async()=>{
  const p=await fresh();const baseline=await detail(p.purchaseOrderId);
  for(const items of [[{productId:product,quantity:0}],[{productId:product,quantity:NaN}],[{productId:product,quantity:1},{productId:product,quantity:2}]])await assert.rejects(()=>change(p.purchaseOrderId,0,'edit',id(seq++),items));
  await db.query('update products set is_fnb_stock_item=true where id=$1',[product]);await assert.rejects(()=>change(p.purchaseOrderId),/không còn được phép/);await db.query('update products set is_fnb_stock_item=false where id=$1',[product]);
  assert.deepEqual(await detail(p.purchaseOrderId),baseline);
 });
 await test('write failure after PO save atomically restores both documents and mutation receipt',async()=>{
  const p=await fresh(),baseline=await detail(p.purchaseOrderId),receipts=await scalar('select count(*) from private.fnb_order_changes');
  await db.exec("create function fail_change_fixture() returns trigger language plpgsql as $$begin raise exception 'injected sync failure';end$$;create trigger fail_change_fixture before insert on invoice_items for each row execute function fail_change_fixture()");
  await assert.rejects(()=>change(p.purchaseOrderId),/injected sync failure/);await db.exec('drop trigger fail_change_fixture on invoice_items');
  assert.deepEqual(await detail(p.purchaseOrderId),baseline);assert.equal(await scalar('select count(*) from private.fnb_order_changes'),receipts);
 });
 await test('wrong branch, missing privilege and foreign tenant fail closed',async()=>{
  const p=await fresh();await db.exec("set test.branch='"+warehouse+"'");await assert.rejects(()=>change(p.purchaseOrderId),/chi nhánh/);await db.exec("set test.branch='"+store+"';set test.denied='yes'");await assert.rejects(()=>change(p.purchaseOrderId),/quyền/);await db.exec("set test.denied='no';set test.actor='"+id(99999)+"'");await assert.rejects(()=>change(p.purchaseOrderId),/quyền/);await db.exec("set test.actor='"+actor+"'");
 });
 console.log(`${checks} order-change SQL scenarios passed; stock posting stub effects unchanged.`);
}
