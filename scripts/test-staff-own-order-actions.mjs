// Synthetic action stubs; validates the guard without touching real orders.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {initializeStaffAccessFixture} from './staff-access-tests/fixture.mjs';
import {functionFromMigration} from './staff-access-tests/inventory.mjs';
const {PGlite}=await import(process.env.ONEBIZ_PGLITE_MODULE?pathToFileURL(process.env.ONEBIZ_PGLITE_MODULE).href:'@electric-sql/pglite');
const db=new PGlite(),id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const file=n=>readFile(new URL(`../supabase/migrations/${n}`,import.meta.url),'utf8');
try {
 await initializeStaffAccessFixture(db,id);
 await db.exec(await file('20261111052704_staff_branch_access.sql'));
 await db.exec(await functionFromMigration('20261111070229_staff_branch_checkout_permissions.sql','_staff_permission_at_scope'));
 await db.exec(await functionFromMigration('20261111095224_staff_branch_kitchen_permissions.sql','_staff_permission_any_branch'));
 await db.exec(`
  create table invoices(id uuid primary key,tenant_id uuid,branch_id uuid,source text,created_by uuid);
  create table action_markers(id uuid);
  create function public.can_read_branch_document_00567(t uuid,b uuid) returns boolean language sql stable security definer set search_path=public as $$select t=get_user_tenant_id() and (user_has_branch_access(auth.uid(),b) or user_has_permission(auth.uid(),'reports.view_all_branches'))$$;
  insert into invoices values ('${id(200)}','${id(1)}','${id(10)}','order','${id(101)}'),('${id(201)}','${id(1)}','${id(11)}','order','${id(100)}'),('${id(202)}','${id(2)}','${id(12)}','order','${id(102)}');
  insert into user_branches values ('${id(101)}','${id(11)}',null);
  delete from role_permissions where role_id='${id(20)}';
  insert into role_permissions values ('${id(20)}','orders.view_own_only'),('${id(20)}','orders.create'),('${id(20)}','orders.cancel');
  select set_config('request.jwt.claim.sub','${id(101)}',false);
 `);
 for(const name of ['_staff_order_owner_unrestricted','_staff_order_independent_branches'])
  await db.exec(await functionFromMigration('20261113004524_staff_own_order_scope.sql',name));
 const names=['close_sales_order_processing','reopen_sales_order_processing','create_child_sale_from_order','mark_order_processed','save_sales_order_atomic'];
 const extra=[['attach_invoice_shipment_atomic','p_invoice_id','orders.create',true],['update_draft_invoice_atomic','p_invoice_id','orders.create',false],['cancel_draft_invoice_atomic','p_invoice_id','orders.cancel',false],['duplicate_invoice_to_order_atomic','p_source_invoice_id','orders.create',false]];
 const actual=process.env.ONEBIZ_OWN_ACTION_AUDIT_FILE ? JSON.parse(await readFile(process.env.ONEBIZ_OWN_ACTION_AUDIT_FILE,'utf8')) : null;
 if(actual) {
  for(const name of [...names,...extra.map(x=>x[0]),'close_sales_orders_processing']) {
   const match=actual.find(x=>x.proname===name);assert.ok(match,`${name} must be captured`);await db.exec(match.definition);
  }
 } else {
 for(const name of names) await db.exec(`create function public.${name}(p_order_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
 begin
  if not public.user_has_permission(auth.uid(),'orders.create') and not (${name==='create_child_sale_from_order' ? "public.user_has_permission(auth.uid(),'pos_retail.checkout')" : 'false'}) then raise exception 'ORIGINAL_PERMISSION_DENIED';end if;
  if p_order_id is not null and not exists(select 1 from public.invoices i where i.id=p_order_id and i.tenant_id=public.get_user_tenant_id()) then raise exception 'ORIGINAL_ORDER_NOT_FOUND';end if;
  insert into public.action_markers values(p_order_id);return jsonb_build_object('ok',true);
 end $$;`);
 for(const [name,param,permission,retail] of extra) await db.exec(`create function public.${name}(${param} uuid) returns jsonb language plpgsql security definer set search_path='' as $$
 begin
  if not public.user_has_permission(auth.uid(),'${permission}') and not (${retail ? "public.user_has_permission(auth.uid(),'pos_retail.checkout')" : 'false'}) then raise exception 'ORIGINAL_PERMISSION_DENIED';end if;
  if ${param} is not null and not exists(select 1 from public.invoices i where i.id=${param} and i.tenant_id=public.get_user_tenant_id()) then raise exception 'ORIGINAL_ORDER_NOT_FOUND';end if;
  insert into public.action_markers values(${param});return jsonb_build_object('ok',true);
 end $$;`);
 await db.exec(`create function public.close_sales_orders_processing(p_order_ids uuid[],p_reason text default null,p_apply boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
 begin
  if not public.user_has_permission(auth.uid(),'orders.create') then raise exception 'ORIGINAL_PERMISSION_DENIED';end if;
  insert into public.action_markers select x from unnest(p_order_ids) x;return jsonb_build_object('ok',true);
 end $$;`);
 }
 await db.exec(await file('20261113005650_staff_own_order_action_scope.sql'));
 assert.equal((await db.query("select has_function_privilege('authenticated','public._staff_order_target_visible(uuid)','execute') allowed")).rows[0].allowed,false,'internal guard cannot be called directly');
 await db.exec('set role authenticated');
 if(actual) {
  const calls=[
   ['select public.close_sales_order_processing($1,$2)',[id(201),'test']],
   ['select public.reopen_sales_order_processing($1)',[id(201)]],
   ['select public.create_child_sale_from_order($1)',[id(201)]],
   ['select public.mark_order_processed($1,$2)',[id(201),null]],
   ['select public.save_sales_order_atomic($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[id(201),null,id(10),null,'[]',0,null,null,null,null,null]],
   ['select public.attach_invoice_shipment_atomic($1,$2,$3,$4,$5,$6,$7)',[id(201),0,null,null,null,null,null]],
   ['select public.update_draft_invoice_atomic($1,$2)',[id(201),'{}']],
   ['select public.cancel_draft_invoice_atomic($1,$2)',[id(201),'test']],
   ['select public.duplicate_invoice_to_order_atomic($1,$2)',[id(201),id(10)]],
   ['select public.close_sales_orders_processing($1,$2,$3)',[[id(200),id(201)],'test',false]],
  ];
  for(const [query,args] of calls) await assert.rejects(db.query(query,args),/STAFF_OWN_ORDER_ACTION_DENIED/,'captured action must reject invisible order before other work');
  console.log('PASS captured order action definitions reject out-of-scope orders');
 } else {
 for(const name of [...names,...extra.map(x=>x[0])]) {
  await assert.rejects(db.query(`select public.${name}($1)`,[id(201)]),/STAFF_OWN_ORDER_ACTION_DENIED/,`${name} rejects invisible order`);
  await assert.rejects(db.query(`select public.${name}($1)`,[id(202)]),/ORIGINAL_ORDER_NOT_FOUND/,`${name} retains original tenant validation`);
  await db.query(`select public.${name}($1)`,[id(200)]);
 }
 await db.exec('reset role');
 const before=(await db.query('select count(*)::int n from action_markers')).rows[0].n;
 await db.exec('set role authenticated');
 await assert.rejects(db.query('select public.close_sales_orders_processing($1)',[[id(200),id(201)]]),/STAFF_OWN_ORDER_ACTION_DENIED/,'mixed batch fails atomically');
 await db.exec('reset role');
 assert.equal((await db.query('select count(*)::int n from action_markers')).rows[0].n,before,'denied batch writes no marker');
 await db.exec(`insert into role_permissions values('${id(20)}','invoices.view'); set role authenticated;`);
 for(const name of [...names,...extra.map(x=>x[0])]) await db.query(`select public.${name}($1)`,[id(201)]);
 await db.query('select public.close_sales_orders_processing($1)',[[id(200),id(201)]]);
 await db.exec(`reset role; insert into staff_branch_permission_catalog values('invoices.view',1);
  insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
  values('${id(1)}','${id(101)}','${id(11)}','invoices.view','revoke','${id(100)}'); set role authenticated;`);
 await assert.rejects(db.query('select public.close_sales_order_processing($1)',[id(201)]),/STAFF_OWN_ORDER_ACTION_DENIED/,'branch revoke disables full-access fast path');
 await db.exec(`reset role; insert into user_permission_overrides(tenant_id,user_id,permission_code,override_type,created_by)
  values('${id(1)}','${id(101)}','invoices.view','revoke','${id(100)}'); set role authenticated;`);
 await assert.rejects(db.query('select public.close_sales_order_processing($1)',[id(201)]),/STAFF_OWN_ORDER_ACTION_DENIED/,'explicit global revoke wins');
 await db.exec(`reset role; insert into role_permissions values('${id(20)}','pos_retail.checkout'); set role authenticated;`);
 await db.query('select public.create_child_sale_from_order($1)',[id(201)]);
 await db.exec(`reset role; delete from role_permissions where permission_code in ('orders.create','pos_retail.checkout'); set role authenticated;`);
 await assert.rejects(db.query('select public.close_sales_order_processing($1)',[id(201)]),/ORIGINAL_PERMISSION_DENIED/,'unauthorized caller reaches original permission check without locking an order');
 console.log('PASS own-order action guards, batch atomicity and independent checkout');
 }
} catch(e) {console.error(e.message,e.where??'');process.exitCode=1;} finally {await db.close();}
