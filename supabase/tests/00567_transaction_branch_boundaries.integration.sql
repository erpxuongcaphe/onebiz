\set ON_ERROR_STOP on
do $$ begin if to_regclass('public.profiles') is not null then raise exception 'Fresh isolated database required'; end if; end $$;
create schema auth;
do $$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
end $$;
create function public.test_id(integer) returns uuid language sql immutable as $$select ('00000000-0000-0000-0000-'||lpad($1::text,12,'0'))::uuid$$;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
create table public.profiles(id uuid primary key,tenant_id uuid,is_active boolean,role text);
create table public.branches(id uuid primary key,tenant_id uuid);
create table public.user_branches(user_id uuid,branch_id uuid);
create table public.test_permissions(user_id uuid,code text);
create function public.get_user_tenant_id() returns uuid language sql stable security definer as $$select tenant_id from public.profiles where id=auth.uid()$$;
create function public.user_has_permission(uuid,text) returns boolean language sql stable security definer as $$select exists(select 1 from public.profiles where id=$1 and role='owner') or exists(select 1 from public.test_permissions where user_id=$1 and code=$2)$$;
create function public.user_has_branch_access(uuid,uuid) returns boolean language sql stable security definer as $$select exists(select 1 from public.profiles where id=$1 and role='owner') or exists(select 1 from public.user_branches where user_id=$1 and branch_id=$2)$$;
insert into public.profiles values
 (test_id(1),test_id(10),true,'owner'),(test_id(2),test_id(10),true,'staff'),
 (test_id(3),test_id(10),true,'staff'),(test_id(4),test_id(10),false,'staff'),
 (test_id(5),test_id(10),true,'staff'),(test_id(6),test_id(20),true,'owner');
insert into public.branches values(test_id(11),test_id(10)),(test_id(12),test_id(10)),(test_id(21),test_id(20));
insert into public.user_branches values(test_id(2),test_id(11)),(test_id(3),test_id(11)),(test_id(4),test_id(11)),(test_id(5),test_id(11));
insert into public.test_permissions values(test_id(3),'reports.view_all_branches'),(test_id(5),'system.manage_branches');

do $fixture$ declare t text; s record; begin
 foreach t in array array['invoices','purchase_orders','cash_transactions','sales_returns','sales_orders','input_invoices','supplier_returns','disposal_exports','internal_exports','branch_stock','stock_movements','product_lots','production_orders','inventory_checks','customer_debt_adjustments','debt_opening_balances'] loop
  execute format('create table public.%I(id uuid primary key,tenant_id uuid,branch_id uuid,amount numeric)',t);
  execute format('create policy legacy_tenant on public.%I for all to authenticated using(tenant_id=public.get_user_tenant_id()) with check(tenant_id=public.get_user_tenant_id())',t);
  execute format('insert into public.%I values(public.test_id(101),public.test_id(10),public.test_id(11),100),(public.test_id(102),public.test_id(10),public.test_id(12),200),(public.test_id(103),public.test_id(10),null,300),(public.test_id(104),public.test_id(20),public.test_id(21),400)',t);
 end loop;
 for s in select * from (values
  ('invoice_items','invoice_id','invoices'),('purchase_order_items','purchase_order_id','purchase_orders'),
  ('return_items','return_id','sales_returns'),('sales_order_items','order_id','sales_orders'),
  ('supplier_return_items','return_id','supplier_returns'),('disposal_export_items','disposal_id','disposal_exports'),
  ('internal_export_items','export_id','internal_exports'),('production_order_materials','production_order_id','production_orders'),
  ('inventory_check_items','check_id','inventory_checks'),('shipping_orders','invoice_id','invoices')
 ) x(child,fk,parent) loop
  execute format('create table public.%I(id uuid primary key,%I uuid,amount numeric)',s.child,s.fk);
  -- Deliberately broad legacy policy: the migration must still restrict children.
  execute format('create policy legacy_child on public.%I for all to authenticated using(true) with check(true)',s.child);
  execute format('insert into public.%I values(public.test_id(201),public.test_id(101),100),(public.test_id(202),public.test_id(102),200),(public.test_id(203),public.test_id(103),300),(public.test_id(204),public.test_id(104),400)',s.child);
 end loop;
end; $fixture$;
create table public.stock_transfers(id uuid primary key,tenant_id uuid,from_branch_id uuid,to_branch_id uuid);
create table public.stock_transfer_items(id uuid primary key,transfer_id uuid,amount numeric);
insert into public.stock_transfers values(test_id(301),test_id(10),test_id(12),test_id(11)),(test_id(302),test_id(10),test_id(12),test_id(12));
insert into public.stock_transfer_items values(test_id(401),test_id(301),100),(test_id(402),test_id(302),200);
grant usage on schema public,auth to authenticated;
grant select,insert,update,delete on all tables in schema public to authenticated;
alter table public.invoices add column status text,add column auto_saved boolean,add column source text,add column deleted_at timestamptz,add column updated_at timestamptz;
create function public.pos_checkout(uuid,uuid,uuid,text,jsonb,text,numeric,numeric,text) returns uuid language sql security definer as $$select public.test_id(999)$$;
grant execute on function public.pos_checkout(uuid,uuid,uuid,text,jsonb,text,numeric,numeric,text) to authenticated,anon;
insert into public.test_permissions values(test_id(2),'pos_retail.checkout');
\ir ../migrations/00567_transaction_branch_boundaries.sql

set role authenticated;
do $verify$ declare t text; s record; n bigint; a integer; expected integer; begin
 for a in 1..6 loop
  perform set_config('test.actor',public.test_id(a)::text,false);
  expected:=case a when 1 then 3 when 3 then 3 when 4 then 0 else 1 end;
  foreach t in array array['invoices','purchase_orders','cash_transactions','sales_returns','sales_orders','input_invoices','supplier_returns','disposal_exports','internal_exports','branch_stock','stock_movements','product_lots','production_orders','inventory_checks','customer_debt_adjustments','debt_opening_balances','invoice_items','purchase_order_items','return_items','sales_order_items','supplier_return_items','disposal_export_items','internal_export_items','production_order_materials','inventory_check_items','shipping_orders'] loop
   execute format('select count(*) from public.%I',t) into n;
   if n<>expected then raise exception 'actor % table %: expected %, got %',a,t,expected,n;end if;
  end loop;
 end loop;
 perform set_config('test.actor',public.test_id(2)::text,false);
 select count(*) into n from public.stock_transfers;if n<>1 then raise exception 'Receiving branch transfer scope failed';end if;
 select count(*) into n from public.stock_transfer_items;if n<>1 then raise exception 'Receiving branch transfer item scope failed';end if;
 update public.stock_transfer_items set amount=999 where id=public.test_id(401);get diagnostics n=row_count;
 if n<>0 then raise exception 'Receiving-only actor changed cross-branch transfer';end if;
 foreach t in array array['invoices','purchase_orders','cash_transactions','sales_returns','sales_orders','input_invoices','supplier_returns','disposal_exports','internal_exports','branch_stock','stock_movements','product_lots','production_orders','inventory_checks','customer_debt_adjustments','debt_opening_balances'] loop
  execute format('update public.%I set amount=101 where id=public.test_id(101)',t); get diagnostics n=row_count;
  if n<>1 then raise exception 'Assigned write blocked on %',t;end if;
  execute format('update public.%I set amount=999 where id=public.test_id(102)',t); get diagnostics n=row_count;
  if n<>0 then raise exception 'Foreign branch update allowed on %',t;end if;
  begin
   execute format('update public.%I set branch_id=public.test_id(12) where id=public.test_id(101)',t);
   raise exception 'Branch move allowed on %',t;
  exception when insufficient_privilege then null;end;
  begin
   execute format('insert into public.%I values(public.test_id(999),public.test_id(10),public.test_id(12),999)',t);
   raise exception 'Foreign branch insert allowed on %',t;
  exception when insufficient_privilege then null;end;
 end loop;
 -- All-company reporting is read-only outside assigned branches, including child rows.
 perform set_config('test.actor',public.test_id(3)::text,false);
 select count(*) into n from public.stock_transfers;if n<>2 then raise exception 'Company transfer reader blocked';end if;
 update public.invoices set amount=999 where id=public.test_id(102); get diagnostics n=row_count;
 if n<>0 then raise exception 'Company report permission allowed a write';end if;
 update public.invoice_items set amount=999 where id=public.test_id(202);get diagnostics n=row_count;
 if n<>0 then raise exception 'Child update escaped parent write scope';end if;
 begin
  insert into public.invoice_items values(public.test_id(999),public.test_id(102),999);
  raise exception 'Child insert escaped parent write scope';
 exception when insufficient_privilege then null;end;
 if public.can_write_branch_document_00567(public.test_id(20),public.test_id(21)) then raise exception 'Foreign tenant write allowed';end if;
end; $verify$;
reset role;
insert into public.invoices(id,tenant_id,branch_id,status,auto_saved,updated_at) values
 (test_id(110),test_id(10),test_id(11),'draft',true,now()-interval '60 days'),
 (test_id(111),test_id(10),test_id(12),'draft',true,now()-interval '60 days'),
 (test_id(112),test_id(20),test_id(21),'draft',true,now()-interval '60 days');
set role authenticated;
do $$begin
 perform set_config('test.actor',public.test_id(2)::text,false);
 if public.cleanup_expired_auto_drafts(public.test_id(10),30)<>1 then raise exception 'Draft cleanup did not preserve branch scope';end if;
 begin
  perform public.cleanup_expired_auto_drafts(public.test_id(20),30);
  raise exception 'Draft cleanup crossed tenant';
 exception when insufficient_privilege then null;end;
 begin
  perform public.cleanup_expired_auto_drafts(public.test_id(10),0);
  raise exception 'Fresh draft cleanup allowed';
 exception when invalid_parameter_value then null;end;
 if has_function_privilege('authenticated','public.pos_checkout(uuid,uuid,uuid,text,jsonb,text,numeric,numeric,text)','EXECUTE')
 or has_function_privilege('anon','public.pos_checkout(uuid,uuid,uuid,text,jsonb,text,numeric,numeric,text)','EXECUTE') then
  raise exception 'Legacy checkout remains executable';end if;
end;$$;
reset role;
do $$begin
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('invoices','purchase_orders','cash_transactions','sales_returns','stock_movements','inventory_checks') and not c.relrowsecurity) then raise exception 'RLS not enabled';end if;
 if exists(select 1 from public.invoices where id=public.test_id(102) and amount<>200) then raise exception 'Restricted writes changed stored data';end if;
 if exists(select 1 from public.invoices where id in(public.test_id(111),public.test_id(112)) and deleted_at is not null) then raise exception 'Draft cleanup changed another scope';end if;
end;$$;
select '00567 branch isolation: read, child rows, write, disabled, tenant and company-reader checks passed' as result;
