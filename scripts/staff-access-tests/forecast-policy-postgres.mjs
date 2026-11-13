// Only the explicitly named disposable PostgreSQL service is allowed.
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {initializeStaffAccessFixture} from './fixture.mjs';
import {functionFromMigration} from './inventory.mjs';
if(process.env.STAFF_EPHEMERAL_DB!=='onebiz_staff_access_test')throw new Error('Dedicated disposable database required');
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const sql=[];const migration=async name=>readFile(new URL(`../../supabase/migrations/${name}`,import.meta.url),'utf8');
await initializeStaffAccessFixture({exec:async s=>sql.push(s)},id);
sql.push(await migration('20261111052704_staff_branch_access.sql'));
sql.push(await functionFromMigration('20261111070229_staff_branch_checkout_permissions.sql','_staff_permission_at_scope'));
sql.push(`
 create table invoices(id uuid primary key,tenant_id uuid,branch_id uuid,source text,status text,deleted_at timestamptz,voided_at timestamptz,cancelled_at timestamptz,fulfilled_by_id uuid,source_order_id uuid);
 create table invoice_items(id uuid,invoice_id uuid,product_id uuid,quantity numeric,total numeric);
 create table sales_order_processing_closures(order_id uuid,tenant_id uuid,closed_at timestamptz);
 create function public.can_read_branch_document_00567(t uuid,b uuid) returns boolean language sql stable security definer as $$
  select t=public.get_user_tenant_id() and (public.user_has_branch_access(auth.uid(),b) or public.user_has_permission(auth.uid(),'reports.view_all_branches')) $$;
 insert into invoices values
  ('${id(200)}','${id(1)}','${id(10)}','order','draft',null,null,null,null,null),
  ('${id(201)}','${id(1)}','${id(10)}','pos','completed',null,null,null,null,'${id(200)}'),
  ('${id(202)}','${id(1)}','${id(10)}','pos','cancelled',null,null,null,null,'${id(200)}'),
  ('${id(203)}','${id(2)}','${id(12)}','order','draft',null,null,null,null,null);
 insert into invoice_items values ('${id(300)}','${id(200)}','${id(400)}',10,1000),('${id(301)}','${id(201)}','${id(400)}',3,300),('${id(302)}','${id(202)}','${id(400)}',5,500);
 alter table invoices add column created_at timestamptz default now(),add column customer_id uuid;
 update invoices set customer_id='${id(500)}' where id='${id(200)}';
 insert into staff_branch_permission_catalog values ('inventory.create_po',1);
 insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
  values ('${id(1)}','${id(101)}','${id(10)}','inventory.create_po','grant','${id(100)}');
 grant usage on schema public,auth to authenticated;
 select set_config('request.jwt.claim.sub','${id(101)}',false);
`);
sql.push(await migration('20261112174832_staff_purchase_forecast_scoped_lines.sql'));
sql.push(await migration('20261112175958_staff_purchase_forecast_scoped_orders.sql'));
sql.push(`
 set role authenticated;
 do $$declare r jsonb; h jsonb; begin
  h:=public.get_purchase_forecast_order_headers(null,null,null,array['${id(500)}'::uuid],0,200);
  if (h->>'total')::int<>1 or h->'items'->0->>'id'<>'${id(200)}' then raise exception 'forecast order headers not scoped'; end if;
  if (public.get_purchase_forecast_order_headers(null,null,null,array['${id(501)}'::uuid],0,200)->>'total')::int<>0 then raise exception 'customer filter ignored'; end if;
  r:=public.get_purchase_forecast_remaining_lines(array['${id(200)}'::uuid]);
  if jsonb_array_length(r)<>1 or (r->0->>'orderedQuantity')::numeric<>10 or
   (r->0->>'issuedQuantity')::numeric<>3 or (r->0->>'remainingQuantity')::numeric<>7 or
   (r->0->>'remainingAmount')::numeric<>700 then raise exception 'incorrect remaining demand'; end if;
  if has_table_privilege('authenticated','public.invoice_items','select') then raise exception 'raw invoice access granted'; end if;
  begin perform public.get_purchase_forecast_remaining_lines(array['${id(200)}'::uuid,'${id(203)}'::uuid]);
   raise exception 'mixed tenant batch was accepted'; exception when insufficient_privilege then null; end;
 end$$;
 reset role;
 update invoices set branch_id='${id(11)}' where id='${id(201)}'; set role authenticated;
 do $$begin begin perform public.get_purchase_forecast_remaining_lines(array['${id(200)}'::uuid]);
  raise exception 'inaccessible child was silently ignored'; exception when insufficient_privilege then null; end; end$$;
 reset role;
 insert into user_branches values ('${id(101)}','${id(11)}',null);
 insert into user_permission_overrides(tenant_id,user_id,permission_code,override_type,created_by)
  values ('${id(1)}','${id(101)}','inventory.create_po','revoke','${id(100)}'); set role authenticated;
 do $$begin begin perform public.get_purchase_forecast_remaining_lines(array['${id(200)}'::uuid]);
  raise exception 'local grant bypassed global revoke'; exception when insufficient_privilege then null; end; end$$;
 reset role;
`);
if(process.env.ONEBIZ_PGLITE_MODULE){const {PGlite}=await import(pathToFileURL(process.env.ONEBIZ_PGLITE_MODULE).href);const db=new PGlite();try{await db.exec(sql.join('\n'));}finally{await db.close();}console.log('PASS local forecast fixture rehearsal (PGlite)');process.exit(0);}
const args=['-Xq','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55433','-U','staff_test','-d','onebiz_staff_access_test'];
const child=spawn('psql',args,{env:{PATH:process.env.PATH,PGPASSWORD:'ephemeral-test-only',PGSSLMODE:'disable',PGCONNECT_TIMEOUT:'5'},stdio:['pipe','pipe','pipe']});
let err='';child.stderr.on('data',x=>err+=x);child.stdout.resume();
const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(err)));});
child.stdin.end(sql.join('\n'));await done;console.log('PASS real PostgreSQL: forecast math, purchasing scope and inaccessible-child failure');
