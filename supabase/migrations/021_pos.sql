-- OneBiz ERP - POS schema (branch-aware)

create table if not exists public.pos_shifts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  branch_id uuid not null references public.branches (id) on delete restrict,
  code text not null,
  status text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  opened_by uuid references public.profiles (id) on delete set null,
  opened_at timestamptz not null default now(),
  opening_cash numeric(15,2) not null default 0,
  closed_by uuid references public.profiles (id) on delete set null,
  closed_at timestamptz,
  closing_cash numeric(15,2),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, branch_id, code)
);

create index if not exists idx_pos_shifts_tenant_branch on public.pos_shifts (tenant_id, branch_id, opened_at desc);
alter table public.pos_shifts enable row level security;

create table if not exists public.pos_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  branch_id uuid not null references public.branches (id) on delete restrict,
  shift_id uuid references public.pos_shifts (id) on delete set null,
  order_number text not null,
  status text not null default 'draft' check (status in ('draft', 'paid', 'void', 'refunded')),
  customer_id uuid references public.sales_customers (id) on delete set null,
  subtotal numeric(15,2) not null default 0,
  discount numeric(15,2) not null default 0,
  tax numeric(15,2) not null default 0,
  total numeric(15,2) not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, branch_id, order_number)
);

create index if not exists idx_pos_orders_tenant_branch_time on public.pos_orders (tenant_id, branch_id, created_at desc);
alter table public.pos_orders enable row level security;

create table if not exists public.pos_order_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  order_id uuid not null references public.pos_orders (id) on delete cascade,
  product_id uuid not null references public.inventory_products (id) on delete restrict,
  sku text,
  name text,
  quantity numeric(15,3) not null,
  unit_price numeric(15,2) not null,
  discount numeric(15,2) not null default 0,
  tax_rate numeric(5,2) not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_pos_order_items_order_id on public.pos_order_items (order_id);
alter table public.pos_order_items enable row level security;

create table if not exists public.pos_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  order_id uuid not null references public.pos_orders (id) on delete cascade,
  method text not null check (method in ('cash', 'bank_transfer', 'card', 'momo', 'zalopay', 'other')),
  amount numeric(15,2) not null,
  paid_at timestamptz not null default now(),
  reference text,
  created_at timestamptz not null default now()
);

create index if not exists idx_pos_payments_order_id on public.pos_payments (order_id);
alter table public.pos_payments enable row level security;
