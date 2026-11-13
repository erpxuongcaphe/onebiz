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
// Production branches have a code column: exercise PL/pgSQL name resolution
// against the real schema shape rather than a simplified fixture.
statements.push('alter table public.branches add column code text;');
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
statements.push(await migration('20261114010000_stock_work_list_code_ambiguity.sql'));
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
statements.push(`
 create table inventory_opening_batches(id uuid,tenant_id uuid,branch_id uuid);
 insert into inventory_opening_batches values ('${id(510)}','${id(1)}','${id(10)}'),('${id(511)}','${id(1)}','${id(11)}'),('${id(512)}','${id(2)}','${id(12)}');
 insert into staff_branch_permission_catalog values ('inventory.adjust',1);
 insert into role_permissions values ('${id(20)}','inventory.adjust');
 alter table inventory_opening_batches enable row level security;
 create policy inventory_opening_batches_read on inventory_opening_batches for select to authenticated using
  (tenant_id=(select p.tenant_id from profiles p where p.id=auth.uid() and coalesce(p.is_active,true))
   and user_has_branch_access(auth.uid(),branch_id) and user_has_permission(auth.uid(),'inventory.adjust'));
 grant select on inventory_opening_batches,profiles to authenticated;
 alter function public.user_has_permission(uuid,text) security definer;
`);
statements.push(await migration('20261113070604_staff_inventory_opening_batch_scope.sql'));
statements.push(`
 set role authenticated;
 do $$begin if (select count(*) from inventory_opening_batches)<>2 then raise exception 'legacy opening read changed';end if;end$$;
 reset role;insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
  values ('${id(1)}','${id(101)}','${id(10)}','inventory.adjust','revoke','${id(100)}');set role authenticated;
 do $$begin if (select count(*) from inventory_opening_batches)<>1 then raise exception 'opening denied branch exposed';end if;end$$;
 reset role;delete from role_permissions where permission_code='inventory.adjust';
 update user_branch_permission_overrides set branch_id='${id(11)}',override_type='grant' where permission_code='inventory.adjust';set role authenticated;
 do $$begin if (select count(*) from inventory_opening_batches)<>1 then raise exception 'opening local-only grant failed';end if;end$$;
 reset role;insert into user_permission_overrides(tenant_id,user_id,permission_code,override_type,created_by)
  values ('${id(1)}','${id(101)}','inventory.adjust','revoke','${id(100)}');set role authenticated;
 do $$begin if (select count(*) from inventory_opening_batches)<>0 then raise exception 'opening global revoke bypassed';end if;end$$;
 reset role;delete from user_permission_overrides where permission_code='inventory.adjust';
 insert into role_permissions values ('${id(20)}','inventory.adjust');update profiles set is_active=false where id='${id(101)}';set role authenticated;
 do $$begin if (select count(*) from inventory_opening_batches)<>0 then raise exception 'inactive account retained opening access';end if;end$$;
 reset role;
`);
statements.push(await functionFromMigration('20261112072555_staff_branch_invoice_order_view_consumers.sql','_staff_my_document_view'));
statements.push(await functionFromMigration('20261112172924_staff_invoice_item_view_scope.sql','_staff_invoice_item_read'));
statements.push(`
 update profiles set is_active=true where id='${id(101)}';
 delete from user_permission_overrides where user_id='${id(101)}' and permission_code in ('inventory.view','orders.view');
 delete from user_branch_permission_overrides where user_id='${id(101)}' and permission_code in ('inventory.view','orders.view');
 insert into role_permissions values ('${id(20)}','inventory.view'),('${id(20)}','orders.view');
 insert into staff_branch_permission_catalog values ('orders.view',1);
 create function public._can_read_branch_inventory_00476(u uuid,t uuid,b uuid) returns boolean language sql stable security definer set search_path=public
  as $$select t=get_user_tenant_id() and user_has_branch_access(u,b)$$;
 create table internal_sale_receipts(id uuid,tenant_id uuid,branch_id uuid);
 create table operational_uom_requests(id uuid,tenant_id uuid,branch_id uuid,to_branch_id uuid,reference_type text);
 create table purchase_orders(id uuid,tenant_id uuid,branch_id uuid);
 create table invoices(id uuid,tenant_id uuid,branch_id uuid,source text default 'order');
 create table fnb_purchase_sales_order_links(id uuid,tenant_id uuid,purchase_order_id uuid,sales_order_id uuid);
 create table warehouse_order_quantity_adjustments(id uuid,order_id uuid);
 insert into internal_sale_receipts values ('${id(610)}','${id(1)}','${id(10)}'),('${id(611)}','${id(1)}','${id(11)}');
 insert into operational_uom_requests values ('${id(620)}','${id(1)}','${id(10)}','${id(11)}','transfer'),('${id(621)}','${id(1)}','${id(10)}','${id(10)}','transfer'),('${id(622)}','${id(1)}','${id(11)}',null,'purchase');
 insert into purchase_orders values ('${id(630)}','${id(1)}','${id(10)}'),('${id(631)}','${id(1)}','${id(11)}');
 insert into invoices(id,tenant_id,branch_id) values ('${id(640)}','${id(1)}','${id(10)}'),('${id(641)}','${id(1)}','${id(11)}');
 insert into fnb_purchase_sales_order_links values ('${id(650)}','${id(1)}','${id(630)}','${id(641)}'),('${id(651)}','${id(1)}','${id(630)}','${id(640)}'),('${id(652)}','${id(1)}','${id(631)}','${id(640)}'),('${id(653)}','${id(2)}','${id(631)}','${id(641)}');
 insert into warehouse_order_quantity_adjustments values ('${id(660)}','${id(640)}'),('${id(661)}','${id(641)}');
 alter table invoices enable row level security;
 create policy invoice_legacy on invoices for select to authenticated using
  (tenant_id=get_user_tenant_id() and user_has_branch_access(auth.uid(),branch_id));
 alter table internal_sale_receipts enable row level security;alter table operational_uom_requests enable row level security;
 alter table fnb_purchase_sales_order_links enable row level security;alter table warehouse_order_quantity_adjustments enable row level security;
 create policy receipts_read_scope on internal_sale_receipts for select to authenticated using
  (tenant_id=get_user_tenant_id() and user_has_permission(auth.uid(),'inventory.view') and user_has_branch_access(auth.uid(),branch_id));
 create policy operational_uom_read on operational_uom_requests for select to authenticated using
  (user_has_permission(auth.uid(),'inventory.view') and (_can_read_branch_inventory_00476(auth.uid(),tenant_id,branch_id)
   or (reference_type='transfer' and _can_read_branch_inventory_00476(auth.uid(),tenant_id,to_branch_id))));
 create policy fnb_order_link_read on fnb_purchase_sales_order_links for select to authenticated using
  (tenant_id=get_user_tenant_id() and (exists(select 1 from purchase_orders p where p.id=purchase_order_id and user_has_branch_access(auth.uid(),p.branch_id) and user_has_permission(auth.uid(),'inventory.view'))
   or exists(select 1 from invoices i where i.id=sales_order_id and user_has_branch_access(auth.uid(),i.branch_id) and user_has_permission(auth.uid(),'orders.view'))));
 create policy warehouse_order_adjustments_read on warehouse_order_quantity_adjustments for select to authenticated using
  (exists(select 1 from invoices i where i.id=order_id and i.tenant_id=get_user_tenant_id() and user_has_branch_access(auth.uid(),i.branch_id) and user_has_permission(auth.uid(),'orders.view')));
 grant select on internal_sale_receipts,operational_uom_requests,fnb_purchase_sales_order_links,warehouse_order_quantity_adjustments,purchase_orders,invoices to authenticated;
`);
statements.push(await migration('20261113065814_staff_invoice_header_branch_scope.sql'));
statements.push(await migration('20261113071036_staff_inventory_linked_policy_scope.sql'));
statements.push(`
 set role authenticated;
 do $$begin if (select count(*) from internal_sale_receipts)<>2 or (select count(*) from operational_uom_requests)<>3
  or (select count(*) from fnb_purchase_sales_order_links)<>3 or (select count(*) from warehouse_order_quantity_adjustments)<>2
  then raise exception 'legacy linked inventory access changed';end if;end$$;
 reset role;insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values
  ('${id(1)}','${id(101)}','${id(10)}','inventory.view','revoke','${id(100)}'),
  ('${id(1)}','${id(101)}','${id(10)}','orders.view','revoke','${id(100)}');set role authenticated;
 do $$begin if (select count(*) from internal_sale_receipts)<>1 or (select count(*) from operational_uom_requests)<>2
  or (select count(*) from fnb_purchase_sales_order_links)<>2 or (select count(*) from warehouse_order_quantity_adjustments)<>1
  then raise exception 'linked branch exception or two-sided transfer scope failed';end if;end$$;
 reset role;delete from role_permissions where permission_code in ('inventory.view','orders.view');
 update user_branch_permission_overrides set branch_id='${id(11)}',override_type='grant' where permission_code in ('inventory.view','orders.view');set role authenticated;
 do $$begin if (select count(*) from internal_sale_receipts)<>1 or (select count(*) from operational_uom_requests)<>2
  or (select count(*) from fnb_purchase_sales_order_links)<>2 or (select count(*) from warehouse_order_quantity_adjustments)<>1
  then raise exception 'linked local grants failed';end if;end$$;
 reset role;insert into user_permission_overrides(tenant_id,user_id,permission_code,override_type,created_by)
  values ('${id(1)}','${id(101)}','inventory.view','revoke','${id(100)}');set role authenticated;
 do $$begin if (select count(*) from internal_sale_receipts)<>0 or (select count(*) from operational_uom_requests)<>0
  or (select count(*) from fnb_purchase_sales_order_links)<>1 or (select count(*) from warehouse_order_quantity_adjustments)<>1
  then raise exception 'global revoke or independent order access failed';end if;end$$;
 reset role;
`);
// Exercise the real legacy reconciliation function through the migration.
statements.push(`create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;`);
statements.push(await functionFromMigration('00513_inventory_operational_read_projections.sql','verify_stock_invariants'));
statements.push(await migration('20261113095915_staff_stock_invariant_tenant_scope.sql'));
statements.push(`
 select set_config('request.jwt.claim.sub','${id(100)}',false);
 set role authenticated;
 do $$declare denied boolean:=false;begin
  begin perform public.verify_stock_invariants('${id(2)}',0.01);
  exception when raise_exception then if sqlerrm='PERMISSION_DENIED' then denied:=true;else raise;end if;end;
  if not denied then raise exception 'owner accessed another tenant stock reconciliation';end if;
 end$$;
 reset role;
`);
if (process.env.ONEBIZ_PGLITE_MODULE) {
 const {PGlite}=await import(pathToFileURL(process.env.ONEBIZ_PGLITE_MODULE).href);
 const db=new PGlite();try { await db.exec(statements.join('\n')); } finally { await db.close(); }
 console.log('PASS local stock fixture rehearsal (PGlite)');process.exit(0);
}
const args=['-Xq','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',process.env.STAFF_TEST_PG_PORT ?? '55433','-U','staff_test','-d','onebiz_staff_access_test'];
const child=spawn('psql',args,{env:{PATH:process.env.PATH,PGPASSWORD:'ephemeral-test-only',PGSSLMODE:'disable',PGCONNECT_TIMEOUT:'5'},stdio:['pipe','pipe','pipe']});
let err='';child.stderr.on('data',x=>err+=x);child.stdout.resume();
const completed=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(err)));});
child.stdin.end(statements.join('\n'));await completed;
console.log('PASS real PostgreSQL: stock action scope, cost masking, column grants and legacy reader');
