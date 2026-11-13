// Synthetic data only; never connect this test to ONEBIZ.
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {initializeStaffAccessFixture} from './fixture.mjs';
import {functionFromMigration} from './inventory.mjs';
if(process.env.STAFF_EPHEMERAL_DB!=='onebiz_staff_access_test')throw new Error('Dedicated disposable database required');
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const sql=[];
await initializeStaffAccessFixture({exec:async s=>sql.push(s)},id);
const migration=async n=>readFile(new URL(`../../supabase/migrations/${n}`,import.meta.url),'utf8');
sql.push(await migration('20261111052704_staff_branch_access.sql'));
sql.push(await functionFromMigration('20261111070229_staff_branch_checkout_permissions.sql','_staff_permission_at_scope'));
sql.push(await functionFromMigration('20261112172924_staff_invoice_item_view_scope.sql','_staff_invoice_item_read'));
sql.push(`
 create table invoices(id uuid,tenant_id uuid,branch_id uuid,source text);
 insert into invoices values
  ('${id(30)}','${id(1)}','${id(10)}','order'),('${id(31)}','${id(1)}','${id(11)}','order'),
  ('${id(32)}','${id(1)}','${id(10)}','fnb'),('${id(33)}','${id(1)}','${id(11)}','fnb'),
  ('${id(34)}','${id(1)}','${id(10)}','pos'),('${id(35)}','${id(1)}','${id(11)}','pos'),
  ('${id(36)}','${id(2)}','${id(12)}','order');
 insert into user_branches values ('${id(101)}','${id(11)}',null);
 delete from role_permissions where role_id='${id(20)}';
 insert into role_permissions values ('${id(20)}','invoices.view');
 insert into staff_branch_permission_catalog values ('invoices.view',1),('orders.view',1),('pos_fnb.view_orders',1);
 alter function public.get_user_tenant_id() security definer;
 alter function public.user_has_branch_access(uuid,uuid) security definer;
 alter function public.user_has_permission(uuid,text) security definer;
 alter table invoices enable row level security;
 create policy invoice_legacy on invoices for select to authenticated using
  (tenant_id=get_user_tenant_id() and user_has_branch_access(auth.uid(),branch_id));
 grant usage on schema public,auth to authenticated;grant select on invoices to authenticated;
 select set_config('request.jwt.claim.sub','${id(101)}',false);
`);
sql.push(await migration('20261113065814_staff_invoice_header_branch_scope.sql'));
sql.push(`
 alter table invoices add column code text,add column status text,add column total numeric,add column paid numeric,add column client_session_id uuid;
 update invoices set client_session_id=id;
 create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
 create function public.find_invoice_by_session_id(p_tenant_id uuid,p_client_session_id uuid)
 returns table(id uuid,code text,status text,total numeric,paid numeric) language sql security definer set search_path=public as $$
 SELECT id,code,status,total,paid FROM public.invoices WHERE tenant_id = p_tenant_id AND client_session_id = p_client_session_id LIMIT 1;
 $$;
 grant execute on function public.find_invoice_by_session_id(uuid,uuid) to authenticated,service_role;
`);
sql.push(await migration('20261113094600_staff_invoice_session_lookup_scope.sql'));

sql.push(`
 set role authenticated;
 do $$begin if (select count(*) from invoices)<>6 then raise exception 'legacy invoice reads changed';end if;end$$;
 reset role;insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
  values('${id(1)}','${id(101)}','${id(10)}','invoices.view','revoke','${id(100)}');set role authenticated;
 do $$begin if (select count(*) from invoices)<>3 or exists(select 1 from invoices where branch_id='${id(10)}')
  then raise exception 'denied invoice branch exposed';end if;end$$;
 do $$begin
  if (select count(*) from public.find_invoice_by_session_id('${id(1)}','${id(30)}'))<>0 then raise exception 'session lookup exposed denied branch';end if;
  if (select count(*) from public.find_invoice_by_session_id('${id(1)}','${id(31)}'))<>1 then raise exception 'session lookup blocked permitted branch';end if;
  if (select count(*) from public.find_invoice_by_session_id('${id(2)}','${id(36)}'))<>0 then raise exception 'session lookup exposed other tenant';end if;
 end$$;
 reset role;insert into role_permissions values ('${id(20)}','pos_fnb.checkout');set role authenticated;
 do $$begin if (select count(*) from invoices)<>4 or not exists(select 1 from invoices where id='${id(32)}')
  then raise exception 'independent F&B checkout lost';end if;end$$;
 do $$begin if (select count(*) from public.find_invoice_by_session_id('${id(1)}','${id(32)}'))<>1 then raise exception 'F&B checkout session recovery lost';end if;end$$;
 reset role;delete from role_permissions where permission_code='pos_fnb.checkout';
 insert into role_permissions values ('${id(20)}','pos_retail.checkout');set role authenticated;
 do $$begin if (select count(*) from public.find_invoice_by_session_id('${id(1)}','${id(34)}'))<>1
  then raise exception 'retail checkout session recovery lost';end if;end$$;
 reset role;delete from role_permissions where permission_code='pos_retail.checkout';
 insert into role_permissions values ('${id(20)}','invoices.print');set role authenticated;
 do $$begin if (select count(*) from invoices)<>6 then raise exception 'independent invoice printing lost';end if;end$$;
 reset role;delete from role_permissions where permission_code='invoices.print';
 insert into role_permissions values ('${id(20)}','reports.analytics');set role authenticated;
 do $$begin if (select count(*) from invoices)<>6 then raise exception 'independent reporting lost';end if;end$$;
 reset role;insert into staff_branch_permission_catalog values ('reports.analytics',1);
 insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
  values('${id(1)}','${id(101)}','${id(10)}','reports.analytics','revoke','${id(100)}');set role authenticated;
 do $$begin if (select count(*) from invoices)<>3 then raise exception 'report branch revoke bypassed';end if;end$$;
 reset role;delete from user_branch_permission_overrides where permission_code='reports.analytics';set role authenticated;
 reset role;delete from role_permissions where permission_code in ('reports.analytics','invoices.view');
 update user_branch_permission_overrides set branch_id='${id(11)}',override_type='grant' where permission_code='invoices.view';set role authenticated;
 do $$begin if (select count(*) from invoices)<>3 then raise exception 'local-only invoice grant failed';end if;end$$;
 reset role;insert into user_permission_overrides(tenant_id,user_id,permission_code,override_type,created_by)
  values('${id(1)}','${id(101)}','invoices.view','revoke','${id(100)}');set role authenticated;
 do $$begin if (select count(*) from invoices)<>0 then raise exception 'global invoice revoke bypassed';end if;end$$;
 reset role;insert into role_permissions values ('${id(20)}','pos_fnb.checkout');set role authenticated;
 do $$begin if (select count(*) from invoices)<>2 then raise exception 'global invoice revoke blocked independent F&B checkout';end if;end$$;
 reset role;delete from role_permissions where permission_code='pos_fnb.checkout';set role authenticated;
 reset role;delete from user_branch_permission_overrides where permission_code='invoices.view';
 delete from user_permission_overrides where permission_code='invoices.view';
 insert into role_permissions values ('${id(20)}','orders.view');
 insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
  values('${id(1)}','${id(101)}','${id(10)}','orders.view','revoke','${id(100)}');set role authenticated;
 do $$begin if (select count(*) from invoices)<>5 or exists(select 1 from invoices where id='${id(30)}')
  then raise exception 'order view scope changed unrelated sources';end if;end$$;
 reset role;delete from user_branch_permission_overrides where permission_code='orders.view';
 delete from role_permissions where permission_code='orders.view';
 insert into role_permissions values ('${id(20)}','pos_fnb.view_orders');
 insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
  values('${id(1)}','${id(101)}','${id(10)}','pos_fnb.view_orders','revoke','${id(100)}');set role authenticated;
 do $$begin if (select count(*) from invoices)<>5 or exists(select 1 from invoices where id='${id(32)}')
  then raise exception 'F&B view scope changed unrelated sources';end if;end$$;
 reset role;delete from role_permissions where permission_code='pos_fnb.view_orders';
 insert into role_permissions values ('${id(20)}','pos_fnb.view_sales_summary'),('${id(20)}','reports.fnb');set role authenticated;
 do $$begin if (select count(*) from invoices where source='fnb')<>0
  then raise exception 'F&B summary permission exposed invoice headers';end if;end$$;
 reset role;insert into role_permissions values ('${id(20)}','pos_fnb.checkout');set role authenticated;
 do $$begin if (select count(*) from invoices where source='fnb')<>2
  then raise exception 'F&B checkout lost independent invoice access';end if;end$$;
 reset role;
 grant usage on schema public,auth to service_role;
 select set_config('request.jwt.claim.role','service_role',false);
 set role service_role;
 do $$begin if (select count(*) from public.find_invoice_by_session_id('${id(2)}','${id(36)}'))<>1
  then raise exception 'trusted server session lookup lost';end if;end$$;
 reset role;
`);
if(process.env.ONEBIZ_PGLITE_MODULE){
 const {PGlite}=await import(pathToFileURL(process.env.ONEBIZ_PGLITE_MODULE).href);const db=new PGlite();
 try{await db.exec(sql.join('\n'));}catch(e){console.error(e.message,e.where||'');process.exitCode=1;}finally{await db.close();}
 if(process.exitCode)process.exit(process.exitCode);console.log('PASS invoice header fixture rehearsal (PGlite)');process.exit(0);
}
const child=spawn('psql',['-Xq','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55433','-U','staff_test','-d','onebiz_staff_access_test'],{
 env:{PATH:process.env.PATH,PGPASSWORD:'ephemeral-test-only',PGSSLMODE:'disable',PGCONNECT_TIMEOUT:'5'},stdio:['pipe','pipe','pipe']
});
let err='';child.stderr.on('data',x=>err+=x);child.stdout.resume();
const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(err)));});
child.stdin.end(sql.join('\n'));await done;
console.log('PASS real PostgreSQL: invoice header scopes, independent POS, print and reports');
