// Synthetic data on a dedicated disposable PostgreSQL instance only.
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
sql.push(await functionFromMigration('20261111095224_staff_branch_kitchen_permissions.sql','_staff_permission_any_branch'));
sql.push(await functionFromMigration('20261112030753_staff_branch_cash_book_read.sql','_staff_my_cash_book_view'));
sql.push(`create function public.get_party_cash_history_sources(text,uuid,uuid,integer,integer,jsonb)
 returns jsonb language plpgsql as $$begin
 if not public._staff_my_cash_book_view($3) then raise exception 'PARTY_CASH_HISTORY_DENIED' using errcode='42501';end if;
 return '{}';end$$;
 create table cash_transactions(id uuid,tenant_id uuid,code text,transaction_date date,note text);
 create table supplier_advances(id uuid,tenant_id uuid,branch_id uuid,cash_transaction_id uuid,original_amount numeric,remaining_amount numeric,status text,created_at timestamptz,supplier_id uuid);
 create table customer_advances(id uuid,tenant_id uuid,branch_id uuid,cash_transaction_id uuid,original_amount numeric,remaining_amount numeric,status text,created_at timestamptz,customer_id uuid);
 create table supplier_advance_allocations(supplier_advance_id uuid,tenant_id uuid,branch_id uuid,purchase_order_id uuid,amount numeric,note text,created_at timestamptz);
 create table customer_advance_allocations(customer_advance_id uuid,tenant_id uuid,branch_id uuid,invoice_id uuid,amount numeric,note text,created_at timestamptz);
 create table party_advance_refunds(id uuid,advance_id uuid,mode text,tenant_id uuid,branch_id uuid,status text,amount numeric,cash_id uuid,cancellation_reason text,created_at timestamptz);
 create table purchase_orders(id uuid,tenant_id uuid,code text); create table invoices(id uuid,tenant_id uuid,code text);
 insert into user_branches values ('${id(101)}','${id(11)}',null);
 insert into role_permissions values ('${id(20)}','finance.view_cash_book'),('${id(20)}','customers.view_debt');
 insert into staff_branch_permission_catalog values ('finance.view_cash_book',1);
 insert into cash_transactions values ('${id(70)}','${id(1)}','A',current_date,'a'),('${id(71)}','${id(1)}','B',current_date,'b'),('${id(72)}','${id(2)}','C',current_date,'c');
 insert into customer_advances values
 ('${id(80)}','${id(1)}','${id(10)}','${id(70)}',100,100,'active',now(),'${id(90)}'),
 ('${id(81)}','${id(1)}','${id(11)}','${id(71)}',200,200,'active',now(),'${id(90)}'),
 ('${id(82)}','${id(2)}','${id(12)}','${id(72)}',300,300,'active',now(),'${id(90)}');
 select set_config('request.jwt.claim.sub','${id(101)}',false);`);
let original=await functionFromMigration('00553_party_cash_amendments.sql','get_party_advance_ledger');
original=original.replace('public.get_party_advance_ledger(', 'public.get_party_advance_ledger_00553(');
if (process.env.ONEBIZ_CASH_AUDIT_FILE) {
 const captured=JSON.parse(await readFile(process.env.ONEBIZ_CASH_AUDIT_FILE,'utf8'))
  .find(row=>row.proname==='get_party_advance_ledger_00553');
 if (!captured?.definition) throw new Error('Captured production ledger definition missing');
 original=captured.definition;
}
sql.push(original.trimEnd().endsWith(';') ? original : original + ';');
sql.push(await functionFromMigration('00557_party_advance_refunds.sql','get_party_advance_ledger'));
const patch=await readFile('supabase/migrations/20261113081722_staff_party_advance_branch_read.sql','utf8');
sql.push(patch,patch); // A safe rerun must leave the recognized guard unchanged.
sql.push(`do $$declare rows jsonb;begin
 rows:=public.get_party_advance_ledger_00553('customer','${id(90)}',null);
 if jsonb_array_length(rows)<>2 then raise exception 'LEGACY_LEDGER_WRONG';end if;end$$;
 insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
 values('${id(1)}','${id(101)}','${id(10)}','finance.view_cash_book','revoke','${id(100)}');
 do $$declare rows jsonb;begin
 rows:=public.get_party_advance_ledger_00553('customer','${id(90)}',null);
 if jsonb_array_length(rows)<>1 or rows->0->>'branchId' is distinct from '${id(11)}' then raise exception 'LEDGER_BRANCH_DENIAL_BYPASSED';end if;
 rows:=public.get_party_advance_ledger('customer','${id(90)}',null);
 if jsonb_array_length(rows)<>1 or rows->0->>'branchId' is distinct from '${id(11)}' then raise exception 'LEDGER_WRAPPER_SCOPE_BYPASSED';end if;
 begin perform public.get_party_advance_ledger_00553('customer','${id(90)}','${id(10)}');raise exception 'DENIED_BRANCH_ACCEPTED';
 exception when insufficient_privilege then null;end;
 end$$;
 insert into user_permission_overrides(tenant_id,user_id,permission_code,override_type,created_by)
 values('${id(1)}','${id(101)}','finance.view_cash_book','revoke','${id(100)}');
 do $$begin begin perform public.get_party_advance_ledger_00553('customer','${id(90)}',null);raise exception 'GLOBAL_REVOKE_ACCEPTED';
 exception when insufficient_privilege then null;end;end$$;`);
if (process.env.ONEBIZ_PGLITE_REHEARSAL==='1') {
 const {PGlite}=await import('@electric-sql/pglite'); const db=new PGlite();
 try {await db.exec(sql.join('\n'));} catch (error) {console.error(error.message);process.exitCode=1;} finally {await db.close();}
 if(process.exitCode) process.exit(process.exitCode);
 console.log('PASS advance ledger branch and global revoke rehearsal');process.exit(0);
}
const child=spawn('psql',['-Xq','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55433','-U','staff_test','-d','onebiz_staff_access_test'],{
 env:{PATH:process.env.PATH,PGPASSWORD:'ephemeral-test-only',PGSSLMODE:'disable',PGCONNECT_TIMEOUT:'5'},stdio:['pipe','pipe','pipe']});
let err='';child.stderr.on('data',x=>err+=x);
const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(err)));});
child.stdin.end(sql.join('\n'));await done;
console.log('PASS PostgreSQL: advance ledger branch and global revoke');
