// Only the disposable PostgreSQL CI service is permitted.
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { initializeStaffAccessFixture } from './fixture.mjs';
import { functionFromMigration } from './inventory.mjs';
if (process.env.STAFF_EPHEMERAL_DB !== 'onebiz_staff_access_test') throw new Error('Dedicated disposable database required');
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const sql=[];
await initializeStaffAccessFixture({exec:async text=>sql.push(text)},id);
sql.push(await readFile('supabase/migrations/20261111052704_staff_branch_access.sql','utf8'));
sql.push(await functionFromMigration('20261111070229_staff_branch_checkout_permissions.sql','_staff_permission_at_scope'));
sql.push(await functionFromMigration('20261111094222_staff_branch_report_permissions.sql','_staff_report_permission'));
sql.push(`create function public._can_read_branch_inventory_00476(p_user uuid,p_tenant uuid,p_branch uuid)
 returns boolean language sql as $$select public.user_has_branch_access(p_user,p_branch) or public.user_has_permission(p_user,'reports.view_all_branches')$$;`);
const guard=await functionFromMigration('00513_inventory_operational_read_projections.sql','assert_report_access');
sql.push(guard.replace('public.user_has_permission(v_actor,p_permission_code)','public._staff_report_permission(v_actor,p_permission_code,p_branch_id)'));
sql.push(`create table cash_transactions(tenant_id uuid,branch_id uuid,transaction_date date,type text,category text,amount numeric,status text);
 insert into cash_transactions values
 ('${id(1)}','${id(10)}','2026-11-01','receipt','Bán hàng',100,'completed'),
 ('${id(1)}','${id(10)}','2026-11-02','receipt','Bán hàng',50,'completed'),
 ('${id(1)}','${id(10)}','2026-11-02','payment',null,20,'completed'),
 ('${id(1)}','${id(11)}','2026-11-02','receipt','Bán hàng',200,'completed'),
 ('${id(2)}','${id(12)}','2026-11-02','receipt','Bán hàng',9999,'completed');
 insert into role_permissions values('${id(20)}','reports.analytics');
 select set_config('request.jwt.claim.sub','${id(101)}',false);`);
sql.push(await readFile('supabase/migrations/20261113074601_staff_cash_flow_summary_projection.sql','utf8'));
sql.push(`do $$declare r record;begin
 select * into r from get_cash_flow_category_summary('2026-11-01','2026-11-30','${id(10)}') where type='receipt';
 if r.amount is distinct from 150 or r.transaction_date is distinct from '2026-11-01'::date then raise exception 'SUMMARY_TOTAL_INCORRECT'; end if;
 begin perform * from get_cash_flow_category_summary('2026-11-01','2026-11-30','${id(11)}'); raise exception 'BRANCH_LEAK';
 exception when insufficient_privilege then null;end;
 begin perform * from get_cash_flow_category_summary('2026-11-01','2026-11-30','${id(12)}'); raise exception 'TENANT_LEAK';
 exception when insufficient_privilege then null;end;
 begin perform * from get_cash_flow_category_summary('2026-11-01','2026-11-30',null); raise exception 'ALL_BRANCH_LEAK';
 exception when insufficient_privilege then null;end;
 end$$;
 insert into staff_branch_permission_catalog values('reports.analytics',1);
 insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
 values('${id(1)}','${id(101)}','${id(10)}','reports.analytics','revoke','${id(100)}');
 do $$begin
 begin perform * from get_cash_flow_category_summary('2026-11-01','2026-11-30','${id(10)}'); raise exception 'OVERRIDE_LEAK';
 exception when insufficient_privilege then null;end;
 end$$;
 select set_config('request.jwt.claim.sub','${id(100)}',false);
 do $$begin if (select sum(amount) from get_cash_flow_category_summary('2026-11-01','2026-11-30',null)) is distinct from 370
 then raise exception 'ALL_BRANCH_TOTAL_INCORRECT';end if;end$$;`);
if (process.env.ONEBIZ_PGLITE_REHEARSAL === '1') {
 const {PGlite}=await import('@electric-sql/pglite');
 const db=new PGlite();
 try { await db.exec(sql.join('\n')); } finally { await db.close(); }
 console.log('PASS disposable PGlite cash summary rehearsal');
 process.exit(0);
}
const child=spawn('psql',['-Xq','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55433','-U','staff_test','-d','onebiz_staff_access_test'],{
 env:{PATH:process.env.PATH,PGPASSWORD:'ephemeral-test-only',PGSSLMODE:'disable',PGCONNECT_TIMEOUT:'5'},stdio:['pipe','pipe','pipe']});
let err='';child.stderr.on('data',x=>err+=x);
const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(err)));});
child.stdin.end(sql.join('\n'));await done;
console.log('PASS PostgreSQL cash summary totals, branch, tenant, overrides and all-branch scope');
