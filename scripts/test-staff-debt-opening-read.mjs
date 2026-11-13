import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {initializeStaffAccessFixture} from './staff-access-tests/fixture.mjs';

const {PGlite}=createRequire(process.argv[2]||import.meta.url)('@electric-sql/pglite');
const db=new PGlite();
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
try {
 await initializeStaffAccessFixture(db,id);
 await db.exec(`
  alter function public.get_user_tenant_id() security definer;
  alter function public.user_has_branch_access(uuid,uuid) security definer;
  alter function public.user_has_permission(uuid,text) security definer;
  create table public.debt_opening_balances(tenant_id uuid,branch_id uuid,party_type text,amount numeric);
  alter table public.debt_opening_balances enable row level security;
  create policy debt_opening_balances_select on public.debt_opening_balances for select to authenticated
   using (tenant_id=public.get_user_tenant_id() and (branch_id is null or public.user_has_branch_access(auth.uid(),branch_id)));
  create policy transaction_branch_read_00567 on public.debt_opening_balances as restrictive for select to authenticated
   using (tenant_id=public.get_user_tenant_id() and (branch_id is null or public.user_has_branch_access(auth.uid(),branch_id)));
  grant usage on schema public,auth to authenticated;grant execute on function auth.uid() to authenticated;
  grant select on public.debt_opening_balances to authenticated;
  insert into public.debt_opening_balances values
   ('${id(1)}','${id(10)}','customer',100),('${id(1)}','${id(10)}','supplier',200),
   ('${id(1)}','${id(11)}','customer',300),('${id(2)}','${id(12)}','customer',400);
  select set_config('request.jwt.claim.sub','${id(101)}',false);
 `);
 await db.exec(await readFile('supabase/migrations/20261113141904_staff_debt_opening_read_scope.sql','utf8'));
 const count=async()=>Number((await db.query('select count(*) as n from public.debt_opening_balances')).rows[0].n);
 await db.exec('set role authenticated');assert.equal(await count(),0);await db.exec('reset role');
 await db.exec(`insert into role_permissions values ('${id(20)}','customers.view_debt')`);
 await db.exec('set role authenticated');assert.equal(await count(),1);await db.exec('reset role');
 await db.exec(`insert into role_permissions values ('${id(20)}','suppliers.import')`);
 await db.exec('set role authenticated');assert.equal(await count(),2);await db.exec('reset role');
 await db.exec(`insert into user_permission_overrides(tenant_id,user_id,permission_code,override_type,created_by)
  values ('${id(1)}','${id(101)}','customers.view_debt','revoke','${id(100)}')`);
 await db.exec('set role authenticated');assert.equal(await count(),1);await db.exec('reset role');
 await db.exec(`insert into role_permissions values ('${id(20)}','customers.import')`);
 await db.exec('set role authenticated');assert.equal(await count(),2);await db.exec('reset role');
 console.log('PASS debt opening: permission, branch, tenant, revoke and independent import access');
} finally {await db.close();}
