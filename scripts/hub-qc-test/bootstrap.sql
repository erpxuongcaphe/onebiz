-- Synthetic dependencies only. This fixture must never be run against a real project.
create role anon; create role authenticated; create role service_role;
create schema auth; create schema storage;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
create table public.tenants(id uuid primary key);
create table public.branches(id uuid primary key,tenant_id uuid references tenants,code text,name text,is_active boolean default true);
create table public.profiles(id uuid primary key,tenant_id uuid references tenants,full_name text,email text,role text,is_active boolean default true);
create table public.test_permissions(user_id uuid,code text,primary key(user_id,code));
create function public.get_user_tenant_id() returns uuid language sql stable security definer as $$select tenant_id from public.profiles where id=auth.uid() and is_active$$;
create function public.user_has_permission(p_id uuid,p_code text) returns boolean language sql stable security definer as $$select exists(select 1 from public.profiles where id=p_id and is_active and role='owner') or exists(select 1 from public.test_permissions where user_id=p_id and code=p_code)$$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb);
alter table storage.objects enable row level security;
create table public.mkt_tasks(id uuid primary key,tenant_id uuid,title text,task_status text,assignee_id uuid,reviewer_id uuid,deleted_at timestamptz,due_at timestamptz);
create function public.mkt_is_lead() returns boolean language sql as $$select false$$;
create table public.invoices(id uuid,tenant_id uuid,branch_id uuid,status text,total numeric,discount numeric,created_at timestamptz,source text);
create table public.stock_movements(id uuid primary key,quantity numeric);
create table public.cash_book(id uuid primary key,amount numeric);
