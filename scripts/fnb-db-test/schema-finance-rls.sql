-- Dedicated ephemeral database only. Minimal copy of LIVE policy expressions.
drop schema public cascade;
create schema public;
create schema if not exists auth;
do $$ begin if not exists(select 1 from pg_roles where rolname='finance_test_client') then
  create role finance_test_client nologin; end if; end $$;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table public.profiles(id uuid primary key,tenant_id uuid,role text);
create function public.get_user_tenant_id() returns uuid language sql stable security definer set search_path=public as $$ select tenant_id from public.profiles where id=auth.uid() $$;
create table public.invoices(id uuid primary key,tenant_id uuid not null,total numeric,paid numeric,status text);
create table public.invoice_items(id uuid primary key,invoice_id uuid references public.invoices,quantity numeric);
create table public.cash_transactions(id uuid primary key,tenant_id uuid not null,amount numeric,status text);
create policy invoices_select on public.invoices for select using(tenant_id=public.get_user_tenant_id());
create policy invoices_insert on public.invoices for insert with check(tenant_id=public.get_user_tenant_id());
create policy invoices_update on public.invoices for update using(tenant_id=public.get_user_tenant_id());
create policy invoice_items_select on public.invoice_items for select using(exists(select 1 from public.invoices i where i.id=invoice_items.invoice_id and i.tenant_id=public.get_user_tenant_id()));
create policy invoice_items_insert on public.invoice_items for insert with check(exists(select 1 from public.invoices i where i.id=invoice_items.invoice_id and i.tenant_id=public.get_user_tenant_id()));
create policy invoice_items_update on public.invoice_items for update using(exists(select 1 from public.invoices i where i.id=invoice_items.invoice_id and i.tenant_id=public.get_user_tenant_id()));
create policy cash_select on public.cash_transactions for select using(tenant_id=public.get_user_tenant_id());
create policy cash_insert on public.cash_transactions for insert with check(tenant_id=public.get_user_tenant_id());
grant usage on schema public,auth to finance_test_client;
grant select,insert,update,delete on all tables in schema public to finance_test_client;
insert into public.profiles values('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','owner'),('00000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','cashier');
insert into public.invoices values('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',100,0,'draft'),('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002',200,0,'draft');
insert into public.invoice_items values('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',1),('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002',2);
insert into public.cash_transactions values('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',100,'completed'),('40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002',200,'completed');
