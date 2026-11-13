import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {initializeStaffAccessFixture} from './staff-access-tests/fixture.mjs';
import {functionFromMigration} from './staff-access-tests/inventory.mjs';

const {PGlite}=createRequire(process.argv[2]||import.meta.url)('@electric-sql/pglite');
const db=new PGlite();
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
try {
 await initializeStaffAccessFixture(db,id);
 await db.exec(await readFile('supabase/migrations/20261111052704_staff_branch_access.sql','utf8'));
 await db.exec(await functionFromMigration('20261111070229_staff_branch_checkout_permissions.sql','_staff_permission_at_scope'));
 await db.exec(await functionFromMigration('20261111094222_staff_branch_report_permissions.sql','_staff_report_permission'));
 await db.exec(`
  insert into staff_branch_permission_catalog(permission_code,enforcement_version) values ('reports.dashboard',1),('pos_fnb.view_sales_summary',1);
  insert into user_branches(user_id,branch_id) values ('${id(101)}','${id(11)}');
  insert into role_permissions(role_id,permission_code) values ('${id(20)}','customers.view_debt'),('${id(20)}','reports.dashboard'),('${id(20)}','reports.view_all_branches'),('${id(20)}','pos_fnb.view_sales_summary');
  create function public.get_sales_day_invoice_receivable(p_branch_id uuid,p_day date) returns jsonb language plpgsql as $$
  declare actor uuid:=auth.uid(); tenant uuid; branch_kind text:='store'; result jsonb;
  begin
   select tenant_id into tenant from public.profiles where id=actor and is_active;
   if tenant is null or not public.user_has_permission(actor,'customers.view_debt') then raise exception 'denied' using errcode='42501';end if;
   if p_branch_id is null then
    if not public.user_has_permission(actor,'reports.dashboard') or not public.user_has_permission(actor,'pos_fnb.view_sales_summary') then raise exception 'denied' using errcode='42501';end if;
   else
    if not public.user_has_permission(actor,case when branch_kind='store' then 'pos_fnb.view_sales_summary' else 'reports.dashboard' end) then raise exception 'denied' using errcode='42501';end if;
   end if;
   select jsonb_build_object('ok',true) into result;return result;
  end $$;
  create function public.get_dashboard_internal_sales(p_day date) returns jsonb language plpgsql as $$
  declare actor uuid:=auth.uid();begin
   if not public.user_has_permission(actor, 'reports.dashboard') or not public.user_has_permission(actor, 'pos_fnb.view_sales_summary') then raise exception 'denied' using errcode='42501';end if;
   return '{}'::jsonb;
  end $$;
  select set_config('request.jwt.claim.sub','${id(101)}',false);
 `);
 await db.exec(await readFile('supabase/migrations/20261113143542_staff_dashboard_new_readers_branch_scope.sql','utf8'));
 const call=branch=>db.query(`select public.get_sales_day_invoice_receivable(${branch ? `'${branch}'`:'null'},current_date)`);
 await call(id(10));await call(null);await db.query('select public.get_dashboard_internal_sales(current_date)');
 await db.exec(`insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values ('${id(1)}','${id(101)}','${id(10)}','pos_fnb.view_sales_summary','revoke','${id(100)}')`);
 await assert.rejects(call(id(10)),/denied/i);await call(id(11));await assert.rejects(call(null),/denied/i);
 await db.exec(`delete from user_branch_permission_overrides;insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values ('${id(1)}','${id(101)}','${id(10)}','reports.dashboard','revoke','${id(100)}')`);
 await assert.rejects(call(id(10)),/DENIED/i);await assert.rejects(db.query('select public.get_dashboard_internal_sales(current_date)'),/denied/i);
 console.log('PASS new dashboard readers: branch and all-branch revocations');
} finally {await db.close();}
