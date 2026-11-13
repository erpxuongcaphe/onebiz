// Disposable database, synthetic rows only. Verifies the staged report projection.
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
if(process.env.LOT_ALERT_TEST_DB!=='onebiz_lot_alert_test')throw new Error('Dedicated test database required');
const migration=await readFile(new URL('../supabase/migrations/20261113102711_staff_financial_alert_lots_compat.sql',import.meta.url),'utf8');
const sql=`
create role anon;create role authenticated;create role service_role;create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table profiles(id uuid,tenant_id uuid,is_active boolean);
create table branches(id uuid,tenant_id uuid);
create table user_branches(user_id uuid,branch_id uuid);
create table permissions(user_id uuid,code text);
create function public.user_has_permission(p_user uuid,p_code text) returns boolean language sql stable security definer as $$select exists(select 1 from public.permissions where user_id=p_user and code=p_code)$$;
create function public.user_has_branch_access(p_user uuid,p_branch uuid) returns boolean language sql stable security definer as $$select exists(select 1 from public.user_branches where user_id=p_user and branch_id=p_branch)$$;
create table products(id uuid,tenant_id uuid,name text);
create table product_lots(id uuid,tenant_id uuid,branch_id uuid,product_id uuid,lot_number text,expiry_date date,current_qty numeric,status text);
insert into profiles values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',true),('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001',false);
insert into branches values ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001'),('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001'),('30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000002');
insert into user_branches values ('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001');
insert into permissions values ('10000000-0000-0000-0000-000000000001','reports.dashboard');
insert into products values ('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Synthetic product');
insert into product_lots values
 ('50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','VALID',current_date,2,'active'),
 ('50000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','UNASSIGNED',current_date,2,'active'),
 ('50000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000001','OTHER',current_date,2,'active'),
 ('50000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','CANCEL',current_date,2,'cancelled');
grant usage on schema public,auth to authenticated;
${migration}
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
set role authenticated;
do $$declare denied boolean:=false;begin
 if (select count(*) from public.get_financial_alert_lots(null))<>1 then raise exception 'aggregate scope or status filter failed';end if;
 if (select count(*) from public.get_financial_alert_lots('30000000-0000-0000-0000-000000000001'))<>1 then raise exception 'assigned branch failed';end if;
 begin perform public.get_financial_alert_lots('30000000-0000-0000-0000-000000000002');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'unassigned branch accessible';end if;
 if has_table_privilege('authenticated','public.product_lots','select') then raise exception 'raw lot access granted';end if;
 if has_function_privilege('anon','public.get_financial_alert_lots(uuid)','execute') then raise exception 'anonymous RPC access';end if;
end$$;
reset role;
insert into permissions values ('10000000-0000-0000-0000-000000000001','reports.view_all_branches');
set role authenticated;
do $$begin if (select count(*) from public.get_financial_alert_lots(null))<>2 then raise exception 'all branch scope or tenant failed';end if;end$$;
reset role;delete from permissions where code='reports.dashboard';set role authenticated;
do $$declare denied boolean:=false;begin begin perform public.get_financial_alert_lots(null);exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'report permission missing';end if;end$$;
reset role;select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',false);set role authenticated;
do $$declare denied boolean:=false;begin begin perform public.get_financial_alert_lots(null);exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'inactive user allowed';end if;end$$;
`;
if(process.env.ONEBIZ_PGLITE_MODULE){const {PGlite}=await import(pathToFileURL(process.env.ONEBIZ_PGLITE_MODULE).href);const db=new PGlite();try{await db.exec(sql)}finally{await db.close()}console.log('PASS alert projection fixture (PGlite)');process.exit(0)}
const child=spawn('psql',['-Xq','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55433','-U','staff_test','-d','onebiz_lot_alert_test'],{env:{PATH:process.env.PATH,PGPASSWORD:'ephemeral-test-only',PGSSLMODE:'disable',PGCONNECT_TIMEOUT:'5'},stdio:['pipe','pipe','pipe']});let error='';child.stderr.on('data',d=>error+=d);child.stdout.resume();const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(error)))});child.stdin.end(sql);await done;console.log('PASS real PostgreSQL alert projection branch and tenant scope');
