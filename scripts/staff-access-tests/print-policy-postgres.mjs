// Only synthetic data in a dedicated disposable PostgreSQL database.
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { initializeStaffAccessFixture } from './fixture.mjs';
import { loadCheckoutDefinitions } from './checkout-definitions.mjs';

if (process.env.STAFF_EPHEMERAL_DB !== 'onebiz_staff_access_test') throw new Error('Dedicated disposable database required');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const statements = [];
const db = { exec: async sql => statements.push(sql) };
await initializeStaffAccessFixture(db, id);
const migration = async name => statements.push(await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8'));
await migration('20261111052704_staff_branch_access.sql');
statements.push(`
 create schema extensions;
 create table fnb_print_points(id uuid,tenant_id uuid,branch_id uuid,enabled boolean);
 create table fnb_print_jobs(id uuid);
 create table invoices(id uuid,code text,tenant_id uuid,branch_id uuid,customer_id uuid,customer_name text,status text,debt numeric,source text,shift_id uuid);
 create table invoice_items(id uuid,invoice_id uuid);
 create table cash_transactions(id uuid,reference_type text,reference_id uuid);
 create table shifts(id uuid default gen_random_uuid(),tenant_id uuid,branch_id uuid,cashier_id uuid,status text,starting_cash numeric,opened_at timestamptz default now());
 create function can_read_branch_document_00567(uuid,uuid) returns boolean language sql as $$select true$$;
`);
await loadCheckoutDefinitions(db);
await migration('20261111070229_staff_branch_checkout_permissions.sql');
await migration('20261112054235_staff_branch_fnb_print_view.sql');
statements.push(`
 alter table fnb_print_points add column routes jsonb;
 alter table fnb_print_jobs add column tenant_id uuid,add column branch_id uuid,add column point_id uuid,
  add column actor_id uuid,add column actor_name text,add column label text,add column route_key text,
  add column route_label text,add column printer text,add column paper text,add column bytes_base64 text,
  add column payload_hash bytea,add column status text default 'queued';
 create function public.digest(bytea,text) returns bytea language sql immutable as $$select decode(md5(encode($1,'hex')),'hex')$$;
 insert into fnb_print_points values('${id(70)}','${id(1)}','${id(10)}',true,
  '[{"key":"cashier","paper":"80mm","printer":"Synthetic","label":"Cashier"},{"key":"kitchen","paper":"80mm","printer":"Synthetic","label":"Kitchen"}]');
 select set_config('request.jwt.claim.sub','${id(101)}',false);
 insert into role_permissions values ('${id(20)}','pos_fnb.send_kitchen');
 do $$begin
  perform public.fnb_print_enqueue_v1('${id(10)}','${id(74)}','kitchen','Synthetic','80mm',encode(decode('1b401b6101' || repeat('00',20),'hex'),'base64'));
  perform public.fnb_print_enqueue_v1('${id(10)}','${id(74)}','kitchen','Synthetic','80mm',encode(decode('1b401b6101' || repeat('00',20),'hex'),'base64'));
  if (select count(*) from fnb_print_jobs) <> 1 then raise exception 'Duplicate kitchen job'; end if;
  begin
   perform public.fnb_print_enqueue_v1('${id(10)}','${id(75)}','cashier','Synthetic','80mm',encode(decode('1b401b6101' || repeat('00',20),'hex'),'base64'));
   raise exception 'Kitchen-only permission unexpectedly allowed cashier print';
  exception when others then
   if sqlerrm not like '%Không có quyền in bill%' then raise; end if;
  end;
  begin
   perform public._fnb_print_access_v1('${id(11)}');
   raise exception 'Unexpected access to unassigned branch';
  exception when others then
   if sqlerrm not like '%Không có quyền%' then raise; end if;
  end;
  if (select count(*) from fnb_print_jobs) <> 1 then raise exception 'Denied request created a job'; end if;
 end$$;
 insert into role_permissions values ('${id(20)}','pos_fnb.checkout');
 do $$begin
  perform public.fnb_print_enqueue_v1('${id(10)}','${id(76)}','cashier','Synthetic','80mm',encode(decode('1b401b6101' || repeat('00',20),'hex'),'base64'));
  if (select count(*) from fnb_print_jobs) <> 2 then raise exception 'Checkout user lost cashier printing'; end if;
 end$$;
`);
if (process.env.ONEBIZ_PGLITE_MODULE) {
 const { PGlite } = await import(pathToFileURL(process.env.ONEBIZ_PGLITE_MODULE).href);
 const pg = new PGlite();
 try { await pg.exec(statements.join('\n')); }
 catch (error) { console.error(error.message, error.where || ''); process.exitCode = 1; }
 finally { await pg.close(); }
 if (process.exitCode) process.exit(process.exitCode);
 console.log('PASS isolated print authorization rehearsal (PGlite)');
 process.exit(0);
}
const child = spawn('psql',['-Xq','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55433','-U','staff_test','-d','onebiz_staff_access_test'],{
 env:{PATH:process.env.PATH,PGPASSWORD:'ephemeral-test-only',PGSSLMODE:'disable',PGCONNECT_TIMEOUT:'5'},stdio:['pipe','pipe','pipe']
});
let err=''; child.stderr.on('data',x=>err+=x);
const done = new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(err)));});
child.stdin.end(statements.join('\n'));
await done;
console.log('PASS real PostgreSQL: kitchen print permission, duplicate safety and branch isolation');
