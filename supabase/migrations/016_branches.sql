-- OneBiz ERP - Branches (multi-location readiness)

create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  code text not null,
  name text not null,
  address text,
  timezone text not null default 'Asia/Ho_Chi_Minh',
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create index if not exists idx_branches_tenant_id on public.branches (tenant_id);
alter table public.branches enable row level security;

create policy "branches: read within tenant"
on public.branches
for select
using (tenant_id = public.current_tenant_id());

-- Default branch per tenant
create or replace function public.seed_default_branch(p_tenant_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  b_id uuid;
begin
  select id into b_id
  from public.branches
  where tenant_id = p_tenant_id
  order by created_at asc
  limit 1;

  if b_id is not null then
    return b_id;
  end if;

  insert into public.branches (tenant_id, code, name, address)
  values (p_tenant_id, 'CN-001', 'Chi nhanh mac dinh', null)
  returning id into b_id;

  return b_id;
end;
$$;

grant execute on function public.seed_default_branch(uuid) to authenticated;

-- Link profiles to a branch
alter table public.profiles
add column if not exists branch_id uuid references public.branches (id) on delete set null;

create index if not exists idx_profiles_branch_id on public.profiles (branch_id);

-- Link warehouses to a branch
alter table public.inventory_warehouses
add column if not exists branch_id uuid references public.branches (id) on delete set null;

create index if not exists idx_inventory_warehouses_branch_id on public.inventory_warehouses (branch_id);

-- Update handle_new_tenant to seed roles + default branch
create or replace function public.handle_new_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_default_roles(new.id);
  perform public.seed_default_branch(new.id);
  return new;
end;
$$;

drop trigger if exists on_tenant_created on public.tenants;
create trigger on_tenant_created
after insert on public.tenants
for each row execute procedure public.handle_new_tenant();

-- Update handle_new_user to assign tenant + default branch
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t_id uuid;
  b_id uuid;
  full_name text;
  role_id uuid;
  has_any_role boolean;
  requested_tenant uuid;
begin
  -- Prefer tenant_id provided by frontend during signup
  requested_tenant := null;
  begin
    requested_tenant := (new.raw_user_meta_data->>'tenant_id')::uuid;
  exception when others then
    requested_tenant := null;
  end;

  if requested_tenant is not null then
    select id into t_id from public.tenants where id = requested_tenant limit 1;
  end if;

  if t_id is null then
    select id into t_id from public.tenants where custom_domain = 'onebiz.com.vn' limit 1;
  end if;
  if t_id is null then
    select id into t_id from public.tenants order by created_at asc limit 1;
  end if;

  full_name := coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1));

  b_id := public.seed_default_branch(t_id);
  perform public.seed_default_roles(t_id);

  insert into public.profiles (id, tenant_id, branch_id, email, full_name)
  values (new.id, t_id, b_id, new.email, full_name)
  on conflict (id) do nothing;

  select exists(select 1 from public.user_roles where tenant_id = t_id) into has_any_role;
  if not has_any_role then
    select id into role_id from public.roles where tenant_id = t_id and name = 'Super Admin' limit 1;
  else
    select id into role_id from public.roles where tenant_id = t_id and name = 'Employee' limit 1;
  end if;

  if role_id is not null then
    insert into public.user_roles (tenant_id, user_id, role_id)
    values (t_id, new.id, role_id)
    on conflict do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();
