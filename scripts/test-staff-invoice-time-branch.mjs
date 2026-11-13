import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {initializeStaffAccessFixture} from './staff-access-tests/fixture.mjs';
import {functionFromMigration} from './staff-access-tests/inventory.mjs';
const {PGlite}=createRequire(process.argv[2]||import.meta.url)('@electric-sql/pglite');
const db=new PGlite();const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
try {
 await initializeStaffAccessFixture(db,id);
 await db.exec(await readFile('supabase/migrations/20261111052704_staff_branch_access.sql','utf8'));
 await db.exec(await functionFromMigration('20261111070229_staff_branch_checkout_permissions.sql','_staff_permission_at_scope'));
 await db.exec(`
  create table invoices(id uuid,tenant_id uuid,branch_id uuid,deleted_at timestamptz);
  insert into invoices values ('${id(50)}','${id(1)}','${id(10)}',null),('${id(51)}','${id(1)}','${id(11)}',null);
  insert into user_branches(user_id,branch_id) values ('${id(101)}','${id(11)}');
  insert into role_permissions values ('${id(20)}','invoices.adjust_issued_at');
  create function public.complete_draft_atomic_v6(p_invoice_id uuid,p_issued_at timestamptz) returns boolean language plpgsql as $$
   declare v_actor uuid:=auth.uid();v_tenant uuid:=public.get_user_tenant_id();begin
    if p_issued_at is not null and not public.user_has_permission(v_actor, 'invoices.adjust_issued_at') then raise exception 'ISSUED_AT_KHONG_CO_QUYEN';end if;return true;end$$;
  create function public.pos_complete_checkout_atomic_v4(p_branch_id uuid,p_issued_at timestamptz) returns boolean language plpgsql as $$
   declare v_actor uuid:=auth.uid();begin
    if p_issued_at is not null and not public.user_has_permission(v_actor, 'invoices.adjust_issued_at') then raise exception 'ISSUED_AT_KHONG_CO_QUYEN';end if;return true;end$$;
  select set_config('request.jwt.claim.sub','${id(101)}',false);
 `);
 await db.exec(await readFile('supabase/migrations/20261113145809_staff_invoice_issue_time_branch_scope.sql','utf8'));
 await db.exec(`insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values ('${id(1)}','${id(101)}','${id(10)}','invoices.adjust_issued_at','revoke','${id(100)}')`);
 const pos=(branch,time='now()')=>db.query(`select public.pos_complete_checkout_atomic_v4('${branch}',${time})`);
 const draft=(invoice,time='now()')=>db.query(`select public.complete_draft_atomic_v6('${invoice}',${time})`);
 await assert.rejects(pos(id(10)),/ISSUED_AT_KHONG_CO_QUYEN/);await assert.rejects(draft(id(50)),/ISSUED_AT_KHONG_CO_QUYEN/);
 await pos(id(11));await draft(id(51));await pos(id(10),'null');await draft(id(50),'null');
 await db.exec(`delete from role_permissions where permission_code='invoices.adjust_issued_at';
  insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values ('${id(1)}','${id(101)}','${id(11)}','invoices.adjust_issued_at','grant','${id(100)}')`);
 await pos(id(11));await draft(id(51));
 await db.exec(`insert into user_permission_overrides(tenant_id,user_id,permission_code,override_type,created_by) values ('${id(1)}','${id(101)}','invoices.adjust_issued_at','revoke','${id(100)}')`);
 await assert.rejects(pos(id(11)),/ISSUED_AT_KHONG_CO_QUYEN/);await assert.rejects(draft(id(51)),/ISSUED_AT_KHONG_CO_QUYEN/);
 console.log('PASS invoice time: branch deny/grant, global revoke and unchanged ordinary checkout gate');
} finally {await db.close();}
