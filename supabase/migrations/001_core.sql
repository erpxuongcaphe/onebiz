-- OneBiz ERP - Core schema (multi-tenant + RBAC)

-- Extensions
create extension if not exists pgcrypto;

-- ============================================
-- 1) Tenants
-- ============================================
create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subdomain text unique,
  custom_domain text unique,
  logo_url text,
  primary_color text default '#4F46E5',
  status text not null default 'active' check (status in ('active', 'suspended', 'trial')),
  features jsonb not null default '{"hr": true, "inventory": true, "finance": true, "sales": true}',
  settings jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tenants enable row level security;

-- Default tenant for initial bootstrap (safe to keep; can be edited later)
insert into public.tenants (name, subdomain, custom_domain)
values ('OneBiz ERP', 'onebiz', 'onebiz.com.vn')
on conflict do nothing;

-- ============================================
-- 2) Profiles (app users)
-- ============================================
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  email text not null,
  full_name text not null,
  avatar_url text,
  phone text,
  status text not null default 'active' check (status in ('active', 'inactive', 'suspended')),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz
);

create index if not exists idx_profiles_tenant_id on public.profiles (tenant_id);
create index if not exists idx_profiles_email on public.profiles (email);

alter table public.profiles enable row level security;

-- Helper: current tenant id
create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tenant_id from public.profiles where id = auth.uid();
$$;

-- Policies: tenants
create policy "tenants: read own"
on public.tenants
for select
using (id = public.current_tenant_id());

-- Policies: profiles
create policy "profiles: read within tenant"
on public.profiles
for select
using (tenant_id = public.current_tenant_id());

create policy "profiles: update own"
on public.profiles
for update
using (id = auth.uid());

-- ============================================
-- 3) Roles + user_roles (RBAC)
-- ============================================
create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  description text,
  permissions jsonb not null default '[]',
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create index if not exists idx_roles_tenant_id on public.roles (tenant_id);
alter table public.roles enable row level security;

create policy "roles: read within tenant"
on public.roles
for select
using (tenant_id = public.current_tenant_id());

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role_id uuid not null references public.roles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, role_id)
);

create index if not exists idx_user_roles_user_id on public.user_roles (user_id);
create index if not exists idx_user_roles_tenant_id on public.user_roles (tenant_id);
alter table public.user_roles enable row level security;

create policy "user_roles: read own"
on public.user_roles
for select
using (user_id = auth.uid());

-- ============================================
-- 4) Seed system roles (optional)
-- ============================================
-- Note: seeding per-tenant is usually done by an admin API.
-- This function seeds a base role set for a given tenant id.

create or replace function public.seed_default_roles(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.roles (tenant_id, name, description, permissions, is_system)
  values
    (p_tenant_id, 'Super Admin', 'Full system access', '["*"]'::jsonb, true),
    (p_tenant_id, 'Admin', 'Administrative access', '["users.*", "roles.*", "settings.*"]'::jsonb, true),
    (p_tenant_id, 'Manager', 'Department manager', '["read.*", "write.own_department"]'::jsonb, true),
    (p_tenant_id, 'Employee', 'Basic employee access', '["read.own", "write.own"]'::jsonb, true)
  on conflict do nothing;
end;
$$;
