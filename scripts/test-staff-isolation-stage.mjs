// Real legacy function and trigger bodies, synthetic data, disposable PostgreSQL only.
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
if (process.env.STAFF_ISOLATION_TEST_DB !== 'onebiz_isolation_test') throw new Error('Dedicated test database required');
const load = async path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
async function definition(path, name) {
  const content = await load(path);
  const start = content.search(new RegExp(`create(?: or replace)? function public\\.${name}\\s*\\(`, 'i'));
  if (start < 0) throw new Error(`Missing ${name}`);
  const tail = content.slice(start);
  const marker = /\bas\s+(\$[a-z_]*\$)/i.exec(tail);
  const end = marker && tail.indexOf(marker[1], marker.index + marker[0].length);
  if (!marker || end < 0) throw new Error(`Missing body ${name}`);
  return `${tail.slice(0, end + marker[1].length)};`;
}
const sql = [];
sql.push(`
 create role anon; create role authenticated; create role service_role;
 create schema auth; create schema extensions;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
 create table profiles(id uuid,tenant_id uuid,role text,is_active boolean);
 create function user_has_permission(uid uuid, code text) returns boolean language sql security definer as $$select exists(select 1 from profiles where id=uid and is_active)$$;
 create table products(id uuid,tenant_id uuid,code text,name text,stock numeric);
 create table branches(id uuid,tenant_id uuid,name text);
 create table branch_stock(tenant_id uuid,branch_id uuid,product_id uuid,variant_id uuid,quantity numeric);
 create table stock_movements(tenant_id uuid,branch_id uuid,product_id uuid,type text,quantity numeric);
 create table product_lots(tenant_id uuid,branch_id uuid,product_id uuid,status text,current_qty numeric);
 create table customers(id uuid primary key,last_purchase_at timestamptz,updated_at timestamptz);
 create table invoices(id uuid,tenant_id uuid,branch_id uuid,customer_id uuid,status text,created_at timestamptz default now());
 grant usage on schema public,auth to authenticated,service_role;
 insert into profiles values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','owner',true),
 ('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','staff',true),
 ('10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','staff',false);
`);
sql.push(await definition('supabase/migrations/00513_inventory_operational_read_projections.sql','verify_stock_invariants'));
sql.push(await definition('supabase/migrations/00131_customer_segmentation.sql','recompute_customer_last_purchase'));
sql.push(await definition('supabase/migrations/00131_customer_segmentation.sql','trg_sync_customer_last_purchase'));
sql.push(`
 revoke all on function public.verify_stock_invariants(uuid,numeric),public.recompute_customer_last_purchase(uuid) from public;
 grant execute on function public.verify_stock_invariants(uuid,numeric),public.recompute_customer_last_purchase(uuid) to authenticated,service_role;
 create trigger trg_invoices_sync_last_purchase after insert or update of customer_id,status,created_at or delete on invoices for each row execute function public.trg_sync_customer_last_purchase();
 create function test_checkout() returns void language sql security definer set search_path=public as $$insert into invoices(id,tenant_id,branch_id,customer_id,status) values ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','completed')$$;
 grant execute on function test_checkout() to authenticated;
`);
sql.push(await load('supabase/migrations/20261113095915_staff_stock_invariant_tenant_scope.sql'));
sql.push(await load('supabase/migrations/20261113101200_staff_customer_purchase_trigger_scope.sql'));
sql.push(`
 insert into customers(id) values ('50000000-0000-0000-0000-000000000001');
 select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
 select set_config('request.jwt.claim.role','authenticated',false);
 set role authenticated;
 do $$declare denied boolean:=false; r jsonb;begin
  r:=public.verify_stock_invariants('20000000-0000-0000-0000-000000000001',0.01);
  if r->>'tenant_id'<>'20000000-0000-0000-0000-000000000001' then raise exception 'own tenant unavailable';end if;
  begin perform public.verify_stock_invariants('20000000-0000-0000-0000-000000000002',0.01);
  exception when raise_exception then if sqlerrm='PERMISSION_DENIED' then denied:=true;else raise;end if;end;
  if not denied then raise exception 'cross-tenant inventory accessible to owner';end if;
  if has_function_privilege('authenticated','public.recompute_customer_last_purchase(uuid)','execute') then raise exception 'helper directly callable';end if;
  perform public.test_checkout();
 end$$;
 reset role;
 do $$begin if (select last_purchase_at from customers where id='50000000-0000-0000-0000-000000000001') is null then raise exception 'checkout trigger failed';end if;
  if not has_function_privilege('service_role','public.recompute_customer_last_purchase(uuid)','execute') then raise exception 'service role helper lost';end if;end$$;
 select set_config('request.jwt.claim.sub','',false); select set_config('request.jwt.claim.role','service_role',false);
 set role service_role;
 do $$begin if public.verify_stock_invariants('20000000-0000-0000-0000-000000000002',0.01)->>'tenant_id'<>'20000000-0000-0000-0000-000000000002' then raise exception 'service role maintenance lost';end if;end$$;
 reset role;
 select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',false); select set_config('request.jwt.claim.role','authenticated',false);
 set role authenticated;
 do $$declare denied boolean:=false;begin
  begin perform public.verify_stock_invariants('20000000-0000-0000-0000-000000000001',0.01);
  exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'inactive staff got inventory integrity';end if;
 end$$;
`);
const child = spawn('psql',['-Xq','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55433','-U','staff_test','-d','onebiz_isolation_test'],{env:{PATH:process.env.PATH,PGPASSWORD:'ephemeral-test-only',PGSSLMODE:'disable',PGCONNECT_TIMEOUT:'5'},stdio:['pipe','pipe','pipe']});
let error='';child.stderr.on('data',data=>error+=data);child.stdout.resume();
const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(error)));});
child.stdin.end(sql.join('\n'));await done;console.log('PASS PostgreSQL tenant isolation, checkout trigger, service-role and inactive staff');
