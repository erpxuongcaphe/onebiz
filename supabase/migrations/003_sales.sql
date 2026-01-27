-- OneBiz ERP - Sales module schema

create table if not exists public.sales_customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  code text not null,
  name text not null,
  email text,
  phone text,
  address text,
  tax_code text,
  customer_type text not null default 'individual' check (customer_type in ('individual', 'company')),
  credit_limit numeric(15, 2) not null default 0,
  payment_term_days int not null default 0,
  status text not null default 'active' check (status in ('active', 'inactive', 'blocked')),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create index if not exists idx_sales_customers_tenant_id on public.sales_customers (tenant_id);
alter table public.sales_customers enable row level security;

create policy "sales_customers: read within tenant"
on public.sales_customers
for select
using (tenant_id = public.current_tenant_id());

create table if not exists public.sales_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  order_number text not null,
  customer_id uuid not null references public.sales_customers (id) on delete restrict,
  order_date date not null default current_date,
  delivery_date date,
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled')),
  subtotal numeric(15, 2) not null default 0,
  discount numeric(15, 2) not null default 0,
  tax numeric(15, 2) not null default 0,
  total numeric(15, 2) not null default 0,
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'partial', 'paid', 'refunded')),
  shipping_address text,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, order_number)
);

create index if not exists idx_sales_orders_tenant_id on public.sales_orders (tenant_id);
create index if not exists idx_sales_orders_order_date on public.sales_orders (order_date desc);
alter table public.sales_orders enable row level security;

create policy "sales_orders: read within tenant"
on public.sales_orders
for select
using (tenant_id = public.current_tenant_id());

create table if not exists public.sales_order_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  order_id uuid not null references public.sales_orders (id) on delete cascade,
  product_id uuid not null references public.inventory_products (id) on delete restrict,
  quantity numeric(15, 3) not null,
  unit_price numeric(15, 2) not null,
  discount numeric(15, 2) not null default 0,
  tax_rate numeric(5, 2) not null default 0,
  created_at timestamptz not null default now(),
  unique (order_id, product_id)
);

create index if not exists idx_sales_order_items_tenant_id on public.sales_order_items (tenant_id);
create index if not exists idx_sales_order_items_order_id on public.sales_order_items (order_id);
alter table public.sales_order_items enable row level security;

create policy "sales_order_items: read within tenant"
on public.sales_order_items
for select
using (tenant_id = public.current_tenant_id());
