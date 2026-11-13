// Synthetic data only; never connect this script to an application database.
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
if (process.env.STAFF_EPHEMERAL_DB !== 'onebiz_staff_access_test') throw new Error('Dedicated disposable database required');
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const source=await readFile('supabase/migrations/00513_inventory_operational_read_projections.sql','utf8');
const start=source.indexOf('create or replace function public.assert_report_access(');
const finish=source.indexOf('end;$$;',start);
if(start<0 || finish<0) throw new Error('report guard missing');
const guard=source.slice(start,finish+'end;$$;'.length);
const sql=`
 create role anon; create role authenticated; create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table profiles(id uuid primary key,tenant_id uuid,is_active boolean);
 create table branches(id uuid primary key,tenant_id uuid);
 create table cash_transactions(tenant_id uuid,branch_id uuid,transaction_date date,created_at timestamptz,type text,category text,amount numeric,status text,payment_method text,reference_type text);
 create function public.user_has_permission(actor uuid,code text) returns boolean language sql as $$select actor='${id(100)}'::uuid or (actor='${id(101)}'::uuid and code in ('reports.analytics','reports.dashboard'))$$;
 create function public._can_read_branch_inventory_00476(actor uuid,tenant uuid,branch uuid) returns boolean language sql as $$select actor='${id(100)}'::uuid or branch='${id(10)}'::uuid$$;
 insert into profiles values ('${id(100)}','${id(1)}',true),('${id(101)}','${id(1)}',true),('${id(102)}','${id(1)}',false);
 insert into branches values ('${id(10)}','${id(1)}'),('${id(11)}','${id(1)}'),('${id(12)}','${id(2)}');
 insert into cash_transactions values
 ('${id(1)}','${id(10)}','2026-11-01','2026-10-31T18:00Z','receipt','Sales',100,'completed','cash','invoice'),
 ('${id(1)}','${id(10)}','2026-11-02','2026-10-31T18:00Z','payment',null,20,'completed','transfer','sales_return'),
 ('${id(1)}','${id(10)}','2026-11-02','2026-10-31T18:00Z','payment','Draft',900,'draft','cash','other'),
 ('${id(1)}','${id(11)}','2026-11-01','2026-10-31T18:00Z','receipt','Sales',200,'completed','cash','invoice'),
 ('${id(2)}','${id(12)}','2026-11-01','2026-10-31T18:00Z','receipt','Sales',9999,'completed','cash','invoice');
 ${guard}
 ${await readFile('supabase/migrations/20261113074601_staff_cash_flow_summary_projection.sql','utf8')}
 select set_config('request.jwt.claim.sub','${id(101)}',false);
 do $$declare x numeric;begin
  select sum(amount) into x from get_cash_flow_category_summary('2026-11-01','2026-11-30','${id(10)}');
  if x is distinct from 120 then raise exception 'category totals wrong';end if;
  if (select sum(amount) from get_cash_flow_alert_totals('2026-11-01','2026-11-30','${id(10)}')) is distinct from 120 then raise exception 'alert totals wrong';end if;
  if (select month from get_cash_flow_created_month_totals('2026-10-01','2026-12-01','Asia/Ho_Chi_Minh','${id(10)}') limit 1) is distinct from 11 then raise exception 'timezone wrong';end if;
  if (select sum(amount) from get_cash_expense_report_totals('2026-10-01','2026-12-01','UTC','${id(10)}')) is distinct from 920 then raise exception 'legacy expense status changed';end if;
  if (select sum(amount) from get_cash_dashboard_totals('2026-11-01','2026-11-02','${id(10)}')) is distinct from 100 then raise exception 'dashboard date bounds wrong';end if;
  begin perform * from get_cash_flow_category_summary('2026-11-01','2026-11-30','${id(11)}'); raise exception 'branch access bypassed';exception when insufficient_privilege then null;end;
  begin perform * from get_cash_flow_category_summary('2026-11-01','2026-11-30','${id(12)}'); raise exception 'tenant isolation bypassed';exception when insufficient_privilege then null;end;
  begin perform * from get_cash_flow_category_summary('2026-11-01','2026-11-30',null); raise exception 'all-branch access bypassed';exception when insufficient_privilege then null;end;
  if has_function_privilege('anon','public.get_cash_flow_category_summary(date,date,uuid)','EXECUTE') then raise exception 'anonymous access';end if;
 end$$;
 select set_config('request.jwt.claim.sub','${id(100)}',false);
 do $$begin if (select sum(amount) from get_cash_flow_category_summary('2026-11-01','2026-11-30',null)) is distinct from 320 then raise exception 'all branches incorrect';end if;end$$;
`;
if(process.env.ONEBIZ_PGLITE_REHEARSAL==='1'){
 const {PGlite}=await import('@electric-sql/pglite'); const db=new PGlite();
 try{await db.exec(sql);}catch(error){console.error(error.message);process.exitCode=1;}finally{await db.close();}
 if(process.exitCode)process.exit(process.exitCode);console.log('PASS disposable cash projection rehearsal');process.exit(0);
}
const child=spawn('psql',['-Xq','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55433','-U','staff_test','-d','onebiz_staff_access_test'],{env:{PATH:process.env.PATH,PGPASSWORD:'ephemeral-test-only',PGSSLMODE:'disable',PGCONNECT_TIMEOUT:'5'},stdio:['pipe','pipe','pipe']});
let err='';child.stderr.on('data',x=>err+=x);
const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(err)));});
child.stdin.end(sql);await done;console.log('PASS PostgreSQL cash projections and isolation');
