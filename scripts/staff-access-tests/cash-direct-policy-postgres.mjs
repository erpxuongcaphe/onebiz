// Synthetic data only. The target database must be a disposable CI instance.
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { initializeStaffAccessFixture } from './fixture.mjs';
import { functionFromMigration } from './inventory.mjs';

if (process.env.STAFF_EPHEMERAL_DB !== 'onebiz_staff_access_test') throw new Error('Dedicated disposable database required');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const statements = [];
await initializeStaffAccessFixture({exec:async sql=>statements.push(sql)},id);
const migration = async name => statements.push(await readFile(new URL(`../../supabase/migrations/${name}`,import.meta.url),'utf8'));
await migration('20261111052704_staff_branch_access.sql');
statements.push(await functionFromMigration('20261111070229_staff_branch_checkout_permissions.sql','_staff_permission_at_scope'));
statements.push(await functionFromMigration('20261111095224_staff_branch_kitchen_permissions.sql','_staff_permission_any_branch'));
statements.push(await functionFromMigration('20261112030753_staff_branch_cash_book_read.sql','_staff_my_cash_book_view'));
statements.push(`
 create table cash_transactions(id uuid,tenant_id uuid,branch_id uuid);
 create table cash_amendments(id uuid,tenant_id uuid,original_cash_id uuid);
 create table money_accounts(id uuid,tenant_id uuid,branch_id uuid);
 create table party_advance_refunds(id uuid,tenant_id uuid,branch_id uuid,mode text);
 insert into cash_transactions values ('${id(70)}','${id(1)}','${id(10)}'),('${id(71)}','${id(1)}','${id(11)}'),('${id(72)}','${id(2)}','${id(12)}');
 insert into cash_amendments values ('${id(80)}','${id(1)}','${id(70)}'),('${id(81)}','${id(1)}','${id(71)}');
 insert into money_accounts values ('${id(90)}','${id(1)}','${id(10)}'),('${id(91)}','${id(1)}','${id(11)}');
 insert into party_advance_refunds values ('${id(92)}','${id(1)}','${id(10)}','customer'),('${id(93)}','${id(1)}','${id(11)}','customer');
 insert into user_branches values ('${id(101)}','${id(11)}',null);
 insert into role_permissions values ('${id(20)}','finance.view_cash_book');
 insert into role_permissions values ('${id(20)}','customers.view_debt');
 insert into staff_branch_permission_catalog values ('finance.view_cash_book',1);
 alter table cash_transactions enable row level security;
 create policy legacy_scope on cash_transactions for select to authenticated using
  (tenant_id=(select public.get_user_tenant_id()) and public.user_has_branch_access((select auth.uid()),branch_id));
 alter function public.get_user_tenant_id() security definer;
 alter function public.user_has_branch_access(uuid,uuid) security definer;
 alter function public.user_has_permission(uuid,text) security definer;
 alter table cash_amendments enable row level security; alter table money_accounts enable row level security;
 alter table party_advance_refunds enable row level security;
 create policy cash_amendment_read on cash_amendments for select to authenticated using
  (exists(select 1 from cash_transactions c join profiles p on p.id=auth.uid() and coalesce(p.is_active,true)
   where c.id=cash_amendments.original_cash_id and c.tenant_id=cash_amendments.tenant_id
    and p.tenant_id=c.tenant_id and user_has_branch_access(auth.uid(),c.branch_id)
    and user_has_permission(auth.uid(),'finance.view_cash_book')));
 create policy money_account_read on money_accounts for select to authenticated using
  (tenant_id=(select p.tenant_id from profiles p where p.id=auth.uid() and coalesce(p.is_active,true))
   and user_has_branch_access(auth.uid(),branch_id) and (user_has_permission(auth.uid(),'finance.view_cash_book')
    or user_has_permission(auth.uid(),'finance.create_transaction')));
 create policy party_advance_refund_read on party_advance_refunds for select to authenticated using
  (tenant_id=get_user_tenant_id() and user_has_branch_access(auth.uid(),branch_id)
   and user_has_permission(auth.uid(),'finance.view_cash_book')
   and user_has_permission(auth.uid(),case mode when 'customer' then 'customers.view_debt' else 'suppliers.view_debt' end));
 grant usage on schema public,auth to authenticated;
 grant select on cash_transactions,cash_amendments,money_accounts,party_advance_refunds,profiles to authenticated;
 select set_config('request.jwt.claim.sub','${id(101)}',false);
`);
await migration('20261113062219_staff_cash_direct_read_scope.sql');
await migration('20261113062653_staff_cash_related_direct_reads.sql');
statements.push(`
 set role authenticated;
 do $$begin
  if (select count(*) from cash_transactions)<>2 or (select count(*) from money_accounts)<>2
   or (select count(*) from cash_amendments)<>2 or (select count(*) from party_advance_refunds)<>2
   then raise exception 'legacy cash visibility changed'; end if;
 end$$;
 reset role; delete from role_permissions where permission_code='finance.view_cash_book'; set role authenticated;
 do $$begin if (select count(*) from cash_transactions)<>0 then raise exception 'missing cash-book permission exposes raw vouchers';end if;end$$;
 reset role; insert into role_permissions values ('${id(20)}','finance.view_cash_book'); set role authenticated;
 reset role;
 insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
  values('${id(1)}','${id(101)}','${id(10)}','finance.view_cash_book','revoke','${id(100)}');
 set role authenticated;
 do $$begin
  if (select count(*) from cash_transactions)<>1 or (select count(*) from money_accounts)<>1
   or (select count(*) from cash_amendments)<>1 or (select count(*) from party_advance_refunds)<>1
   then raise exception 'denied branch exposed'; end if;
 end$$;
 reset role; insert into role_permissions values ('${id(20)}','reports.dashboard'); set role authenticated;
 do $$begin if (select count(*) from cash_transactions)<>1 then raise exception 'dashboard bypasses cash-book revocation'; end if; end$$;
 reset role; delete from role_permissions where permission_code='reports.dashboard';
 insert into role_permissions values ('${id(20)}','reports.analytics'); set role authenticated;
 do $$begin if (select count(*) from cash_transactions)<>1 then raise exception 'analytics bypasses cash-book revocation'; end if; end$$;
 reset role; delete from role_permissions where permission_code in ('reports.analytics','finance.view_cash_book');
 update user_branch_permission_overrides set branch_id='${id(11)}',override_type='grant' where permission_code='finance.view_cash_book';
 set role authenticated;
 do $$begin
  if (select count(*) from cash_transactions)<>1 or (select count(*) from money_accounts)<>1
   or (select count(*) from cash_amendments)<>1 or (select count(*) from party_advance_refunds)<>1
   then raise exception 'local grant scope mismatch'; end if;
 end$$;
 reset role; insert into user_permission_overrides(tenant_id,user_id,permission_code,override_type,created_by)
  values('${id(1)}','${id(101)}','finance.view_cash_book','revoke','${id(100)}'); set role authenticated;
 do $$begin
  if (select count(*) from cash_transactions)<>0 or (select count(*) from cash_amendments)<>0
   or (select count(*) from money_accounts)<>0 or (select count(*) from party_advance_refunds)<>0
   then raise exception 'global revoke bypassed'; end if;
 end$$;
 reset role; delete from user_branch_permission_overrides where permission_code='finance.view_cash_book'; set role authenticated;
 do $$begin if (select count(*) from cash_transactions)<>0 then raise exception 'global-only revoke bypassed'; end if; end$$;
 reset role; insert into role_permissions values ('${id(20)}','reports.dashboard'),('${id(20)}','reports.analytics'); set role authenticated;
 do $$begin
  begin perform count(*) from cash_transactions; raise exception 'report grants bypass global cash revoke';
  exception when raise_exception then if sqlerrm not like 'Báo cáo đã cập nhật.%' then raise; end if; end;
 end$$;
 reset role; delete from role_permissions where permission_code in ('reports.dashboard','reports.analytics');
 insert into role_permissions values ('${id(20)}','finance.create_transaction'); set role authenticated;
 do $$begin if (select count(*) from money_accounts)<>2 then raise exception 'payment account access lost'; end if; end$$;
 reset role;
`);
statements.push(`create table dashboard_live_signals(id uuid,tenant_id uuid,branch_id uuid,created_at timestamptz);
 alter table dashboard_live_signals enable row level security;
 grant select on dashboard_live_signals to authenticated;
 insert into dashboard_live_signals values
 ('${id(201)}','${id(1)}','${id(10)}',now()),('${id(202)}','${id(1)}','${id(11)}',now()),
 ('${id(203)}','${id(2)}','${id(12)}',now()),('${id(204)}','${id(1)}',null,now());
 insert into role_permissions values ('${id(20)}','pos_fnb.view_sales_summary');
 insert into staff_branch_permission_catalog values ('pos_fnb.view_sales_summary',1);`);
await migration('20261113080848_staff_fnb_history_refresh_signal.sql');
statements.push(`set role authenticated;
 do $$begin if (select count(*) from dashboard_live_signals)<>2 then raise exception 'SIGNAL_BRANCH_SCOPE_MISMATCH';end if;end$$;
 reset role; insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
 values('${id(1)}','${id(101)}','${id(10)}','pos_fnb.view_sales_summary','revoke','${id(100)}'); set role authenticated;
 do $$begin if (select count(*) from dashboard_live_signals)<>1 then raise exception 'SIGNAL_BRANCH_REVOKE_BYPASS';end if;end$$;
 reset role; insert into user_permission_overrides(tenant_id,user_id,permission_code,override_type,created_by)
 values('${id(1)}','${id(101)}','pos_fnb.view_sales_summary','revoke','${id(100)}'); set role authenticated;
 do $$begin if (select count(*) from dashboard_live_signals)<>0 then raise exception 'SIGNAL_GLOBAL_REVOKE_BYPASS';end if;end$$;
 reset role;`);
// End-to-end: a revoked cash-book reader may still get bounded report totals,
// while direct voucher rows remain hidden even with the report permission.
statements.push(`alter table cash_transactions add column transaction_date date,add column created_at timestamptz,
 add column type text,add column category text,add column amount numeric,add column status text,
 add column payment_method text,add column reference_type text;
 update cash_transactions set transaction_date='2026-11-01',created_at='2026-11-01T12:00Z',
  type='receipt',category='Sales',amount=100,status='completed';
 insert into role_permissions values ('${id(20)}','reports.analytics');
 create function public._can_read_branch_inventory_00476(p_user uuid,p_tenant uuid,p_branch uuid)
 returns boolean language sql as $$select public.user_has_branch_access(p_user,p_branch) or public.user_has_permission(p_user,'reports.view_all_branches')$$;`);
statements.push(await functionFromMigration('20261111094222_staff_branch_report_permissions.sql','_staff_report_permission'));
const reportGuard=await functionFromMigration('00513_inventory_operational_read_projections.sql','assert_report_access');
statements.push(reportGuard.replace('public.user_has_permission(v_actor,p_permission_code)','public._staff_report_permission(v_actor,p_permission_code,p_branch_id)'));
await migration('20261113074601_staff_cash_flow_summary_projection.sql');
statements.push(`set role authenticated; do $$begin
 begin perform count(*) from cash_transactions; raise exception 'SUMMARY_REVEALED_RAW_VOUCHERS';
 exception when raise_exception then if sqlerrm not like 'Báo cáo đã cập nhật.%' then raise; end if; end;
 if (select sum(amount) from get_cash_flow_category_summary('2026-11-01','2026-11-30','${id(10)}')) is distinct from 100
 then raise exception 'AUTHORIZED_SUMMARY_MISSING';end if;
 end$$; reset role;
 delete from user_permission_overrides where permission_code='finance.view_cash_book';
 set role authenticated; do $$begin
 begin perform count(*) from cash_transactions; raise exception 'REPORT_ONLY_USER_REVEALED_RAW_VOUCHERS';
 exception when raise_exception then if sqlerrm not like 'Báo cáo đã cập nhật.%' then raise; end if; end;
 if (select sum(amount) from get_cash_flow_category_summary('2026-11-01','2026-11-30','${id(10)}')) is distinct from 100
 then raise exception 'REPORT_ONLY_SUMMARY_MISSING';end if;
 end$$; reset role;`);
if (process.env.ONEBIZ_PGLITE_MODULE) {
 const {PGlite}=await import(pathToFileURL(process.env.ONEBIZ_PGLITE_MODULE).href);
 const db=new PGlite();
 try { await db.exec(statements.join('\n')); }
 catch(error) { console.error(error.message,error.where||''); process.exitCode=1; }
 finally { await db.close(); }
 if(process.exitCode) process.exit(process.exitCode);
 console.log('PASS direct cash scope rehearsal (PGlite)'); process.exit(0);
}
const child=spawn('psql',['-Xq','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55433','-U','staff_test','-d','onebiz_staff_access_test'],{
 env:{PATH:process.env.PATH,PGPASSWORD:'ephemeral-test-only',PGSSLMODE:'disable',PGCONNECT_TIMEOUT:'5'},stdio:['pipe','pipe','pipe']
});
let err='';child.stderr.on('data',x=>err+=x);
const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(err)));});
child.stdin.end(statements.join('\n'));await done;
console.log('PASS real PostgreSQL: direct cash branch scope and independent dashboard access');
