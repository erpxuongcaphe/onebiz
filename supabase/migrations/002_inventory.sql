-- OneBiz ERP - Inventory module schema

create extension if not exists pg_trgm;

-- Categories
create table if not exists public.inventory_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  code text,
  parent_id uuid references public.inventory_categories (id) on delete set null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create index if not exists idx_inventory_categories_tenant_id on public.inventory_categories (tenant_id);
alter table public.inventory_categories enable row level security;

create policy "inventory_categories: read within tenant"
on public.inventory_categories
for select
using (tenant_id = public.current_tenant_id());

-- Products
create table if not exists public.inventory_products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  sku text not null,
  name text not null,
  category_id uuid references public.inventory_categories (id) on delete set null,
  description text,
  unit text not null default 'pcs',
  cost_price numeric(15, 2),
  selling_price numeric(15, 2),
  min_stock_level numeric(15, 3) not null default 0,
  barcode text,
  image_url text,
  status text not null default 'active' check (status in ('active', 'inactive', 'discontinued')),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, sku)
);

create index if not exists idx_inventory_products_tenant_id on public.inventory_products (tenant_id);
create index if not exists idx_inventory_products_sku on public.inventory_products (sku);
create index if not exists idx_inventory_products_name_trgm on public.inventory_products using gin (name gin_trgm_ops);
alter table public.inventory_products enable row level security;

create policy "inventory_products: read within tenant"
on public.inventory_products
for select
using (tenant_id = public.current_tenant_id());

-- Warehouses
create table if not exists public.inventory_warehouses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  code text not null,
  address text,
  manager_id uuid references public.profiles (id) on delete set null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create index if not exists idx_inventory_warehouses_tenant_id on public.inventory_warehouses (tenant_id);
alter table public.inventory_warehouses enable row level security;

create policy "inventory_warehouses: read within tenant"
on public.inventory_warehouses
for select
using (tenant_id = public.current_tenant_id());

-- Stock levels per warehouse
create table if not exists public.inventory_stock (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  product_id uuid not null references public.inventory_products (id) on delete cascade,
  warehouse_id uuid not null references public.inventory_warehouses (id) on delete cascade,
  quantity numeric(15, 3) not null default 0,
  reserved_quantity numeric(15, 3) not null default 0,
  updated_at timestamptz not null default now(),
  unique (tenant_id, product_id, warehouse_id)
);

create index if not exists idx_inventory_stock_tenant_id on public.inventory_stock (tenant_id);
create index if not exists idx_inventory_stock_product_id on public.inventory_stock (product_id);
alter table public.inventory_stock enable row level security;

create policy "inventory_stock: read within tenant"
on public.inventory_stock
for select
using (tenant_id = public.current_tenant_id());

-- Stock movements (audit trail)
create table if not exists public.inventory_stock_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  product_id uuid not null references public.inventory_products (id) on delete cascade,
  warehouse_id uuid not null references public.inventory_warehouses (id) on delete cascade,
  movement_type text not null check (movement_type in (
    'purchase', 'sale', 'transfer_in', 'transfer_out',
    'adjustment', 'return', 'damage', 'stocktake'
  )),
  quantity numeric(15, 3) not null,
  reference_type text,
  reference_id uuid,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_inventory_stock_movements_tenant_id on public.inventory_stock_movements (tenant_id);
create index if not exists idx_inventory_stock_movements_product_created on public.inventory_stock_movements (product_id, created_at desc);
alter table public.inventory_stock_movements enable row level security;

create policy "inventory_stock_movements: read within tenant"
on public.inventory_stock_movements
for select
using (tenant_id = public.current_tenant_id());
