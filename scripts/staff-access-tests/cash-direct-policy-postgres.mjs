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
 insert into cash_transactions values ('${id(70)}','${id(1)}','${id(10)}'),('${id(71)}','${id(1)}','${id(11)}'),('${id(72)}','${id(2)}','${id(12)}');
 insert into user_branches values ('${id(101)}','${id(11)}',null);
 insert into role_permissions values ('${id(20)}','finance.view_cash_book');
 insert into staff_branch_permission_catalog values ('finance.view_cash_book',1);
 alter table cash_transactions enable row level security;
 create policy legacy_scope on cash_transactions for select to authenticated using
  (tenant_id=(select public.get_user_tenant_id()) and public.user_has_branch_access((select auth.uid()),branch_id));
 alter function public.get_user_tenant_id() security definer;
 alter function public.user_has_branch_access(uuid,uuid) security definer;
 grant usage on schema public,auth to authenticated;
 grant select on cash_transactions to authenticated;
 select set_config('request.jwt.claim.sub','${id(101)}',false);
`);
await migration('20261113062219_staff_cash_direct_read_scope.sql');
statements.push(`
 set role authenticated;
 do $$begin if (select count(*) from cash_transactions)<>2 then raise exception 'legacy cash visibility changed'; end if; end$$;
 reset role;
 insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
  values('${id(1)}','${id(101)}','${id(10)}','finance.view_cash_book','revoke','${id(100)}');
 set role authenticated;
 do $$begin if (select count(*) from cash_transactions)<>1 then raise exception 'denied branch exposed'; end if; end$$;
 reset role; insert into role_permissions values ('${id(20)}','reports.dashboard'); set role authenticated;
 do $$begin if (select count(*) from cash_transactions)<>2 then raise exception 'independent dashboard access lost'; end if; end$$;
 reset role; delete from role_permissions where permission_code in ('reports.dashboard','finance.view_cash_book');
 update user_branch_permission_overrides set branch_id='${id(11)}',override_type='grant' where permission_code='finance.view_cash_book';
 set role authenticated;
 do $$begin if (select count(*) from cash_transactions)<>1 then raise exception 'local grant scope mismatch'; end if; end$$;
 reset role; insert into user_permission_overrides(tenant_id,user_id,permission_code,override_type,created_by)
  values('${id(1)}','${id(101)}','finance.view_cash_book','revoke','${id(100)}'); set role authenticated;
 do $$begin if (select count(*) from cash_transactions)<>0 then raise exception 'global revoke bypassed'; end if; end$$;
 reset role;
`);
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
