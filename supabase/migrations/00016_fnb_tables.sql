-- ============================================================
-- Sprint A: F&B POS — restaurant_tables, kitchen_orders, kitchen_order_items
-- + invoices.source column
-- ============================================================

-- 1. restaurant_tables
create table if not exists public.restaurant_tables (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  table_number int not null,
  name text not null,
  zone text,
  capacity int not null default 4,
  status text not null default 'available'
    check (status in ('available','occupied','reserved','cleaning')),
  current_order_id uuid,
  position_x int not null default 0,
  position_y int not null default 0,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. kitchen_orders
create table if not exists public.kitchen_orders (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  invoice_id uuid references public.invoices(id) on delete set null,
  table_id uuid references public.restaurant_tables(id) on delete set null,
  order_number text not null,
  order_type text not null default 'dine_in'
    check (order_type in ('dine_in','takeaway','delivery')),
  status text not null default 'pending'
    check (status in ('pending','preparing','ready','served','completed','cancelled')),
  note text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. kitchen_order_items
create table if not exists public.kitchen_order_items (
  id uuid primary key default uuid_generate_v4(),
  kitchen_order_id uuid not null references public.kitchen_orders(id) on delete cascade,
  product_id uuid not null references public.products(id),
  product_name text not null,
  variant_id uuid,
  variant_label text,
  quantity int not null default 1,
  unit_price numeric not null default 0,
  note text,
  toppings jsonb,
  status text not null default 'pending'
    check (status in ('pending','preparing','ready')),
  started_at timestamptz,
  completed_at timestamptz
);

-- 4. FK cho current_order_id
alter table public.restaurant_tables
  add constraint restaurant_tables_current_order_fkey
  foreign key (current_order_id) references public.kitchen_orders(id) on delete set null;

-- 5. Thêm source column vào invoices (phân biệt F&B vs retail)
alter table public.invoices add column if not exists
  source text not null default 'pos';
-- NOTE: check constraint sẽ dùng trigger hoặc app-level validation
-- vì ALTER ADD CHECK trên bảng có data cần xử lý cẩn thận

-- 6. RLS policies
alter table public.restaurant_tables enable row level security;
alter table public.kitchen_orders enable row level security;
alter table public.kitchen_order_items enable row level security;

-- restaurant_tables policies
create policy "restaurant_tables_select" on public.restaurant_tables
  for select using (tenant_id = public.get_user_tenant_id());

create policy "restaurant_tables_insert" on public.restaurant_tables
  for insert with check (tenant_id = public.get_user_tenant_id());

create policy "restaurant_tables_update" on public.restaurant_tables
  for update using (tenant_id = public.get_user_tenant_id());

-- kitchen_orders policies
create policy "kitchen_orders_select" on public.kitchen_orders
  for select using (tenant_id = public.get_user_tenant_id());

create policy "kitchen_orders_insert" on public.kitchen_orders
  for insert with check (tenant_id = public.get_user_tenant_id());

create policy "kitchen_orders_update" on public.kitchen_orders
  for update using (tenant_id = public.get_user_tenant_id());

-- kitchen_order_items policies (via kitchen_orders tenant check)
create policy "kitchen_order_items_select" on public.kitchen_order_items
  for select using (
    exists (
      select 1 from public.kitchen_orders ko
      where ko.id = kitchen_order_id
        and ko.tenant_id = public.get_user_tenant_id()
    )
  );

create policy "kitchen_order_items_insert" on public.kitchen_order_items
  for insert with check (
    exists (
      select 1 from public.kitchen_orders ko
      where ko.id = kitchen_order_id
        and ko.tenant_id = public.get_user_tenant_id()
    )
  );

create policy "kitchen_order_items_update" on public.kitchen_order_items
  for update using (
    exists (
      select 1 from public.kitchen_orders ko
      where ko.id = kitchen_order_id
        and ko.tenant_id = public.get_user_tenant_id()
    )
  );

-- 7. Indexes
create index if not exists idx_restaurant_tables_branch
  on public.restaurant_tables(branch_id) where is_active = true;

create index if not exists idx_kitchen_orders_branch_status
  on public.kitchen_orders(branch_id, status);

create index if not exists idx_kitchen_order_items_order
  on public.kitchen_order_items(kitchen_order_id);
