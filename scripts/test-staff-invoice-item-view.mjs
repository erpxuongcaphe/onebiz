// Synthetic data in an isolated PostgreSQL-compatible fixture; never production.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { initializeStaffAccessFixture } from './staff-access-tests/fixture.mjs';
import { functionFromMigration } from './staff-access-tests/inventory.mjs';
const {PGlite}=await import(process.env.ONEBIZ_PGLITE_MODULE ? pathToFileURL(process.env.ONEBIZ_PGLITE_MODULE).href : '@electric-sql/pglite');
const db=new PGlite();
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const sql=name=>readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8');
try {
 await initializeStaffAccessFixture(db,id);
 await db.exec(await sql('20261111052704_staff_branch_access.sql'));
 await db.exec(await functionFromMigration('20261111070229_staff_branch_checkout_permissions.sql','_staff_permission_at_scope'));
 await db.exec(`
  create table invoices(id uuid,tenant_id uuid,branch_id uuid,source text);
  create table invoice_items(id uuid,invoice_id uuid,quantity numeric,unit_cost numeric);
  insert into invoices values ('${id(50)}','${id(1)}','${id(10)}','fnb'),('${id(51)}','${id(1)}','${id(11)}','fnb'),('${id(52)}','${id(2)}','${id(12)}','fnb');
  insert into invoice_items values ('${id(60)}','${id(50)}',2,100),('${id(61)}','${id(51)}',3,200),('${id(62)}','${id(52)}',4,300);
  alter function public.get_user_tenant_id() security definer;
  alter function public.user_has_branch_access(uuid,uuid) security definer;
  alter function public.user_has_permission(uuid,text) security definer;
  create function public._can_read_branch_inventory_00476(u uuid,t uuid,b uuid) returns boolean language sql stable security definer as $$select t=get_user_tenant_id() and user_has_branch_access(u,b)$$;
  create view public.invoice_items_scoped with (security_barrier=true) as
   select t.id,t.invoice_id,t.quantity,case when user_has_permission(auth.uid(),'products.view_cost') then t.unit_cost else null end unit_cost
    from invoice_items t where exists (select 1 from invoices o where o.id=t.invoice_id and (exists(select 1 where _can_read_branch_inventory_00476(auth.uid(),o.tenant_id,o.branch_id))));
  alter table invoices enable row level security; alter table invoice_items enable row level security;
  create policy invoice_legacy on invoices for select to authenticated using (tenant_id=get_user_tenant_id() and user_has_branch_access(auth.uid(),branch_id));
  create policy items_legacy on invoice_items for select to authenticated using (exists(select 1 from invoices i where i.id=invoice_id));
  grant usage on schema public,auth to authenticated;
  grant select on invoices to authenticated; grant select(id,invoice_id,quantity) on invoice_items to authenticated;
  grant select on invoice_items_scoped to authenticated;
  insert into user_branches values ('${id(101)}','${id(11)}',null);
  insert into role_permissions values ('${id(20)}','inventory.view');
  insert into staff_branch_permission_catalog values ('inventory.view',1);
  insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
   values ('${id(1)}','${id(101)}','${id(11)}','inventory.view','revoke','${id(100)}');
  select set_config('request.jwt.claim.sub','${id(101)}',false);
 `);
 await db.exec(await sql('20261112172924_staff_invoice_item_view_scope.sql'));
 assert.equal((await db.query("select reloptions @> array['security_barrier=true'] kept from pg_class where oid='public.invoice_items_scoped'::regclass")).rows[0].kept,true,'security barrier is preserved');
 assert.equal((await db.query("select has_table_privilege('authenticated','public.invoice_items_scoped','select') allowed")).rows[0].allowed,true,'view grant is preserved');
 await db.exec('set role authenticated');
 const plan=(await db.query('explain (verbose) select id from invoice_items_scoped')).rows.map(x=>Object.values(x)[0]).join('\n');
 assert.match(plan,/InitPlan/,'scope is computed as a statement-level plan');
 assert.match(plan,/_staff_invoice_item_allowed_scopes/,'branch/source permissions are batched');
 const rawPlan=(await db.query('explain (verbose) select id from invoice_items')).rows.map(x=>Object.values(x)[0]).join('\n');
 assert.match(rawPlan,/_staff_invoice_item_allowed_scopes/,'raw-line policy also batches permission scopes');
 const ids=async table=>(await db.query(`select id from ${table} order by id`)).rows.map(x=>x.id);
 assert.deepEqual(await ids('invoice_items'),[id(60)],'raw granted columns obey branch denial');
 assert.deepEqual(await ids('invoice_items_scoped'),[id(60)],'owner-backed view obeys branch denial');
 await db.exec(`reset role; insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
   values ('${id(1)}','${id(101)}','${id(10)}','inventory.view','grant','${id(100)}');
  insert into user_permission_overrides(tenant_id,user_id,permission_code,override_type,created_by)
   values ('${id(1)}','${id(101)}','inventory.view','revoke','${id(100)}'); set role authenticated;`);
 assert.deepEqual(await ids('invoice_items_scoped'),[],'global revoke defeats a local inventory grant');
 await db.exec(`reset role; insert into role_permissions values ('${id(20)}','pos_fnb.checkout'); set role authenticated;`);
 assert.deepEqual(await ids('invoice_items'),[id(60),id(61)],'checkout retains assigned F&B invoice lines');
 assert.deepEqual(await ids('invoice_items_scoped'),[id(60),id(61)],'checkout remains usable through the view');
 await db.exec(`reset role; delete from user_branches where user_id='${id(101)}' and branch_id='${id(11)}'; set role authenticated;`);
 assert.deepEqual(await ids('invoice_items_scoped'),[id(60)],'checkout does not grant unassigned branches');
 await db.exec(`reset role; delete from user_branch_permission_overrides where permission_code='inventory.view';
  delete from user_permission_overrides where permission_code='inventory.view';
  delete from role_permissions where permission_code in ('inventory.view','pos_fnb.checkout'); set role authenticated;`);
 assert.deepEqual(await ids('invoice_items_scoped'),[id(60)],'legacy account keeps existing branch-bound reads');
 assert.deepEqual((await db.query('select public._staff_invoice_item_allowed_scopes() scopes')).rows[0].scopes,[`${id(10)}:fnb`],'direct helper does not disclose an unassigned branch');
 await db.exec(`reset role; insert into user_permission_overrides(tenant_id,user_id,permission_code,override_type,created_by)
  values ('${id(1)}','${id(101)}','inventory.view','revoke','${id(100)}'); set role authenticated;`);
 assert.deepEqual(await ids('invoice_items_scoped'),[],'account-wide revoke does not use the legacy fast path');
 await db.exec(`reset role; insert into role_permissions values ('${id(20)}','pos_fnb.checkout'); set role authenticated;`);
 assert.deepEqual(await ids('invoice_items_scoped'),[id(60)],'independent checkout survives global inventory revoke');
 await db.exec(`reset role; insert into user_branches values ('${id(101)}','${id(11)}',null);
  delete from user_permission_overrides where permission_code='inventory.view';
  delete from role_permissions where permission_code='pos_fnb.checkout';
  insert into invoices values ('${id(53)}','${id(1)}','${id(10)}','pos'),('${id(54)}','${id(1)}','${id(11)}','order');
  insert into invoice_items values ('${id(63)}','${id(53)}',1,400),('${id(64)}','${id(54)}',1,500);
  insert into staff_branch_permission_catalog values ('orders.view',1);
  insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
   values ('${id(1)}','${id(101)}','${id(11)}','orders.view','grant','${id(100)}'); set role authenticated;`);
 assert.deepEqual(await ids('invoice_items_scoped'),[id(64)],'order permission does not expose unrelated POS or F&B lines');
 await db.exec(`reset role; insert into role_permissions values ('${id(20)}','pos_retail.checkout'); set role authenticated;`);
 assert.deepEqual(await ids('invoice_items_scoped'),[id(63),id(64)],'retail checkout retains assigned POS/order lines');
 await db.exec(`reset role; update profiles set is_active=false where id='${id(101)}'; set role authenticated;`);
 assert.deepEqual(await ids('invoice_items_scoped'),[],'inactive account cannot use owner-backed view');
 console.log('PASS invoice line raw/view scope, independent checkout and inactive account');
} catch(e) {console.error(e.message,e.where??'');process.exitCode=1;} finally {await db.close();}
