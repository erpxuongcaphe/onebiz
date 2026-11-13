// Synthetic data only. Exercise the summary projection and its branch guards.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { initializeStaffAccessFixture } from './staff-access-tests/fixture.mjs';
import { functionFromMigration } from './staff-access-tests/inventory.mjs';

const db = new PGlite();
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
try {
 await initializeStaffAccessFixture(db,id);
 await db.exec(await readFile('supabase/migrations/20261111052704_staff_branch_access.sql','utf8'));
 await db.exec(await functionFromMigration('20261111070229_staff_branch_checkout_permissions.sql','_staff_permission_at_scope'));
 await db.exec(await functionFromMigration('20261111094222_staff_branch_report_permissions.sql','_staff_report_permission'));
 await db.exec(`create function public._can_read_branch_inventory_00476(p_user uuid,p_tenant uuid,p_branch uuid)
 returns boolean language sql as $$select public.user_has_branch_access(p_user,p_branch) or public.user_has_permission(p_user,'reports.view_all_branches')$$;`);
 let guard=await functionFromMigration('00513_inventory_operational_read_projections.sql','assert_report_access');
 guard=guard.replace('public.user_has_permission(v_actor,p_permission_code)','public._staff_report_permission(v_actor,p_permission_code,p_branch_id)');
 await db.exec(guard);
 await db.exec(`create table cash_transactions(tenant_id uuid,branch_id uuid,transaction_date date,type text,category text,amount numeric,status text);
 insert into cash_transactions values
 ('${id(1)}','${id(10)}','2026-11-01','receipt','Bán hàng',100,'completed'),
 ('${id(1)}','${id(10)}','2026-11-02','receipt','Bán hàng',50,'completed'),
 ('${id(1)}','${id(10)}','2026-11-02','payment',null,20,'completed'),
 ('${id(1)}','${id(10)}','2026-11-03','payment','Bỏ qua',999,'draft'),
 ('${id(1)}','${id(11)}','2026-11-02','receipt','Bán hàng',200,'completed'),
 ('${id(2)}','${id(12)}','2026-11-02','receipt','Bán hàng',9999,'completed');
 insert into role_permissions values('${id(20)}','reports.analytics');
 select set_config('request.jwt.claim.sub','${id(101)}',false);`);
 await db.exec(await readFile('supabase/migrations/20261113074601_staff_cash_flow_summary_projection.sql','utf8'));
 let rows=(await db.query(`select transaction_date::text,type,category,amount::text from get_cash_flow_category_summary('2026-11-01','2026-11-30','${id(10)}') order by type`)).rows;
 assert.deepEqual(rows,[{transaction_date:'2026-11-01',type:'payment',category:'Khác',amount:'20'},
  {transaction_date:'2026-11-01',type:'receipt',category:'Bán hàng',amount:'150'}]);
 await assert.rejects(db.query(`select * from get_cash_flow_category_summary('2026-11-01','2026-11-30','${id(11)}')`),/REPORT_BRANCH_DENIED/);
 await assert.rejects(db.query(`select * from get_cash_flow_category_summary('2026-11-01','2026-11-30','${id(12)}')`),/REPORT_BRANCH_DENIED/);
 await assert.rejects(db.query(`select * from get_cash_flow_category_summary('2026-11-01','2026-11-30',null)`),/REPORT_ALL_BRANCHES_DENIED/);
 await assert.rejects(db.query(`select * from get_cash_flow_category_summary('2026-11-30','2026-11-01','${id(10)}')`),/REPORT_DATE_RANGE_INVALID/);
 await db.exec(`insert into role_permissions values('${id(20)}','reports.dashboard');`);
 rows=(await db.query(`select type,amount::text from get_cash_flow_alert_totals('2026-11-01','2026-11-30','${id(10)}') order by type`)).rows;
 assert.deepEqual(rows,[{type:'payment',amount:'20'},{type:'receipt',amount:'150'}]);
 await assert.rejects(db.query(`select * from get_cash_flow_alert_totals('2026-11-01','2026-11-30','${id(12)}')`),/REPORT_BRANCH_DENIED/);
 await db.exec(`insert into staff_branch_permission_catalog values('reports.dashboard',1);
 insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
 values('${id(1)}','${id(101)}','${id(10)}','reports.dashboard','revoke','${id(100)}');`);
 await assert.rejects(db.query(`select * from get_cash_flow_alert_totals('2026-11-01','2026-11-30','${id(10)}')`),/REPORT_PERMISSION_DENIED/);
 await db.exec(`insert into staff_branch_permission_catalog values('reports.analytics',1);
 insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
 values('${id(1)}','${id(101)}','${id(10)}','reports.analytics','revoke','${id(100)}');`);
 await assert.rejects(db.query(`select * from get_cash_flow_category_summary('2026-11-01','2026-11-30','${id(10)}')`),/REPORT_PERMISSION_DENIED/);
 await db.exec(`insert into role_permissions values('${id(20)}','reports.view_all_branches');`);
 await assert.rejects(db.query(`select * from get_cash_flow_category_summary('2026-11-01','2026-11-30',null)`),/REPORT_PERMISSION_DENIED/);
 await db.exec(`update profiles set is_active=false where id='${id(101)}'`);
 await assert.rejects(db.query(`select * from get_cash_flow_category_summary('2026-11-01','2026-11-30','${id(10)}')`),/REPORT_PROFILE_INACTIVE/);
 await db.exec('grant usage on schema public to anon; set role anon');
 await assert.rejects(db.query(`select * from get_cash_flow_category_summary('2026-11-01','2026-11-30','${id(10)}')`),/permission denied/);
 await db.exec('reset role');
 await db.exec(`select set_config('request.jwt.claim.sub','${id(100)}',false)`);
 rows=(await db.query(`select type,sum(amount)::text amount from get_cash_flow_category_summary('2026-11-01','2026-11-30',null) group by type order by type`)).rows;
 assert.deepEqual(rows,[{type:'payment',amount:'20'},{type:'receipt',amount:'350'}]);
 console.log('PASS cash summary: aggregation, branch, tenant, permission, all-branch and invalid-date guards');
} finally { await db.close(); }
