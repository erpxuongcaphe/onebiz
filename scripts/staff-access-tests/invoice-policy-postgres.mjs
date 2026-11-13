// Synthetic fixture for the dedicated disposable CI PostgreSQL service only.
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {initializeStaffAccessFixture} from './fixture.mjs';
import {functionFromMigration} from './inventory.mjs';
if(process.env.STAFF_EPHEMERAL_DB!=='onebiz_staff_access_test')throw new Error('Dedicated disposable database required');
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const sql=[];const migration=async n=>readFile(new URL(`../../supabase/migrations/${n}`,import.meta.url),'utf8');
await initializeStaffAccessFixture({exec:async s=>sql.push(s)},id);
sql.push(await migration('20261111052704_staff_branch_access.sql'));
sql.push(await functionFromMigration('20261111095224_staff_branch_kitchen_permissions.sql','_staff_permission_any_branch'));
sql.push(`
 create table invoices(id uuid,tenant_id uuid,branch_id uuid,source text,created_by uuid,status text default 'completed');
 create table invoice_items(id uuid,invoice_id uuid,quantity numeric,unit_cost numeric,product_id uuid,product_name text,unit text,unit_price numeric,total numeric,returned_qty numeric);
 insert into invoices values ('${id(50)}','${id(1)}','${id(10)}','order','${id(101)}'),('${id(51)}','${id(1)}','${id(11)}','order','${id(100)}'),('${id(52)}','${id(2)}','${id(12)}','order','${id(102)}');
 insert into invoice_items values ('${id(60)}','${id(50)}',2,100),('${id(61)}','${id(51)}',3,200),('${id(62)}','${id(52)}',4,300);
 alter function public.get_user_tenant_id() security definer;
 alter function public.user_has_branch_access(uuid,uuid) security definer;
 alter function public.user_has_permission(uuid,text) security definer;
 create function public._can_read_branch_inventory_00476(u uuid,t uuid,b uuid) returns boolean language sql stable security definer set search_path=public as $$select t=get_user_tenant_id() and user_has_branch_access(u,b)$$;
 create function public.can_read_branch_document_00567(t uuid,b uuid) returns boolean language sql stable security definer set search_path=public as $$select t=get_user_tenant_id() and (user_has_branch_access(auth.uid(),b) or user_has_permission(auth.uid(),'reports.view_all_branches'))$$;
 create view public.invoice_items_scoped with (security_barrier=true) as
  select t.id,t.invoice_id,t.quantity,case when user_has_permission(auth.uid(),'products.view_cost') then t.unit_cost else null end unit_cost
  from invoice_items t where exists (select 1 from invoices o where o.id=t.invoice_id and (exists(select 1 where _can_read_branch_inventory_00476(auth.uid(),o.tenant_id,o.branch_id))));
 alter table invoices enable row level security; alter table invoice_items enable row level security;
 create policy invoice_legacy on invoices for select to authenticated using (tenant_id=get_user_tenant_id() and user_has_branch_access(auth.uid(),branch_id));
 create policy items_legacy on invoice_items for select to authenticated using (exists(select 1 from invoices i where i.id=invoice_id));
 grant usage on schema public,auth to authenticated; grant select on invoices to authenticated;
 grant select(id,invoice_id,quantity) on invoice_items to authenticated; grant select on invoice_items_scoped to authenticated;
 insert into user_branches values ('${id(101)}','${id(11)}',null);
 delete from role_permissions where role_id='${id(20)}';
 insert into role_permissions values ('${id(20)}','orders.view'),('${id(20)}','orders.view_own_only'),('${id(20)}','orders.create');
 select set_config('request.jwt.claim.sub','${id(101)}',false);
`);
// The additive bridge is installed first while the original policies and
// browser are still active. The final migration must replace it cleanly.
sql.push(await migration('20261113041930_staff_return_reader_bridge.sql'));
sql.push(await migration('20261113041930_staff_return_reader_bridge.sql'));
sql.push(`
 insert into role_permissions values ('${id(20)}','pos_fnb.view_orders');set role authenticated;
 do $$begin
  if has_function_privilege('anon','public.staff_returnable_invoice_items(uuid)','execute') then raise exception 'bridge exposed to anon';end if;
  if (select count(*) from invoice_items_scoped)<>2 then raise exception 'bridge changed legacy view';end if;
  if (select count(*) from public.staff_returnable_invoice_items('${id(50)}'))<>1 then raise exception 'bridge blocked own return';end if;
  begin perform public.staff_returnable_invoice_items('${id(51)}');raise exception 'bridge exposed another order';
  exception when insufficient_privilege then if sqlerrm<>'RETURN_READ_DENIED' then raise;end if;end;
  begin perform public.staff_returnable_invoice_items('${id(52)}');raise exception 'bridge exposed foreign tenant';
  exception when insufficient_privilege then if sqlerrm<>'RETURN_READ_DENIED' then raise;end if;end;
 end$$;
 reset role;delete from role_permissions where permission_code='pos_fnb.view_orders';
 insert into invoices values ('${id(54)}','${id(1)}','${id(10)}','fnb','${id(100)}');
 insert into invoice_items values ('${id(64)}','${id(54)}',1,0);
 set role authenticated;
 do $$begin
  begin perform public.staff_returnable_invoice_items('${id(54)}');raise exception 'bridge allowed missing checkout';
  exception when insufficient_privilege then if sqlerrm<>'RETURN_READ_DENIED' then raise;end if;end;
 end$$;
 reset role;insert into role_permissions values ('${id(20)}','pos_fnb.checkout');set role authenticated;
 do $$begin if (select count(*) from public.staff_returnable_invoice_items('${id(54)}'))<>1 then raise exception 'bridge blocked F&B checkout return';end if;end$$;
 reset role;update invoices set status='draft' where id='${id(54)}';set role authenticated;
 do $$begin
  begin perform public.staff_returnable_invoice_items('${id(54)}');raise exception 'bridge allowed draft';
  exception when invalid_parameter_value then if sqlerrm<>'INVOICE_NOT_COMPLETED' then raise;end if;end;
 end$$;
 reset role;delete from role_permissions where permission_code='pos_fnb.checkout';
 delete from invoice_items where id='${id(64)}';delete from invoices where id='${id(54)}';
`);
sql.push(await functionFromMigration('20261111070229_staff_branch_checkout_permissions.sql','_staff_permission_at_scope'));
sql.push(await migration('20261112172924_staff_invoice_item_view_scope.sql'));
sql.push(await migration('20261113004524_staff_own_order_scope.sql'));
// Replaying phase one after the final migration must never weaken the reader.
sql.push(await migration('20261113041930_staff_return_reader_bridge.sql'));
sql.push(`
 set role authenticated;
 do $$begin
  if (select count(*) from invoices)<>1 or (select count(*) from invoice_items_scoped)<>1 or
     (select count(*) from invoice_items)<>1 then raise exception 'own-order scope failed'; end if;
 end$$;
 reset role;insert into role_permissions values ('${id(20)}','pos_fnb.view_orders');set role authenticated;
 do $$begin
  if (select count(*) from public.staff_returnable_invoice_items('${id(50)}'))<>1 then raise exception 'own return blocked';end if;
  begin perform public.staff_returnable_invoice_items('${id(51)}');raise exception 'other owner return allowed';
  exception when insufficient_privilege then if sqlerrm<>'RETURN_READ_DENIED' then raise;end if;end;
  begin perform public.staff_returnable_invoice_items('${id(52)}');raise exception 'foreign tenant return allowed';
  exception when insufficient_privilege then if sqlerrm<>'RETURN_READ_DENIED' then raise;end if;end;
 end$$;
 reset role;insert into staff_branch_permission_catalog values ('pos_fnb.view_orders',1);
 insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
  values ('${id(1)}','${id(101)}','${id(10)}','pos_fnb.view_orders','revoke','${id(100)}');set role authenticated;
 do $$begin
  begin perform public.staff_returnable_invoice_items('${id(50)}');raise exception 'bridge replay weakened scoped revoke';
  exception when insufficient_privilege then if sqlerrm<>'RETURN_READ_DENIED' then raise;end if;end;
 end$$;
 reset role;delete from user_branch_permission_overrides where permission_code='pos_fnb.view_orders';
 delete from role_permissions where permission_code='pos_fnb.view_orders';set role authenticated;
 reset role;insert into role_permissions values ('${id(20)}','invoices.view');set role authenticated;
 do $$begin if (select count(*) from invoices)<>2 or (select count(*) from invoice_items_scoped)<>2 then raise exception 'independent invoice right was lost';end if;end$$;
 reset role;insert into user_permission_overrides(tenant_id,user_id,permission_code,override_type,created_by)
  values ('${id(1)}','${id(101)}','invoices.view','revoke','${id(100)}');set role authenticated;
 do $$begin if (select count(*) from invoices)<>1 or (select count(*) from invoice_items_scoped)<>1 then raise exception 'global revoke ignored';end if;end$$;
 reset role;insert into role_permissions values ('${id(20)}','pos_retail.checkout');set role authenticated;
 do $$begin if (select count(*) from invoices)<>2 then raise exception 'independent checkout was lost';end if;end$$;
 reset role;
`);
for(const [name,param] of [
 ['close_sales_order_processing','p_order_id'],['reopen_sales_order_processing','p_order_id'],
 ['create_child_sale_from_order','p_order_id'],['mark_order_processed','p_order_id'],
 ['save_sales_order_atomic','p_order_id'],['attach_invoice_shipment_atomic','p_invoice_id'],
 ['update_draft_invoice_atomic','p_invoice_id'],['cancel_draft_invoice_atomic','p_invoice_id'],
 ['duplicate_invoice_to_order_atomic','p_source_invoice_id'],
]) sql.push(`create function public.${name}(${param} uuid) returns boolean language plpgsql security definer set search_path='' as $$\nbegin\n return true; end $$;`);
sql.push(`create function public.close_sales_orders_processing(p_order_ids uuid[],p_reason text default null,p_apply boolean default false) returns boolean language plpgsql security definer set search_path='' as $$\nbegin\n return true; end $$;`);
sql.push(await migration('20261113005650_staff_own_order_action_scope.sql'));
sql.push(`
 delete from role_permissions where permission_code='pos_retail.checkout';
 set role authenticated;
 do $$begin
  begin perform public.close_sales_order_processing('${id(51)}'); raise exception 'own action guard missing';
  exception when insufficient_privilege then if sqlerrm<>'STAFF_OWN_ORDER_ACTION_DENIED' then raise; end if; end;
  if not public.close_sales_order_processing('${id(50)}') then raise exception 'own action blocked'; end if;
  begin perform public.close_sales_orders_processing(array['${id(50)}','${id(51)}']::uuid[],null,false); raise exception 'batch guard missing';
  exception when insufficient_privilege then if sqlerrm<>'STAFF_OWN_ORDER_ACTION_DENIED' then raise; end if; end;
 end$$;
 reset role; insert into role_permissions values ('${id(20)}','pos_retail.checkout'); set role authenticated;
 do $$begin if not public.close_sales_order_processing('${id(51)}') then raise exception 'independent checkout lost'; end if;end$$;
 reset role;
`);
sql.push(`
 delete from role_permissions where permission_code='pos_retail.checkout';
 insert into role_permissions values ('${id(20)}','pos_fnb.checkout');
 create table sales_orders(id uuid primary key,tenant_id uuid,branch_id uuid,created_by uuid);
 create table sales_order_items(id uuid primary key,order_id uuid);
 create table shipping_orders(id uuid primary key,invoice_id uuid);
 insert into sales_orders values ('${id(70)}','${id(1)}','${id(10)}','${id(101)}'),('${id(71)}','${id(1)}','${id(11)}','${id(100)}');
 insert into sales_order_items values ('${id(80)}','${id(70)}'),('${id(81)}','${id(71)}');
 insert into shipping_orders values ('${id(90)}','${id(50)}'),('${id(91)}','${id(51)}');
 insert into invoices values ('${id(53)}','${id(1)}','${id(10)}','fnb','${id(100)}');
 insert into invoice_items values ('${id(63)}','${id(53)}',1,0);
 alter table sales_orders enable row level security; alter table sales_order_items enable row level security;
 alter table shipping_orders enable row level security;
 create policy all_sales_orders on sales_orders for all to authenticated using (true) with check (true);
 create policy all_sales_items on sales_order_items for all to authenticated using (true) with check (true);
 create policy all_shipping on shipping_orders for all to authenticated using (true) with check (true);
 create policy write_invoices on invoices for update to authenticated using (true) with check (true);
 create policy write_items on invoice_items for update to authenticated using (true) with check (true);
 grant select,update,insert,delete on sales_orders,sales_order_items,shipping_orders to authenticated;
 grant update on invoices,invoice_items to authenticated;
`);
sql.push(await migration('20261113011515_staff_own_order_direct_writes.sql'));
sql.push(`
 set role authenticated;
 do $$declare n int;begin
  if (select count(*) from sales_orders)<>1 or (select count(*) from sales_order_items)<>1 then
   raise exception 'own legacy read scope failed';end if;
  update invoices set source='fnb' where id='${id(51)}'; get diagnostics n=row_count;
  if n<>0 then raise exception 'other order header write allowed';end if;
  update invoices set source='order' where id='${id(50)}';get diagnostics n=row_count;
  if n<>1 then raise exception 'own order header write blocked';end if;
  update invoice_items set quantity=5 where id='${id(60)}';get diagnostics n=row_count;
  if n<>1 then raise exception 'own order item write blocked';end if;
  update invoice_items set quantity=5 where id='${id(61)}';get diagnostics n=row_count;
  if n<>0 then raise exception 'other order item write allowed';end if;
  update invoice_items set quantity=5 where id='${id(63)}';get diagnostics n=row_count;
  if n<>1 then raise exception 'unrelated FNB item blocked';end if;
  update shipping_orders set invoice_id=invoice_id where id='${id(91)}';get diagnostics n=row_count;
  if n<>0 then raise exception 'other shipping write allowed';end if;
  update sales_order_items set order_id=order_id where id='${id(81)}';get diagnostics n=row_count;
  if n<>0 then raise exception 'other legacy order write allowed';end if;
  begin update sales_order_items set order_id='${id(71)}' where id='${id(80)}';
   raise exception 'moving item to another order allowed';
  exception when insufficient_privilege then null; end;
  begin insert into sales_orders values ('${id(72)}','${id(1)}','${id(10)}','${id(100)}');
   raise exception 'forged creator allowed';
  exception when insufficient_privilege then null; end;
  insert into sales_orders values ('${id(73)}','${id(1)}','${id(10)}','${id(101)}');
 end$$;
 reset role;insert into role_permissions values ('${id(20)}','pos_retail.checkout');set role authenticated;
 do $$declare n int;begin
  if (select count(*) from sales_orders)<>3 or (select count(*) from sales_order_items)<>2 then
   raise exception 'independent legacy reads lost';end if;
  update shipping_orders set invoice_id=invoice_id where id='${id(91)}';get diagnostics n=row_count;
  if n<>1 then raise exception 'independent checkout shipping blocked';end if;
  update sales_order_items set order_id=order_id where id='${id(81)}';get diagnostics n=row_count;
  if n<>1 then raise exception 'independent checkout legacy blocked';end if;
 end$$;
 reset role; delete from role_permissions where permission_code in ('pos_retail.checkout','orders.view_own_only'); set role authenticated;
 do $$declare n int;begin
  if (select count(*) from sales_orders)<>3 or (select count(*) from sales_order_items)<>2 then
   raise exception 'legacy unrestricted reads changed';end if;
  update sales_order_items set order_id=order_id where id='${id(81)}';get diagnostics n=row_count;
  if n<>1 then raise exception 'legacy unrestricted behavior changed';end if;
 end$$;
 reset role;
 delete from role_permissions where role_id='${id(20)}';
 insert into role_permissions values ('${id(20)}','pos_fnb.view_sales_summary');
 set role authenticated;
 do $$begin
  if (select count(*) from invoice_items where invoice_id='${id(53)}')<>0
   or (select count(*) from invoice_items_scoped where invoice_id='${id(53)}')<>0 then
   raise exception 'summary exposed F&B invoice lines';end if;
 end$$;
 reset role;delete from role_permissions where permission_code='pos_fnb.view_sales_summary';
 insert into role_permissions values ('${id(20)}','reports.fnb');set role authenticated;
 do $$begin
  if (select count(*) from invoice_items where invoice_id='${id(53)}')<>0
   or (select count(*) from invoice_items_scoped where invoice_id='${id(53)}')<>0 then
   raise exception 'F&B report exposed invoice lines';end if;
 end$$;
 reset role;insert into role_permissions values ('${id(20)}','pos_fnb.checkout');set role authenticated;
 do $$begin
  if (select count(*) from invoice_items where invoice_id='${id(53)}')<>1 then
   raise exception 'independent F&B checkout lost invoice lines';end if;
 end$$;
 reset role;
`);
sql.push(`
 delete from role_permissions where role_id='${id(20)}';
 delete from user_branch_permission_overrides where user_id='${id(101)}';
 delete from user_permission_overrides where user_id='${id(101)}' and permission_code in ('invoices.view','orders.view','pos_fnb.view_orders');
 insert into staff_branch_permission_catalog values ('invoices.view',1) on conflict do nothing;
 insert into role_permissions values ('${id(20)}','invoices.view');
 insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
  values ('${id(1)}','${id(101)}','${id(10)}','invoices.view','revoke','${id(100)}');
`);
sql.push(await migration('20261113065814_staff_invoice_header_branch_scope.sql'));
sql.push(`
 set role authenticated;
 do $$begin
  if exists(select 1 from invoices where branch_id='${id(10)}') or not exists(select 1 from invoices where id='${id(51)}')
   then raise exception 'header scope did not compose with legacy and own-order policies';end if;
 end$$;
 reset role;insert into role_permissions values ('${id(20)}','pos_fnb.checkout');set role authenticated;
 do $$declare n integer;begin
  if not exists(select 1 from invoices where id='${id(53)}') or not exists(select 1 from invoice_items where invoice_id='${id(53)}')
   then raise exception 'independent checkout lost header or lines';end if;
  update invoices set status=status where id='${id(53)}';get diagnostics n=row_count;
  if n<>1 then raise exception 'independent checkout invoice update blocked';end if;
 end$$;
 reset role;
`);
if(process.env.ONEBIZ_PGLITE_MODULE){const {PGlite}=await import(pathToFileURL(process.env.ONEBIZ_PGLITE_MODULE).href);const db=new PGlite();try{await db.exec(sql.join('\n'));}finally{await db.close();}console.log('PASS local invoice fixture rehearsal (PGlite)');process.exit(0);}
const args=['-Xq','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55433','-U','staff_test','-d','onebiz_staff_access_test'];
const child=spawn('psql',args,{env:{PATH:process.env.PATH,PGPASSWORD:'ephemeral-test-only',PGSSLMODE:'disable',PGCONNECT_TIMEOUT:'5'},stdio:['pipe','pipe','pipe']});
let err='';child.stderr.on('data',x=>err+=x);child.stdout.resume();
const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(err)));});
child.stdin.end(sql.join('\n'));await done;console.log('PASS real PostgreSQL: own-order restriction and independent rights');
