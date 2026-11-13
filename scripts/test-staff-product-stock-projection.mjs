import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { initializeStaffAccessFixture } from './staff-access-tests/fixture.mjs';
import { functionFromMigration } from './staff-access-tests/inventory.mjs';
const {PGlite}=await import(process.env.ONEBIZ_PGLITE_MODULE?pathToFileURL(process.env.ONEBIZ_PGLITE_MODULE).href:'@electric-sql/pglite');
const db=new PGlite();const id=(n)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const file=(name)=>readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8');
try {
 await initializeStaffAccessFixture(db,id);await db.exec(await file('20261111052704_staff_branch_access.sql'));
 await db.exec(await functionFromMigration('20261111070229_staff_branch_checkout_permissions.sql','_staff_permission_at_scope'));
 await db.exec(`alter function public.get_user_tenant_id() security definer;
  alter function public.user_has_permission(uuid,text) security definer;
  alter function public.user_has_branch_access(uuid,uuid) security definer;
  create table products(id uuid,tenant_id uuid,name text);
  create table branch_stock(tenant_id uuid,branch_id uuid,product_id uuid,quantity numeric,variant_id uuid);
  alter table branch_stock enable row level security;
  create policy legacy_stock on branch_stock for select to authenticated using (tenant_id=public.get_user_tenant_id());
  grant select on branch_stock to authenticated;
  insert into products values('${id(60)}','${id(1)}','Coffee'),('${id(61)}','${id(2)}','Other');
  insert into branch_stock values('${id(1)}','${id(10)}','${id(60)}',10,null),('${id(1)}','${id(11)}','${id(60)}',20,null);
  insert into branches(id,tenant_id,name) values('${id(13)}','${id(1)}','Unassigned');
  insert into user_branches values('${id(101)}','${id(11)}',null);
  insert into role_permissions values('${id(20)}','inventory.view');
  insert into staff_branch_permission_catalog values('inventory.view',1);
  create function public._can_read_branch_inventory_00476(actor uuid,tenant uuid,branch uuid) returns boolean language sql stable security definer set search_path=public as $$
   select tenant=get_user_tenant_id() and (user_has_branch_access(actor,branch) or user_has_permission(actor,'reports.view_all_branches')) $$;
  create view products_scoped with (security_barrier=true) as
   select id,tenant_id,coalesce((select sum(bs.quantity) as sum from branch_stock bs
     where bs.tenant_id=p.tenant_id and bs.product_id=p.id and _can_read_branch_inventory_00476(auth.uid(),bs.tenant_id,bs.branch_id)
     and (user_has_permission(auth.uid(),'reports.view_all_branches') or user_has_permission(auth.uid(),'inventory.view_assigned_totals')
       or bs.branch_id=(select profile.branch_id from profiles profile where profile.id=auth.uid()))),0::numeric) as stock,name
   from products p where tenant_id=get_user_tenant_id();
  grant usage on schema public,auth to authenticated;grant select on products_scoped to authenticated;
  select set_config('request.jwt.claim.sub','${id(101)}',false);`);
 const viewMetadata=async()=>(await db.query("select relowner,relacl::text acl,reloptions from pg_class where oid='public.products_scoped'::regclass")).rows[0];
 const beforeViewMetadata=await viewMetadata();
 await db.exec(await file('20261112104703_staff_inventory_branch_stock_reads.sql'));
 await db.exec(await file('20261112110113_staff_product_stock_projection.sql'));
 assert.deepEqual(await viewMetadata(),beforeViewMetadata,'product view retains barrier, owner and grants');
 await db.exec(`create function public._staff_lot_has_no_view_exception() returns boolean language sql as $$select true$$;
  create function public._staff_inventory_row_visible(uuid) returns boolean language sql as $$select true$$;`);
 await db.exec(await file('20261112121837_staff_inventory_global_revoke_guard.sql'));
 await db.exec('set role authenticated');
 const stock=async()=>(await db.query('select stock from products_scoped')).rows[0].stock;
 const scope=async(branch,items=[60])=>(await db.query('select get_product_list_branch_stock($1,$2::uuid[]) data',[id(branch),items.map(id)])).rows[0].data;
 assert.equal(await stock(),'10','legacy primary-branch aggregate is unchanged');
 assert.deepEqual(await scope(10),{allowed:true,rows:[{product_id:id(60),quantity:10}]});
 assert.deepEqual(await scope(10,[99]),{allowed:true,rows:[]},'authorized missing balance is a confirmed zero');
 assert.deepEqual(await scope(13),{allowed:false,rows:[]},'legacy mode cannot expose an unassigned branch');
 await assert.rejects(scope(12),/PRODUCT_STOCK_BRANCH_DENIED/);
 await db.exec(`reset role; insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values
  ('${id(1)}','${id(101)}','${id(10)}','inventory.view','revoke','${id(100)}'); set role authenticated;`);
 assert.equal(await stock(),null,'no visible primary-branch stock is unknown, not zero');
 assert.deepEqual(await scope(10),{allowed:false,rows:[]});
 assert.deepEqual(await scope(11,[60,99]),{allowed:true,rows:[{product_id:id(60),quantity:20}]});
 await db.exec(`reset role; insert into role_permissions values('${id(20)}','inventory.dispose'); set role authenticated;`);
 assert.deepEqual(await scope(10),{allowed:true,rows:[{product_id:id(60),quantity:10}]},'independent disposal right keeps required branch balance readable');
 await db.exec(`reset role; delete from role_permissions where permission_code='inventory.dispose'; set role authenticated;`);
 await db.exec(`reset role; insert into role_permissions values('${id(20)}','pos_retail.checkout'); set role authenticated;`);
 assert.deepEqual(await scope(10),{allowed:true,rows:[{product_id:id(60),quantity:10}]},'independent retail checkout retains branch stock access');
 await db.exec(`reset role; delete from role_permissions where permission_code='pos_retail.checkout'; set role authenticated;`);
 await db.exec(`reset role; insert into role_permissions values('${id(20)}','inventory.check'); set role authenticated;`);
 assert.deepEqual(await scope(10),{allowed:true,rows:[{product_id:id(60),quantity:10}]},'independent stocktake right retains branch stock access');
 await db.exec(`reset role; delete from role_permissions where permission_code='inventory.check'; set role authenticated;`);
 await db.exec(`reset role; insert into role_permissions values('${id(20)}','reports.view_all_branches'); set role authenticated;`);
 assert.equal(await stock(),'20','sum excludes the explicitly denied branch');
 await db.exec(`reset role; delete from role_permissions where permission_code in ('inventory.view','reports.view_all_branches');
  update user_branch_permission_overrides set override_type='grant' where permission_code='inventory.view'; set role authenticated;`);
 assert.equal(await stock(),'10','local grant is visible without making other branches readable');
 await db.exec(`reset role; update profiles set is_active=false where id='${id(101)}'; set role authenticated;`);
 await assert.rejects(scope(10),/PRODUCT_STOCK_AUTH_REQUIRED/);
 await db.exec(`reset role; delete from user_branch_permission_overrides where user_id='${id(101)}'; update profiles set is_active=null where id='${id(101)}'; set role authenticated;`);
 assert.deepEqual(await scope(10),{allowed:false,rows:[]},'an ungranted view remains restricted even with a legacy null active flag');
 await db.exec(`reset role; update profiles set is_active=true where id='${id(101)}'; insert into role_permissions values('${id(20)}','inventory.view');
  insert into user_permission_overrides(tenant_id,user_id,permission_code,override_type,created_by) values('${id(1)}','${id(101)}','inventory.view','revoke','${id(100)}'); set role authenticated;`);
 assert.deepEqual(await scope(10),{allowed:false,rows:[]},'an explicit company-level revoke cannot fall through the legacy branch guard');
 assert.equal((await db.query('select count(*)::int n from branch_stock')).rows[0].n,0,'raw branch rows honor global revoke too');
 await db.exec(`reset role; insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
  values('${id(1)}','${id(101)}','${id(10)}','inventory.view','grant','${id(100)}'); set role authenticated;`);
 assert.deepEqual(await scope(10),{allowed:false,rows:[]},'a local grant does not override the explicit global deny');
 await db.exec(`reset role; insert into role_permissions values('${id(20)}','inventory.check'); set role authenticated;`);
 assert.deepEqual(await scope(10),{allowed:true,rows:[{product_id:id(60),quantity:10}]},'independent stocktake still has its required balance');
 assert.equal((await db.query('select count(*)::int n from branch_stock')).rows[0].n,2,'independent stocktake retains only assigned branch rows');
 await db.exec(`reset role; delete from role_permissions where permission_code in ('inventory.check','inventory.view');
  delete from user_permission_overrides where user_id='${id(101)}' and permission_code='inventory.view';
  delete from user_branch_permission_overrides where user_id='${id(101)}' and permission_code='inventory.view'; set role authenticated;`);
 assert.deepEqual(await scope(10),{allowed:false,rows:[]},'a staff member with no stock-view or operational permission cannot read balances');
 await db.exec(`reset role; insert into role_permissions values('${id(20)}','pos_retail.checkout'); set role authenticated;`);
 assert.deepEqual(await scope(10),{allowed:true,rows:[{product_id:id(60),quantity:10}]},'retail checkout keeps stock access without the inventory-view grant');
 console.log('PASS product stock view: legacy totals, scoped sums and unknown-versus-zero');
}catch(e){console.error(e.message,e.where??'');process.exitCode=1;}finally{await db.close();}
