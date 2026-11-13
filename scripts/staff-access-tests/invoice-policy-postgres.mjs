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
sql.push(await functionFromMigration('20261111070229_staff_branch_checkout_permissions.sql','_staff_permission_at_scope'));
sql.push(await functionFromMigration('20261111095224_staff_branch_kitchen_permissions.sql','_staff_permission_any_branch'));
sql.push(`
 create table invoices(id uuid,tenant_id uuid,branch_id uuid,source text,created_by uuid);
 create table invoice_items(id uuid,invoice_id uuid,quantity numeric,unit_cost numeric);
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
sql.push(await migration('20261112172924_staff_invoice_item_view_scope.sql'));
sql.push(await migration('20261113004524_staff_own_order_scope.sql'));
sql.push(`
 set role authenticated;
 do $$begin
  if (select count(*) from invoices)<>1 or (select count(*) from invoice_items_scoped)<>1 or
     (select count(*) from invoice_items)<>1 then raise exception 'own-order scope failed'; end if;
 end$$;
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
if(process.env.ONEBIZ_PGLITE_MODULE){const {PGlite}=await import(pathToFileURL(process.env.ONEBIZ_PGLITE_MODULE).href);const db=new PGlite();try{await db.exec(sql.join('\n'));}finally{await db.close();}console.log('PASS local invoice fixture rehearsal (PGlite)');process.exit(0);}
const args=['-Xq','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55433','-U','staff_test','-d','onebiz_staff_access_test'];
const child=spawn('psql',args,{env:{PATH:process.env.PATH,PGPASSWORD:'ephemeral-test-only',PGSSLMODE:'disable',PGCONNECT_TIMEOUT:'5'},stdio:['pipe','pipe','pipe']});
let err='';child.stderr.on('data',x=>err+=x);child.stdout.resume();
const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(err)));});
child.stdin.end(sql.join('\n'));await done;console.log('PASS real PostgreSQL: own-order restriction and independent rights');
