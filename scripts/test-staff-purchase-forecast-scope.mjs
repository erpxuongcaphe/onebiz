// Isolated synthetic PostgreSQL fixture; does not connect to ONEBIZ.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {initializeStaffAccessFixture} from './staff-access-tests/fixture.mjs';
import {functionFromMigration} from './staff-access-tests/inventory.mjs';
const {PGlite}=await import(process.env.ONEBIZ_PGLITE_MODULE ? pathToFileURL(process.env.ONEBIZ_PGLITE_MODULE).href : '@electric-sql/pglite');
const db=new PGlite();
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const migration=name=>readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8');
try {
 await initializeStaffAccessFixture(db,id);
 await db.exec(await migration('20261111052704_staff_branch_access.sql'));
 await db.exec(await functionFromMigration('20261111070229_staff_branch_checkout_permissions.sql','_staff_permission_at_scope'));
 await db.exec(`
  create table invoices(id uuid primary key,tenant_id uuid,branch_id uuid,source text,status text,deleted_at timestamptz,voided_at timestamptz,cancelled_at timestamptz,fulfilled_by_id uuid,source_order_id uuid);
  create table invoice_items(id uuid,invoice_id uuid,product_id uuid,quantity numeric,total numeric);
  create table sales_order_processing_closures(order_id uuid,tenant_id uuid,closed_at timestamptz);
  create function public.can_read_branch_document_00567(t uuid,b uuid) returns boolean language sql stable security definer as $$
   select t=public.get_user_tenant_id() and (public.user_has_branch_access(auth.uid(),b) or public.user_has_permission(auth.uid(),'reports.view_all_branches')) $$;
  insert into invoices values
   ('${id(200)}','${id(1)}','${id(10)}','order','draft',null,null,null,null,null),
   ('${id(201)}','${id(1)}','${id(10)}','pos','completed',null,null,null,null,'${id(200)}'),
   ('${id(202)}','${id(1)}','${id(10)}','pos','cancelled',null,null,null,null,'${id(200)}'),
   ('${id(203)}','${id(1)}','${id(11)}','order','draft',null,null,null,null,null),
   ('${id(204)}','${id(2)}','${id(12)}','order','draft',null,null,null,null,null);
  insert into invoice_items values ('${id(300)}','${id(200)}','${id(400)}',6,600),('${id(301)}','${id(200)}','${id(400)}',4,400),
   ('${id(302)}','${id(201)}','${id(400)}',3,300),('${id(303)}','${id(202)}','${id(400)}',5,500);
  insert into staff_branch_permission_catalog values ('inventory.create_po',1);
  insert into role_permissions values ('${id(20)}','inventory.create_po');
  grant usage on schema public,auth to authenticated;
  select set_config('request.jwt.claim.sub','${id(101)}',false);
 `);
 await db.exec(await migration('20261112174832_staff_purchase_forecast_scoped_lines.sql'));
 const grants=(await db.query("select has_function_privilege('anon','public.get_purchase_forecast_remaining_lines(uuid[])','execute') anonymous, has_function_privilege('authenticated','public.get_purchase_forecast_remaining_lines(uuid[])','execute') authenticated")).rows[0];
 assert.deepEqual(grants,{anonymous:false,authenticated:true},'forecast RPC is not available to anonymous clients');
 await db.exec('set role authenticated');
 const get=async ids=>(await db.query('select public.get_purchase_forecast_remaining_lines($1) result',[ids])).rows[0].result;
 assert.deepEqual(await get([id(200)]),[{orderId:id(200),productId:id(400),orderedQuantity:10,issuedQuantity:3,remainingQuantity:7,remainingAmount:700}]);
 await assert.rejects(db.query('select * from invoice_items'),/permission denied/,'forecast grant does not add raw invoice access');
 await assert.rejects(get([id(203)]),/PURCHASE_FORECAST_ORDER_SCOPE_OR_STATE_CHANGED/);
 await assert.rejects(get([id(204)]),/PURCHASE_FORECAST_ORDER_SCOPE_OR_STATE_CHANGED/);
 await assert.rejects(get([id(200),id(204)]),/PURCHASE_FORECAST_ORDER_SCOPE_OR_STATE_CHANGED/,'mixed-tenant batch fails as a whole');
 await assert.rejects(get([id(201)]),/PURCHASE_FORECAST_ORDER_SCOPE_OR_STATE_CHANGED/);
 await assert.rejects(get([null]),/PURCHASE_FORECAST_IDS_INVALID/);
 await db.exec(`reset role; update invoices set branch_id='${id(11)}' where id='${id(201)}'; set role authenticated;`);
 await assert.rejects(get([id(200)]),/PURCHASE_FORECAST_CHILD_SCOPE_REQUIRED/,'inaccessible completed child cannot silently inflate demand');
 await db.exec(`reset role; insert into user_branches values ('${id(101)}','${id(11)}',null); set role authenticated;`);
 assert.equal((await get([id(200)]))[0].remainingQuantity,7);
 await db.exec(`reset role; insert into invoice_items values ('${id(304)}','${id(201)}','${id(400)}',20,0); set role authenticated;`);
 assert.deepEqual((await get([id(200)]))[0],{orderId:id(200),productId:id(400),orderedQuantity:10,issuedQuantity:23,remainingQuantity:0,remainingAmount:0},'over-delivery never produces negative purchase demand');
 await db.exec(`reset role; delete from invoice_items where id='${id(304)}'; set role authenticated;`);
 await db.exec(`reset role; insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
  values ('${id(1)}','${id(101)}','${id(10)}','inventory.create_po','revoke','${id(100)}'); set role authenticated;`);
 await assert.rejects(get([id(200)]),/PURCHASE_FORECAST_ORDER_SCOPE_OR_STATE_CHANGED/);
 await db.exec(`reset role; delete from user_branch_permission_overrides where permission_code='inventory.create_po';
  insert into user_permission_overrides(tenant_id,user_id,permission_code,override_type,created_by)
  values ('${id(1)}','${id(101)}','inventory.create_po','revoke','${id(100)}'); set role authenticated;`);
 await assert.rejects(get([id(200)]),/PURCHASE_FORECAST_ORDER_SCOPE_OR_STATE_CHANGED/);
 await db.exec(`reset role; delete from user_permission_overrides where permission_code='inventory.create_po';
  delete from role_permissions where permission_code='inventory.create_po';
  insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
  values ('${id(1)}','${id(101)}','${id(10)}','inventory.create_po','grant','${id(100)}'); set role authenticated;`);
 assert.equal((await get([id(200)]))[0].remainingQuantity,7,'branch-only purchasing grant can run forecast without inventory view');
 await assert.rejects(get([id(203)]),/PURCHASE_FORECAST_ORDER_SCOPE_OR_STATE_CHANGED/,'branch-only grant does not authorize another branch');
 await db.exec(`reset role;
  insert into sales_order_processing_closures values ('${id(200)}','${id(1)}',now()); set role authenticated;`);
 await assert.rejects(get([id(200)]),/PURCHASE_FORECAST_ORDER_SCOPE_OR_STATE_CHANGED/,'closed order is rejected rather than reporting stale totals');
 console.log('PASS purchase forecast scoped aggregation, subtraction, permissions and incomplete-child rejection');
} catch(e) {console.error(e.message,e.where??'');process.exitCode=1;} finally {await db.close();}
