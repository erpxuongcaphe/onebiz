import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { initializeStaffAccessFixture } from './staff-access-tests/fixture.mjs';
import { functionFromMigration } from './staff-access-tests/inventory.mjs';

const {PGlite}=createRequire(process.argv[2]||import.meta.url)('@electric-sql/pglite');
const db=new PGlite();
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
try {
 await initializeStaffAccessFixture(db,id);
 await db.exec(await readFile('supabase/migrations/20261111052704_staff_branch_access.sql','utf8'));
 for(const [file,name] of [
  ['20261111070229_staff_branch_checkout_permissions.sql','_staff_permission_at_scope'],
  ['20261111095224_staff_branch_kitchen_permissions.sql','_staff_permission_any_branch'],
 ]) await db.exec(await functionFromMigration(file,name));
 await db.exec(`
  create table public.shifts(id uuid primary key,tenant_id uuid,branch_id uuid,cashier_id uuid,status text,
   opened_at timestamptz default now(),closed_at timestamptz,reconciled_at timestamptz,reconciled_by uuid,
   auto_marked_pending_at timestamptz,starting_cash numeric default 0,expected_cash numeric,actual_cash numeric,
   cash_difference numeric,total_sales numeric default 0,total_orders integer default 0,reconcile_reason text,note text,
   close_kind text,expected_transfer numeric,actual_transfer numeric,transfer_difference numeric,sales_by_method jsonb);
  create function public.can_read_branch_document_00567(uuid,uuid) returns boolean language sql stable as $$
   select $1=public.get_user_tenant_id() and public.user_has_branch_access(auth.uid(),$2)$$;
  create function public._finalize_shift_atomic_00298(uuid,numeric,text,text) returns jsonb language plpgsql as $$begin
   update public.shifts set status='closed',actual_cash=$2,closed_at=now() where id=$1;return '{}'::jsonb;end$$;
  insert into user_branches(user_id,branch_id) values ('${id(101)}','${id(11)}');
  insert into profiles(id,tenant_id,role,full_name,branch_id) values ('${id(103)}','${id(1)}','staff','Cashier','${id(10)}');
  insert into role_permissions values ('${id(20)}','pos_fnb.checkout'),('${id(20)}','shifts.reconcile_own_branch');
  insert into shifts(id,tenant_id,branch_id,cashier_id,status,actual_cash,closed_at) values
   ('${id(200)}','${id(1)}','${id(10)}','${id(103)}','pending_reconcile',null,null),
   ('${id(201)}','${id(1)}','${id(11)}','${id(103)}','pending_reconcile',null,null),
   ('${id(202)}','${id(1)}','${id(10)}','${id(103)}','closed',100,now()),
   ('${id(203)}','${id(1)}','${id(11)}','${id(103)}','closed',200,now()),
   ('${id(204)}','${id(1)}','${id(10)}','${id(101)}','open',null,null);
 `);
 await db.exec(await readFile('scripts/staff-access-tests/fixtures/shift-readers-before-branch.sql','utf8'));
 await db.exec(await readFile('supabase/migrations/20261113134553_staff_reconcile_branch_scope.sql','utf8'));
 await db.exec(`select set_config('request.jwt.claim.sub','${id(101)}',false);
  insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
   values ('${id(1)}','${id(101)}','${id(10)}','shifts.reconcile_own_branch','revoke','${id(100)}'),
    ('${id(1)}','${id(101)}','${id(11)}','shifts.reconcile_own_branch','grant','${id(100)}');`);
 const q=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
 const pending=await q("select get_shift_records_scoped('pending',null)");
 assert.equal(pending.total_count,1);assert.equal(pending.rows[0].id,id(201));
 const closed=await q('select get_reconciled_shifts_scoped()');
 assert.equal(closed.total_count,1);assert.equal(closed.rows[0].id,id(203));
 await assert.rejects(q('select reconcile_pending_shift($1,0,$2,null)',[id(200),'Test reason']),/SHIFT_RECONCILE_DENIED/);
 await q('select reconcile_pending_shift($1,0,$2,null)',[id(201),'Test reason']);
 await db.exec(`delete from role_permissions where role_id='${id(20)}' and permission_code='shifts.reconcile_own_branch';`);
 assert.equal((await q('select get_reconciled_shifts_scoped()')).total_count,2);
 await db.exec(`insert into user_permission_overrides(tenant_id,user_id,permission_code,override_type,created_by)
  values ('${id(1)}','${id(101)}','shifts.reconcile_own_branch','revoke','${id(100)}')`);
 await assert.rejects(q("select get_shift_records_scoped('pending',null)"),/SHIFT_RECORDS_DENIED/);
 await q('select close_shift_atomic($1,0,null)',[id(204)]);
 await db.exec(`insert into role_permissions values ('${id(20)}','shifts.reconcile_any')`);
 await q('select reconcile_pending_shift($1,0,$2,null)',[id(200),'Company manager']);
 console.log('PASS shift scope: branch grants, global denial, own closing and independent company reconciliation');
} finally { await db.close(); }
