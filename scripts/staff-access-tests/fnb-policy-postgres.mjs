// Dedicated disposable CI PostgreSQL only; never points at a user database.
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { initializeStaffAccessFixture } from './fixture.mjs';
import { functionFromMigration } from './inventory.mjs';

if (process.env.STAFF_EPHEMERAL_DB !== 'onebiz_staff_access_test') throw new Error('Dedicated disposable database required');
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const statements=[];
await initializeStaffAccessFixture({exec:async s=>statements.push(s)},id);
for(const name of ['20261111052704_staff_branch_access.sql'])
 statements.push(await readFile(new URL(`../../supabase/migrations/${name}`,import.meta.url),'utf8'));
statements.push(await functionFromMigration('20261111070229_staff_branch_checkout_permissions.sql','_staff_permission_at_scope'));
statements.push(await functionFromMigration('20261111095224_staff_branch_kitchen_permissions.sql','_staff_permission_any_branch'));
statements.push(`
 create table kitchen_order_items(id uuid primary key,kitchen_order_id uuid);
 insert into kitchen_order_items values ('${id(40)}','${id(30)}'),('${id(41)}','${id(31)}');
 alter table kitchen_orders enable row level security;
 alter table kitchen_order_items enable row level security;
 alter function public.get_user_tenant_id() security definer;
 create policy legacy_order on kitchen_orders for select to authenticated using (tenant_id=public.get_user_tenant_id());
 create policy legacy_items on kitchen_order_items for select to authenticated using (true);
 grant usage on schema public,auth to authenticated;
 grant select on kitchen_orders,kitchen_order_items to authenticated;
 delete from role_permissions where permission_code='pos_fnb.split_bill';
 insert into role_permissions values ('${id(20)}','pos_fnb.view_orders');
 select set_config('request.jwt.claim.sub','${id(101)}',false);
`);
for(const name of ['20261112065630_staff_branch_fnb_view_direct_reads.sql','20261112122122_staff_fnb_view_global_revoke_guard.sql','20261112165952_staff_fnb_legacy_branch_read_guard.sql'])
 statements.push(await readFile(new URL(`../../supabase/migrations/${name}`,import.meta.url),'utf8'));
statements.push(`
 set role authenticated;
 do $$begin
  if (select count(*) from kitchen_orders)<>1 or (select count(*) from kitchen_order_items)<>1 then raise exception 'unassigned branch was visible'; end if;
 end$$;
 reset role;
 insert into role_permissions values ('${id(20)}','reports.view_all_branches');
 set role authenticated;
 do $$begin if (select count(*) from kitchen_orders)<>2 then raise exception 'all-branch report scope was lost'; end if; end$$;
 reset role;
 delete from role_permissions where permission_code in ('reports.view_all_branches','pos_fnb.view_orders');
 insert into role_permissions values ('${id(20)}','pos_fnb.checkout');
 set role authenticated;
 do $$begin if (select count(*) from kitchen_orders)<>1 or (select count(*) from kitchen_order_items)<>1 then raise exception 'checkout lost assigned orders'; end if; end$$;
 reset role;
 delete from role_permissions where permission_code='pos_fnb.checkout';
 insert into role_permissions values ('${id(20)}','pos_fnb.view_sales_summary');
 set role authenticated;
 do $$begin if (select count(*) from kitchen_orders)<>0 or (select count(*) from kitchen_order_items)<>0 then raise exception 'summary permission exposed order details'; end if; end$$;
 reset role;
 delete from role_permissions where permission_code='pos_fnb.view_sales_summary';
 insert into staff_branch_permission_catalog values ('pos_fnb.view_orders',1);
 insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
  values('${id(1)}','${id(101)}','${id(10)}','pos_fnb.view_orders','grant','${id(100)}');
 insert into user_permission_overrides(tenant_id,user_id,permission_code,override_type,created_by)
  values('${id(1)}','${id(101)}','pos_fnb.view_orders','revoke','${id(100)}');
 set role authenticated;
 do $$begin if (select count(*) from kitchen_orders)<>0 then raise exception 'local grant bypassed global revoke'; end if; end$$;
 reset role;
 delete from user_permission_overrides where permission_code='pos_fnb.view_orders';
 delete from user_branch_permission_overrides where permission_code='pos_fnb.view_orders';
 insert into role_permissions values ('${id(20)}','pos_fnb.view_orders');
 update profiles set is_active=false where id='${id(101)}';
 set role authenticated;
 do $$begin if (select count(*) from kitchen_orders)<>0 then raise exception 'inactive account retained order access'; end if; end$$;
 reset role;
`);
statements.push(`
 alter table kitchen_orders add column invoice_id uuid;
 alter table kitchen_orders add column table_id uuid;
 alter table kitchen_orders add column status text,add column created_at timestamptz,add column updated_at timestamptz;
 alter table kitchen_orders add column order_type text,add column delivery_platform text;
 alter table kitchen_order_items add column product_name text,add column quantity numeric,add column unit_price numeric;
 create table invoices(id uuid primary key,tenant_id uuid,branch_id uuid,source text,status text,ngay_chung_tu timestamptz,total numeric);
 create table restaurant_tables(id uuid primary key,name text);
 create table sales_returns(id uuid primary key,tenant_id uuid,branch_id uuid,invoice_id uuid,status text,total numeric,created_at timestamptz);
 insert into restaurant_tables values ('${id(900)}','Table A'),('${id(901)}','Table B');
 create function public.can_read_branch_document_00567(t uuid,b uuid) returns boolean language sql stable security definer set search_path=public as $$select t=get_user_tenant_id() and (user_has_branch_access(auth.uid(),b) or user_has_permission(auth.uid(),'reports.view_all_branches'))$$;
 insert into invoices values
  ('${id(500)}','${id(1)}','${id(10)}','fnb','completed','2026-10-07 08:00Z',200),
  ('${id(501)}','${id(1)}','${id(11)}','fnb','completed','2026-10-07 08:00Z',300),
  ('${id(502)}','${id(2)}','${id(12)}','fnb','completed','2026-10-07 08:00Z',400),
  ('${id(503)}','${id(1)}','${id(10)}','fnb','cancelled','2026-10-07 08:00Z',999),
  ('${id(504)}','${id(1)}','${id(10)}','fnb','draft','2026-10-07 08:00Z',50);
 alter table invoices add column created_by uuid;
 update invoices set created_by=case when id='${id(501)}' then '${id(100)}'::uuid else '${id(101)}'::uuid end;
 insert into sales_returns values
  ('${id(510)}','${id(1)}','${id(10)}','${id(500)}','confirmed',30,'2026-10-07 08:00Z'),
  ('${id(511)}','${id(1)}','${id(11)}','${id(501)}','completed',60,'2026-10-07 08:00Z'),
  ('${id(512)}','${id(1)}','${id(10)}','${id(500)}','draft',999,'2026-10-07 08:00Z');
 update kitchen_orders set invoice_id=case id when '${id(30)}' then '${id(500)}'::uuid when '${id(31)}' then '${id(501)}'::uuid else '${id(502)}'::uuid end;
 update kitchen_orders set table_id=case when id='${id(31)}' then '${id(901)}'::uuid else '${id(900)}'::uuid end;
 update kitchen_orders set status='completed',created_at='2026-10-07 08:00Z',
  updated_at=case when id='${id(31)}' then '2026-10-07 08:40Z'::timestamptz else '2026-10-07 08:20Z'::timestamptz end;
 insert into kitchen_orders(id,tenant_id,branch_id,invoice_id) values ('${id(33)}','${id(1)}','${id(10)}','${id(503)}');
 insert into kitchen_orders(id,tenant_id,branch_id,invoice_id,table_id) values ('${id(34)}','${id(1)}','${id(10)}','${id(500)}','${id(900)}');
 update kitchen_orders set order_type='delivery',delivery_platform='Grab' where id in ('${id(30)}','${id(31)}','${id(34)}');
 update kitchen_order_items set product_name='Coffee',quantity=2,unit_price=100 where id='${id(40)}';
 update kitchen_order_items set product_name='Coffee',quantity=1,unit_price=300 where id='${id(41)}';
 insert into kitchen_order_items values ('${id(42)}','${id(33)}','Coffee',10,999);
 alter table kitchen_order_items add column modifier_selections jsonb;
 update kitchen_order_items set modifier_selections='[{"groupId":"sugar","groupName":"Sugar","options":[{"optionId":"less","label":"Less","priceDelta":5}]}]'::jsonb
  where id in ('${id(40)}','${id(41)}','${id(42)}');
 update profiles set is_active=true where id='${id(101)}';
 delete from role_permissions where role_id='${id(20)}';
 insert into role_permissions values ('${id(20)}','reports.fnb');
`);
statements.push(await readFile(new URL('../../supabase/migrations/20261113014411_staff_fnb_menu_summary.sql',import.meta.url),'utf8'));
statements.push(`
 set role authenticated;
 do $$declare x record;begin
  select * into x from public.staff_fnb_menu_summary('${id(10)}','2026-10-06 17:00Z','2026-10-07 17:00Z',15);
  if x.quantity<>2 or x.revenue<>200 then raise exception 'menu aggregate mismatch';end if;
  select * into x from public.staff_fnb_table_summary('${id(10)}','2026-10-06 17:00Z','2026-10-07 17:00Z');
  if x.table_name<>'Table A' or x.orders<>1 or x.revenue<>200 then raise exception 'table aggregate or deduplication mismatch';end if;
  if public.staff_fnb_kpi_summary('${id(10)}','2026-10-06 17:00Z','2026-10-07 17:00Z')
   <> '{"totalRevenue":250,"returnAmount":30,"netRevenue":220,"totalOrders":2,"avgTicket":125,"avgTurnoverMinutes":20}'::jsonb
   then raise exception 'KPI gross, returns or turnover mismatch';end if;
  select * into x from public.staff_fnb_hour_summary('${id(10)}',null,null) where hour=15;
  if x.revenue<>250 or x.orders<>2 or (select count(*) from public.staff_fnb_hour_summary('${id(10)}',null,null))<>24
   then raise exception 'Vietnam hour summary mismatch';end if;
  select * into x from public.staff_fnb_cashier_summary('${id(10)}',null,null);
  if x.cashier_name<>'Staff A' or x.revenue<>250 or x.orders<>2 or x.avg_ticket<>125
   then raise exception 'cashier summary mismatch';end if;
  select * into x from public.staff_fnb_modifier_summary('${id(10)}',null,null);
  if x.group_id<>'sugar' or x.option_id<>'less' or x.selection_count<>1 or x.total_quantity<>2 or x.total_price_delta<>10 or x.percent_in_group<>100
   then raise exception 'modifier totals mismatch';end if;
  select * into x from public.staff_fnb_channel_summary('${id(10)}','platform');
  if x.dimension<>'Grab' or x.orders<>2 or x.revenue<>400 then raise exception 'delivery channel totals mismatch';end if;
  if public.staff_fnb_kpi_summary('${id(10)}','2025-01-01','2025-01-02')
   <> '{"totalRevenue":0,"returnAmount":0,"netRevenue":0,"totalOrders":0,"avgTicket":0,"avgTurnoverMinutes":0}'::jsonb
   then raise exception 'empty KPI period mismatch';end if;
  begin perform public.staff_fnb_kpi_summary('${id(10)}','2026-10-07','2026-10-06');raise exception 'invalid date range allowed';
  exception when invalid_parameter_value then null;end;
  if (select count(*) from public.staff_fnb_menu_summary(null,null,null,15))<>1 then raise exception 'assigned branch aggregate missing';end if;
  begin perform public.staff_fnb_menu_summary('${id(11)}',null,null,15);raise exception 'unassigned branch allowed';
  exception when insufficient_privilege then if sqlerrm<>'BRANCH_ACCESS_DENIED' then raise;end if;end;
  begin perform public.staff_fnb_table_summary('${id(11)}',null,null);raise exception 'unassigned table branch allowed';
  exception when insufficient_privilege then if sqlerrm<>'BRANCH_ACCESS_DENIED' then raise;end if;end;
  begin perform public.staff_fnb_kpi_summary('${id(11)}',null,null);raise exception 'unassigned KPI branch allowed';
  exception when insufficient_privilege then if sqlerrm<>'BRANCH_ACCESS_DENIED' then raise;end if;end;
 end$$;
 reset role;
 insert into staff_branch_permission_catalog values ('reports.fnb',1);
 insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
  values ('${id(1)}','${id(101)}','${id(10)}','reports.fnb','revoke','${id(100)}');
 set role authenticated;
 do $$begin
  begin perform public.staff_fnb_menu_summary('${id(10)}',null,null,15);raise exception 'branch revoke ignored';
  exception when insufficient_privilege then if sqlerrm<>'FNB_REPORT_PERMISSION_REQUIRED' then raise;end if;end;
  begin perform public.staff_fnb_table_summary('${id(10)}',null,null);raise exception 'table branch revoke ignored';
  exception when insufficient_privilege then if sqlerrm<>'FNB_REPORT_PERMISSION_REQUIRED' then raise;end if;end;
  begin perform public.staff_fnb_kpi_summary('${id(10)}',null,null);raise exception 'KPI branch revoke ignored';
  exception when insufficient_privilege then if sqlerrm<>'FNB_REPORT_PERMISSION_REQUIRED' then raise;end if;end;
 end$$;
 reset role;delete from user_branch_permission_overrides where permission_code='reports.fnb';
 insert into role_permissions values ('${id(20)}','reports.view_all_branches');set role authenticated;
 do $$declare x record;begin
  select * into x from public.staff_fnb_menu_summary(null,null,null,15);
  if x.quantity<>3 or x.revenue<>500 then raise exception 'all-branch aggregate mismatch';end if;
  if (select sum(revenue) from public.staff_fnb_table_summary(null,null,null))<>500 then raise exception 'all-branch table aggregate mismatch';end if;
  if public.staff_fnb_kpi_summary(null,null,null)
   <> '{"totalRevenue":550,"returnAmount":90,"netRevenue":460,"totalOrders":3,"avgTicket":183,"avgTurnoverMinutes":30}'::jsonb
   then raise exception 'all-branch KPI mismatch';end if;
  if (select sum(revenue) from public.staff_fnb_cashier_summary(null,null,null))<>550
   or (select count(*) from public.staff_fnb_cashier_summary(null,null,null))<>2 then raise exception 'all-branch cashier mismatch';end if;
  select * into x from public.staff_fnb_modifier_summary(null,null,null);
  if x.selection_count<>2 or x.total_quantity<>3 or x.total_price_delta<>15 then raise exception 'all-branch modifier mismatch';end if;
 end$$;
 reset role;delete from role_permissions where permission_code in ('reports.fnb','reports.view_all_branches');set role authenticated;
 do $$begin
  begin perform public.staff_fnb_menu_summary(null,null,null,15);raise exception 'unpermitted report allowed';
  exception when insufficient_privilege then if sqlerrm<>'FNB_REPORT_PERMISSION_REQUIRED' then raise;end if;end;
  begin perform public.staff_fnb_table_summary(null,null,null);raise exception 'unpermitted table report allowed';
  exception when insufficient_privilege then if sqlerrm<>'FNB_REPORT_PERMISSION_REQUIRED' then raise;end if;end;
  begin perform public.staff_fnb_kpi_summary(null,null,null);raise exception 'unpermitted KPI report allowed';
  exception when insufficient_privilege then if sqlerrm<>'FNB_REPORT_PERMISSION_REQUIRED' then raise;end if;end;
  begin perform public.staff_fnb_hour_summary(null,null,null);raise exception 'unpermitted hourly report allowed';
  exception when insufficient_privilege then if sqlerrm<>'FNB_REPORT_PERMISSION_REQUIRED' then raise;end if;end;
  begin perform public.staff_fnb_cashier_summary(null,null,null);raise exception 'unpermitted cashier report allowed';
  exception when insufficient_privilege then if sqlerrm<>'FNB_REPORT_PERMISSION_REQUIRED' then raise;end if;end;
  begin perform public.staff_fnb_modifier_summary(null,null,null);raise exception 'unpermitted modifier report allowed';
  exception when insufficient_privilege then if sqlerrm<>'FNB_REPORT_PERMISSION_REQUIRED' then raise;end if;end;
  begin perform public.staff_fnb_channel_summary(null,'platform');raise exception 'unpermitted channel report allowed';
  exception when insufficient_privilege then if sqlerrm<>'FNB_REPORT_PERMISSION_REQUIRED' then raise;end if;end;
 end$$;
 reset role;
`);
statements.push(`
 alter table invoices add column code text,add column customer_name text,add column paid numeric,add column debt numeric,add column payment_method text;
 alter table sales_returns add column code text,add column refunded numeric;
 update invoices set code='I-'||right(id::text,3),customer_name='Customer',paid=total,debt=0,payment_method='cash';
 update sales_returns set code='R-'||right(id::text,3),refunded=total;
 insert into role_permissions values ('${id(20)}','reports.fnb');
`);
statements.push(await readFile(new URL('../../supabase/migrations/20261113020048_staff_fnb_report_detail.sql',import.meta.url),'utf8'));
statements.push(`
 set role authenticated;
 do $$begin
  begin perform public.staff_fnb_invoice_detail_page('${id(10)}',null,null,0,2);raise exception 'summary access exposed invoice detail';
  exception when insufficient_privilege then if sqlerrm<>'FNB_REPORT_DETAIL_PERMISSION_REQUIRED' then raise;end if;end;
  begin perform public.staff_fnb_return_detail_page('${id(10)}',null,null,0,2);raise exception 'summary access exposed return detail';
  exception when insufficient_privilege then if sqlerrm<>'FNB_REPORT_DETAIL_PERMISSION_REQUIRED' then raise;end if;end;
 end$$;
 reset role;insert into role_permissions values ('${id(20)}','reports.view_detail');set role authenticated;
 do $$begin
  if (select count(*) from public.staff_fnb_invoice_detail_page('${id(10)}',null,null,0,2))<>2 then raise exception 'invoice detail page mismatch';end if;
  if (select count(*) from public.staff_fnb_invoice_detail_page('${id(10)}',null,null,1,2))<>1 then raise exception 'invoice detail offset mismatch';end if;
  if (select count(*) from public.staff_fnb_return_detail_page('${id(10)}',null,null,0,2))<>1 then raise exception 'return detail page mismatch';end if;
  begin perform public.staff_fnb_invoice_detail_page('${id(11)}',null,null,0,2);raise exception 'unassigned invoice branch allowed';
  exception when insufficient_privilege then if sqlerrm<>'BRANCH_ACCESS_DENIED' then raise;end if;end;
 end$$;
 reset role;insert into role_permissions values ('${id(20)}','reports.view_all_branches');set role authenticated;
 do $$begin
  if (select count(*) from public.staff_fnb_invoice_detail_page(null,null,null,0,20))<>3 then raise exception 'all-branch invoice detail mismatch';end if;
  if (select count(*) from public.staff_fnb_return_detail_page(null,null,null,0,20))<>2 then raise exception 'all-branch return detail mismatch';end if;
 end$$;
 reset role;insert into staff_branch_permission_catalog values('reports.view_detail',1);
 insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
  values ('${id(1)}','${id(101)}','${id(10)}','reports.view_detail','revoke','${id(100)}');
 set role authenticated;
 do $$begin
  begin perform public.staff_fnb_return_detail_page('${id(10)}',null,null,0,2);raise exception 'detail branch revoke ignored';
  exception when insufficient_privilege then if sqlerrm<>'FNB_REPORT_DETAIL_PERMISSION_REQUIRED' then raise;end if;end;
 end$$;
 reset role;
`);
if (process.env.ONEBIZ_PGLITE_MODULE) {
 const {PGlite}=await import(pathToFileURL(process.env.ONEBIZ_PGLITE_MODULE).href);
 const db=new PGlite();
 try { await db.exec(statements.join('\n')); } finally { await db.close(); }
 console.log('PASS local fixture rehearsal (PGlite)');
 process.exit(0);
}
const args=['-Xq','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55433','-U','staff_test','-d','onebiz_staff_access_test'];
const child=spawn('psql',args,{env:{PATH:process.env.PATH,PGPASSWORD:'ephemeral-test-only',PGSSLMODE:'disable',PGCONNECT_TIMEOUT:'5'},stdio:['pipe','pipe','pipe']});
let out='',err='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);
const completed=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(err)));});
child.stdin.end(statements.join('\n'));
await completed;
console.log('PASS real PostgreSQL: F&B assigned scope, company reporting, checkout, inactive account');
