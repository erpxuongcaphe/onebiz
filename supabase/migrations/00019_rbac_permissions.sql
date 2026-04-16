-- ============================================================
-- RBAC Permission System
-- Granular roles & permissions per tenant
-- ============================================================

-- 1. Roles (custom per tenant)
create table public.roles (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  description text,
  is_system boolean not null default false,
  color text not null default 'bg-blue-500',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id, name)
);

create index idx_roles_tenant on public.roles(tenant_id);

-- 2. Role permissions (role → permission codes)
create table public.role_permissions (
  id uuid primary key default uuid_generate_v4(),
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_code text not null,
  unique(role_id, permission_code)
);

create index idx_role_permissions_role on public.role_permissions(role_id);

-- 3. Add role_id FK to profiles (keep legacy role text for backward compat)
alter table public.profiles add column if not exists
  role_id uuid references public.roles(id) on delete set null;

create index idx_profiles_role_id on public.profiles(role_id);

-- 4. RLS policies (tenant-level, same pattern as all other tables)
alter table public.roles enable row level security;
alter table public.role_permissions enable row level security;

-- Roles: tenant members can read, owner/admin can write
create policy "roles_select" on public.roles
  for select using (tenant_id = get_user_tenant_id());

create policy "roles_insert" on public.roles
  for insert with check (tenant_id = get_user_tenant_id());

create policy "roles_update" on public.roles
  for update using (tenant_id = get_user_tenant_id());

create policy "roles_delete" on public.roles
  for delete using (tenant_id = get_user_tenant_id());

-- Role permissions: accessible if the role belongs to user's tenant
create policy "role_permissions_select" on public.role_permissions
  for select using (
    exists (select 1 from public.roles where roles.id = role_permissions.role_id and roles.tenant_id = get_user_tenant_id())
  );

create policy "role_permissions_insert" on public.role_permissions
  for insert with check (
    exists (select 1 from public.roles where roles.id = role_permissions.role_id and roles.tenant_id = get_user_tenant_id())
  );

create policy "role_permissions_update" on public.role_permissions
  for update using (
    exists (select 1 from public.roles where roles.id = role_permissions.role_id and roles.tenant_id = get_user_tenant_id())
  );

create policy "role_permissions_delete" on public.role_permissions
  for delete using (
    exists (select 1 from public.roles where roles.id = role_permissions.role_id and roles.tenant_id = get_user_tenant_id())
  );

-- 5. Function: get user permissions (for app-layer caching)
create or replace function public.get_user_permissions(p_user_id uuid)
returns text[]
language sql
stable
security definer
as $$
  select coalesce(array_agg(rp.permission_code), '{}')
  from public.profiles p
  join public.role_permissions rp on rp.role_id = p.role_id
  where p.id = p_user_id;
$$;
