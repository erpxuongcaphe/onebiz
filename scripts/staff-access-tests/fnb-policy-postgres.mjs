// Dedicated disposable CI PostgreSQL only; never points at a user database.
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { initializeStaffAccessFixture } from './fixture.mjs';
import { functionFromMigration } from './inventory.mjs';

if (process.env.STAFF_EPHEMERAL_DB !== 'onebiz_staff_access_test') throw new Error('Dedicated disposable database required');
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const statements=[];
await initializeStaffAccessFixture({exec:async s=>statements.push(s)},id);
for(const name of ['20261111052704_staff_branch_access.sql'])
 statements.push(await readFile(new URL(`../../supabase/migrations/${name}`,import.meta.url),'utf8'));
statements.push(await functionFromMigration('20261111070229_staff_branch_checkout_permissions.sql','_staff_permission_at_scope'));
statements.push(`
 create table kitchen_order_items(id uuid primary key,kitchen_order_id uuid);
 insert into kitchen_order_items values ('${id(40)}','${id(30)}'),('${id(41)}','${id(31)}');
 alter table kitchen_orders enable row level security;
 alter table kitchen_order_items enable row level security;
 alter function public.get_user_tenant_id() security definer;
 create policy legacy_order on kitchen_orders for select to authenticated using (tenant_id=public.get_user_tenant_id());
 create policy legacy_items on kitchen_order_items for select to authenticated using (true);
 grant usage on schema public,auth to authenticated;
 grant select on kitchen_orders,kitchen_order_items to authenticated;
 delete from role_permissions where permission_code='pos_fnb.split_bill';
 insert into role_permissions values ('${id(20)}','pos_fnb.view_orders');
 select set_config('request.jwt.claim.sub','${id(101)}',false);
`);
for(const name of ['20261112065630_staff_branch_fnb_view_direct_reads.sql','20261112122122_staff_fnb_view_global_revoke_guard.sql','20261112165952_staff_fnb_legacy_branch_read_guard.sql'])
 statements.push(await readFile(new URL(`../../supabase/migrations/${name}`,import.meta.url),'utf8'));
statements.push(`
 set role authenticated;
 do $$begin
  if (select count(*) from kitchen_orders)<>1 or (select count(*) from kitchen_order_items)<>1 then raise exception 'unassigned branch was visible'; end if;
 end$$;
 reset role;
 insert into role_permissions values ('${id(20)}','reports.view_all_branches');
 set role authenticated;
 do $$begin if (select count(*) from kitchen_orders)<>2 then raise exception 'all-branch report scope was lost'; end if; end$$;
 reset role;
 delete from role_permissions where permission_code in ('reports.view_all_branches','pos_fnb.view_orders');
 insert into role_permissions values ('${id(20)}','pos_fnb.checkout');
 set role authenticated;
 do $$begin if (select count(*) from kitchen_orders)<>1 or (select count(*) from kitchen_order_items)<>1 then raise exception 'checkout lost assigned orders'; end if; end$$;
 reset role;
 delete from role_permissions where permission_code='pos_fnb.checkout';
 insert into staff_branch_permission_catalog values ('pos_fnb.view_orders',1);
 insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
  values('${id(1)}','${id(101)}','${id(10)}','pos_fnb.view_orders','grant','${id(100)}');
 insert into user_permission_overrides(tenant_id,user_id,permission_code,override_type,created_by)
  values('${id(1)}','${id(101)}','pos_fnb.view_orders','revoke','${id(100)}');
 set role authenticated;
 do $$begin if (select count(*) from kitchen_orders)<>0 then raise exception 'local grant bypassed global revoke'; end if; end$$;
 reset role;
 delete from user_permission_overrides where permission_code='pos_fnb.view_orders';
 delete from user_branch_permission_overrides where permission_code='pos_fnb.view_orders';
 insert into role_permissions values ('${id(20)}','pos_fnb.view_orders');
 update profiles set is_active=false where id='${id(101)}';
 set role authenticated;
 do $$begin if (select count(*) from kitchen_orders)<>0 then raise exception 'inactive account retained order access'; end if; end$$;
 reset role;
`);
if (process.env.ONEBIZ_PGLITE_MODULE) {
 const {PGlite}=await import(pathToFileURL(process.env.ONEBIZ_PGLITE_MODULE).href);
 const db=new PGlite();
 try { await db.exec(statements.join('\n')); } finally { await db.close(); }
 console.log('PASS local fixture rehearsal (PGlite)');
 process.exit(0);
}
const args=['-Xq','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55433','-U','staff_test','-d','onebiz_staff_access_test'];
const child=spawn('psql',args,{env:{PATH:process.env.PATH,PGPASSWORD:'ephemeral-test-only',PGSSLMODE:'disable',PGCONNECT_TIMEOUT:'5'},stdio:['pipe','pipe','pipe']});
let out='',err='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);
const completed=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(err)));});
child.stdin.end(statements.join('\n'));
await completed;
console.log('PASS real PostgreSQL: F&B assigned scope, company reporting, checkout, inactive account');
