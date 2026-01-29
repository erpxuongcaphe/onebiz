-- Create inventory_units table to manage product units
create table if not exists public.inventory_units (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  code text not null, -- e.g., 'kg', 'pcs'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);

-- RLS
alter table public.inventory_units enable row level security;

create policy "inventory_units: read within tenant"
on public.inventory_units
for select
using (tenant_id = public.current_tenant_id());

create policy "inventory_units: insert within tenant"
on public.inventory_units
for insert
with check (tenant_id = public.current_tenant_id());

create policy "inventory_units: update within tenant"
on public.inventory_units
for update
using (tenant_id = public.current_tenant_id());

create policy "inventory_units: delete within tenant"
on public.inventory_units
for delete
using (tenant_id = public.current_tenant_id());

-- Seed default units
insert into public.inventory_units (tenant_id, name, code)
select id, 'Cái', 'pcs' from public.tenants
on conflict do nothing;

insert into public.inventory_units (tenant_id, name, code)
select id, 'Kilogram', 'kg' from public.tenants
on conflict do nothing;
