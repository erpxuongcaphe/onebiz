// Disposable database only; no production connection or customer data.
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
if (process.env.STAFF_EPHEMERAL_DB !== 'onebiz_staff_access_test') throw new Error('Dedicated disposable database required');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const migration = await readFile(new URL('../supabase/migrations/20261113041930_staff_return_reader_bridge.sql', import.meta.url), 'utf8');
const setup = `
 create role anon; create role authenticated; create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.profiles(id uuid primary key,tenant_id uuid,role text,is_active boolean);
 create table public.user_branches(user_id uuid,branch_id uuid);
 create table public.permissions(user_id uuid,code text);
 create table public.invoices(id uuid primary key,tenant_id uuid,branch_id uuid,source text,status text,created_by uuid);
 create table public.invoice_items(id uuid,invoice_id uuid,product_id uuid,product_name text,unit text,quantity numeric,unit_price numeric,total numeric,returned_qty numeric);
 create function public.user_has_branch_access(u uuid,b uuid) returns boolean language sql stable as $$select exists(select 1 from public.user_branches where user_id=u and branch_id=b)$$;
 create function public.user_has_permission(u uuid,c text) returns boolean language sql stable as $$select exists(select 1 from public.permissions where user_id=u and code=c)$$;
 insert into public.profiles values ('${id(10)}','${id(1)}','staff',true),('${id(11)}','${id(2)}','staff',true);
 insert into public.user_branches values ('${id(10)}','${id(20)}');
 insert into public.permissions values ('${id(10)}','pos_fnb.view_orders'),('${id(10)}','orders.view_own_only');
 insert into public.invoices values
  ('${id(30)}','${id(1)}','${id(20)}','order','completed','${id(10)}'),
  ('${id(31)}','${id(1)}','${id(20)}','order','completed','${id(12)}'),
  ('${id(32)}','${id(2)}','${id(20)}','pos','completed','${id(11)}'),
  ('${id(33)}','${id(1)}','${id(21)}','pos','completed','${id(10)}'),
  ('${id(34)}','${id(1)}','${id(20)}','fnb','completed','${id(10)}'),
  ('${id(35)}','${id(1)}','${id(20)}','pos','draft','${id(10)}');
 insert into public.invoice_items(id,invoice_id,quantity,total,returned_qty) values
  ('${id(40)}','${id(30)}',2,100,1),('${id(41)}','${id(34)}',1,20,0);
 grant usage on schema public,auth to authenticated;
 select set_config('request.jwt.claim.sub','${id(10)}',false);
`;
const checks = `
 set role authenticated;
 do $$begin
  if has_function_privilege('anon','public.staff_returnable_invoice_items(uuid)','execute') then raise exception 'anon execute';end if;
  if (select returned_qty from public.staff_returnable_invoice_items('${id(30)}'))<>1 then raise exception 'own return mismatch';end if;
  begin perform public.staff_returnable_invoice_items('${id(31)}');raise exception 'other order exposed';exception when insufficient_privilege then if sqlerrm<>'RETURN_READ_DENIED' then raise;end if;end;
  begin perform public.staff_returnable_invoice_items('${id(32)}');raise exception 'foreign tenant exposed';exception when insufficient_privilege then if sqlerrm<>'RETURN_READ_DENIED' then raise;end if;end;
  begin perform public.staff_returnable_invoice_items('${id(33)}');raise exception 'foreign branch exposed';exception when insufficient_privilege then if sqlerrm<>'RETURN_READ_DENIED' then raise;end if;end;
  begin perform public.staff_returnable_invoice_items('${id(34)}');raise exception 'FNB checkout missing';exception when insufficient_privilege then if sqlerrm<>'RETURN_READ_DENIED' then raise;end if;end;
  begin perform public.staff_returnable_invoice_items('${id(35)}');raise exception 'draft allowed';exception when invalid_parameter_value then if sqlerrm<>'INVOICE_NOT_COMPLETED' then raise;end if;end;
 end$$;
 reset role;insert into public.permissions values ('${id(10)}','pos_fnb.checkout');set role authenticated;
 do $$begin if (select count(*) from public.staff_returnable_invoice_items('${id(34)}'))<>1 then raise exception 'FNB return blocked';end if;end$$;
 reset role;update public.profiles set is_active=false where id='${id(10)}';set role authenticated;
 do $$begin begin perform public.staff_returnable_invoice_items('${id(34)}');raise exception 'inactive allowed';exception when insufficient_privilege then if sqlerrm<>'RETURN_READ_DENIED' then raise;end if;end;end$$;
`;
const scopedSetup = `
 reset role;
 create function public._staff_permission_at_scope(uuid,text,uuid) returns boolean language sql as $$select false$$;
 create or replace function public.staff_returnable_invoice_items(p_invoice_id uuid)
 returns table(id uuid,product_id uuid,product_name text,unit text,quantity numeric,unit_price numeric,total numeric,returned_qty numeric)
 language plpgsql as $$begin raise exception 'SCOPED_READER_KEPT';end$$;
`;
const scopedCheck = `
 set role authenticated;
 do $$begin
  begin perform public.staff_returnable_invoice_items('${id(30)}');raise exception 'bridge downgraded reader';
  exception when raise_exception then if sqlerrm<>'SCOPED_READER_KEPT' then raise;end if;end;
 end$$;
`;
const input = `${setup}\n${migration}\n${migration}\n${checks}\n${scopedSetup}\n${migration}\n${scopedCheck}`;
if (process.env.ONEBIZ_PGLITE_MODULE) {
 const { PGlite } = await import(pathToFileURL(process.env.ONEBIZ_PGLITE_MODULE).href);
 const db = new PGlite(); try { await db.exec(input); } finally { await db.close(); }
} else {
 const p = spawn('psql',['-Xq','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55433','-U','staff_test','-d','onebiz_staff_access_test'],{env:{PATH:process.env.PATH,PGPASSWORD:'ephemeral-test-only',PGSSLMODE:'disable',PGCONNECT_TIMEOUT:'5'},stdio:['pipe','pipe','pipe']});
 let errors=''; p.stderr.on('data', x => errors += x); p.stdout.resume();
 const done = new Promise((resolve,reject) => { p.on('error',reject); p.on('close',code => code===0 ? resolve() : reject(new Error(errors))); });
 p.stdin.end(input); await done;
}
console.log('PASS additive return reader: permissions, tenant, branch, own-only, status, inactive and repeat');
