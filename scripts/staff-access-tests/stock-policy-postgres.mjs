// Dedicated disposable CI PostgreSQL only. Fixture data is synthetic.
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { initializeStaffAccessFixture } from './fixture.mjs';
import { functionFromMigration } from './inventory.mjs';

if (process.env.STAFF_EPHEMERAL_DB !== 'onebiz_staff_access_test') throw new Error('Dedicated disposable database required');
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const statements=[];
const migration=async name=>readFile(new URL(`../../supabase/migrations/${name}`,import.meta.url),'utf8');
await initializeStaffAccessFixture({exec:async s=>statements.push(s)},id);
statements.push(await migration('20261111052704_staff_branch_access.sql'));
for(const [file,name] of [
 ['20261111070229_staff_branch_checkout_permissions.sql','_staff_permission_at_scope'],
 ['20261111095224_staff_branch_kitchen_permissions.sql','_staff_permission_any_branch'],
 ['20261112011209_staff_branch_inventory_lot_read.sql','_staff_my_inventory_view'],
 ['20261112121837_staff_inventory_global_revoke_guard.sql','_staff_lot_has_no_view_exception'],
 ['20261112121837_staff_inventory_global_revoke_guard.sql','_staff_inventory_row_visible'],
]) statements.push(await functionFromMigration(file,name));
statements.push(`
 create table disposal_exports(id uuid,tenant_id uuid,branch_id uuid,code text,status text,created_at timestamptz,updated_at timestamptz,created_by uuid,reason text,note text,total_amount numeric);
 create table products(id uuid,tenant_id uuid,code text);
 create table disposal_export_items(id uuid,disposal_id uuid,product_id uuid,product_name text,unit text,quantity numeric,unit_price numeric,total numeric,unit_cost numeric);
 create table internal_exports(id uuid,tenant_id uuid,branch_id uuid,code text,status text,created_at timestamptz,updated_at timestamptz,created_by uuid,department text,note text,total_amount numeric);
 create table internal_export_items(id uuid,export_id uuid,product_id uuid,product_name text,unit text,quantity numeric,unit_price numeric,total numeric);
 insert into disposal_exports values ('${id(200)}','${id(1)}','${id(10)}','A','draft',now(),now(),'${id(101)}',null,null,999),('${id(201)}','${id(1)}','${id(11)}','B','draft',now(),now(),'${id(101)}',null,null,888);
 insert into disposal_export_items values ('${id(300)}','${id(200)}',null,'Milk','box',2,333,666,333);
 alter table disposal_exports enable row level security;
 alter table disposal_export_items enable row level security;
 alter table internal_exports enable row level security;
 alter table internal_export_items enable row level security;
 alter function public.get_user_tenant_id() security definer;
 create policy disposal_legacy on disposal_exports for select to authenticated using (tenant_id=get_user_tenant_id());
 create policy internal_legacy on internal_exports for select to authenticated using (tenant_id=get_user_tenant_id());
 create policy disposal_scope on disposal_exports as restrictive for select to authenticated using (_staff_inventory_row_visible(branch_id));
 create policy internal_scope on internal_exports as restrictive for select to authenticated using (_staff_inventory_row_visible(branch_id));
 create policy disposal_item on disposal_export_items for select to authenticated using (exists(select 1 from disposal_exports d where d.id=disposal_id));
 create policy internal_item on internal_export_items for select to authenticated using (exists(select 1 from internal_exports d where d.id=export_id));
 grant usage on schema public,auth to authenticated;
 grant select on disposal_exports,disposal_export_items,internal_exports,internal_export_items to authenticated;
 insert into staff_branch_permission_catalog values ('inventory.dispose',1),('inventory.internal_export',1),('inventory.view',1);
 insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
  values ('${id(1)}','${id(101)}','${id(10)}','inventory.dispose','grant','${id(100)}');
 select set_config('request.jwt.claim.sub','${id(101)}',false);
`);
for(const [file,name] of [['00315_disposal_export_list_workspace.sql','get_disposal_export_list_workspace'],['00316_warehouse_list_workspaces_batch.sql','get_internal_export_list_workspace']])
 statements.push(await functionFromMigration(file,name));
statements.push(await migration('20261112162406_staff_stock_work_documents_safe_projection.sql'));
statements.push(await migration('20261112165047_staff_stock_work_cost_column_protection.sql'));
statements.push(`
 set role authenticated;
 do $$declare d jsonb; l jsonb; begin
  if has_table_privilege('authenticated','public.disposal_exports','select') or
     not has_column_privilege('authenticated','public.disposal_exports','id','select') or
     has_column_privilege('authenticated','public.disposal_exports','total_amount','select') or
     has_column_privilege('authenticated','public.disposal_export_items','unit_cost','select')
  then raise exception 'incorrect protected column grants'; end if;
  d:=public.get_stock_work_document_detail('disposal_export','${id(200)}');
  l:=public.get_stock_work_document_list('disposal_export');
  if d->>'code'<>'A' or d ? 'totalAmount' or d->'items'->0 ? 'unitPrice' or
     (l->>'total')::int<>1 or (l->>'costVisible')::boolean or l->'items'->0->'total_amount'<>'null'::jsonb
  then raise exception 'work document scope or cost masking failed'; end if;
  begin perform public.get_stock_work_document_detail('disposal_export','${id(201)}'); raise exception 'other branch visible';
   exception when insufficient_privilege then null; end;
  begin perform public.get_disposal_export_list_workspace(); raise exception 'old client saw masked value as real';
   exception when insufficient_privilege then null; end;
 end$$;
 reset role;
 delete from user_permission_overrides where user_id='${id(101)}' and permission_code='products.view_cost';
 insert into role_permissions values ('${id(20)}','products.view_cost');
 set role authenticated;
 do $$declare d jsonb; legacy jsonb; begin
  d:=public.get_stock_work_document_detail('disposal_export','${id(200)}');
  if (d->>'totalAmount')::numeric<>999 or (d->'items'->0->>'unitPrice')::numeric<>333 then raise exception 'authorized cost missing'; end if;
  legacy:=public.get_disposal_export_list_workspace();
  if not (legacy->>'costVisible')::boolean or (legacy->'items'->0->>'total_amount')::numeric<>999 then raise exception 'legacy cost-enabled reader lost data'; end if;
  if has_column_privilege('authenticated','public.disposal_exports','total_amount','select') then raise exception 'cost exposed through raw table'; end if;
 end$$;
 reset role;
`);
statements.push(await functionFromMigration('20261112104123_staff_inventory_direct_stock_scope.sql','_staff_inventory_movement_visible'));
statements.push(`
 create table stock_movements(id uuid,tenant_id uuid,branch_id uuid,unit_cost numeric);
 insert into stock_movements values ('${id(400)}','${id(1)}','${id(10)}',10),('${id(401)}','${id(1)}','${id(11)}',20),('${id(402)}','${id(2)}','${id(12)}',30);
 insert into user_branches values ('${id(101)}','${id(11)}',null);
 insert into role_permissions values ('${id(20)}','inventory.view');
 alter function public.user_has_branch_access(uuid,uuid) security definer;
 alter table stock_movements enable row level security;
 create policy movement_legacy on stock_movements for select to authenticated using
  (tenant_id=get_user_tenant_id() and user_has_branch_access(auth.uid(),branch_id));
 grant select(id,tenant_id,branch_id) on stock_movements to authenticated;
`);
statements.push(await migration('20261113063835_staff_stock_movements_direct_scope.sql'));
statements.push(`
 set role authenticated;
 do $$begin if (select count(id) from stock_movements)<>2 then raise exception 'legacy raw movement access changed'; end if;
  if has_column_privilege('authenticated','public.stock_movements','unit_cost','select') then raise exception 'stock cost exposed'; end if; end$$;
 reset role;insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
  values ('${id(1)}','${id(101)}','${id(10)}','inventory.view','revoke','${id(100)}');set role authenticated;
 do $$begin if (select count(id) from stock_movements)<>1 then raise exception 'denied stock movement branch exposed'; end if; end$$;
 reset role;insert into role_permissions values ('${id(20)}','reports.analytics');set role authenticated;
 do $$begin if (select count(id) from stock_movements)<>2 then raise exception 'independent stock reporting lost'; end if; end$$;
 reset role;delete from role_permissions where permission_code in ('reports.analytics','inventory.view');
 update user_branch_permission_overrides set branch_id='${id(11)}',override_type='grant' where permission_code='inventory.view';set role authenticated;
 do $$begin if (select count(id) from stock_movements)<>1 then raise exception 'local stock grant scope mismatch'; end if; end$$;
 reset role;
 insert into user_permission_overrides(tenant_id,user_id,permission_code,override_type,created_by)
  values ('${id(1)}','${id(101)}','inventory.view','revoke','${id(100)}');set role authenticated;
 do $$begin if (select count(id) from stock_movements)<>0 then raise exception 'global stock revoke bypassed'; end if; end$$;
 reset role;delete from user_branch_permission_overrides where permission_code='inventory.view';set role authenticated;
 do $$begin if (select count(id) from stock_movements)<>0 then raise exception 'global-only stock revoke bypassed'; end if; end$$;
 reset role;
`);
if (process.env.ONEBIZ_PGLITE_MODULE) {
 const {PGlite}=await import(pathToFileURL(process.env.ONEBIZ_PGLITE_MODULE).href);
 const db=new PGlite();try { await db.exec(statements.join('\n')); } finally { await db.close(); }
 console.log('PASS local stock fixture rehearsal (PGlite)');process.exit(0);
}
const args=['-Xq','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55433','-U','staff_test','-d','onebiz_staff_access_test'];
const child=spawn('psql',args,{env:{PATH:process.env.PATH,PGPASSWORD:'ephemeral-test-only',PGSSLMODE:'disable',PGCONNECT_TIMEOUT:'5'},stdio:['pipe','pipe','pipe']});
let err='';child.stderr.on('data',x=>err+=x);child.stdout.resume();
const completed=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(err)));});
child.stdin.end(statements.join('\n'));await completed;
console.log('PASS real PostgreSQL: stock action scope, cost masking, column grants and legacy reader');
