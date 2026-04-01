-- ============================================================
-- OneBiz ERP - Initial Database Schema
-- Multi-tenant ERP cho SMB Việt Nam
-- ============================================================

-- Enable extensions
create extension if not exists "uuid-ossp";

-- ============================================================
-- 1. TENANTS (Doanh nghiệp)
-- ============================================================
create table public.tenants (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text not null unique,
  settings jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- 2. BRANCHES (Chi nhánh)
-- ============================================================
create table public.branches (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  address text,
  phone text,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_branches_tenant on public.branches(tenant_id);

-- ============================================================
-- 3. PROFILES (Người dùng - extends auth.users)
-- ============================================================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  full_name text not null,
  email text not null,
  phone text,
  avatar_url text,
  role text not null default 'staff'
    check (role in ('owner', 'admin', 'manager', 'staff', 'cashier')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_profiles_tenant on public.profiles(tenant_id);

-- ============================================================
-- 4. CATEGORIES (Nhóm hàng)
-- ============================================================
create table public.categories (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  parent_id uuid references public.categories(id) on delete set null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index idx_categories_tenant on public.categories(tenant_id);

-- ============================================================
-- 5. SUPPLIERS (Nhà cung cấp)
-- ============================================================
create table public.suppliers (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  name text not null,
  phone text,
  email text,
  address text,
  tax_code text,
  debt numeric(15,2) not null default 0,
  note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id, code)
);

create index idx_suppliers_tenant on public.suppliers(tenant_id);

-- ============================================================
-- 6. CUSTOMER GROUPS (Nhóm khách hàng)
-- ============================================================
create table public.customer_groups (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  discount_percent numeric(5,2) not null default 0,
  note text,
  created_at timestamptz not null default now()
);

create index idx_customer_groups_tenant on public.customer_groups(tenant_id);

-- ============================================================
-- 7. CUSTOMERS (Khách hàng)
-- ============================================================
create table public.customers (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  name text not null,
  phone text,
  email text,
  address text,
  group_id uuid references public.customer_groups(id) on delete set null,
  gender text check (gender in ('male', 'female')),
  customer_type text not null default 'individual'
    check (customer_type in ('individual', 'company')),
  debt numeric(15,2) not null default 0,
  total_spent numeric(15,2) not null default 0,
  total_orders int not null default 0,
  note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id, code)
);

create index idx_customers_tenant on public.customers(tenant_id);
create index idx_customers_phone on public.customers(tenant_id, phone);

-- ============================================================
-- 8. PRODUCTS (Hàng hóa)
-- ============================================================
create table public.products (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  barcode text,
  name text not null,
  category_id uuid references public.categories(id) on delete set null,
  unit text not null default 'Cái',
  cost_price numeric(15,2) not null default 0,
  sell_price numeric(15,2) not null default 0,
  stock numeric(15,2) not null default 0,
  min_stock numeric(15,2) not null default 0,
  max_stock numeric(15,2) not null default 0,
  weight numeric(10,2),
  description text,
  image_url text,
  allow_sale boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id, code)
);

create index idx_products_tenant on public.products(tenant_id);
create index idx_products_category on public.products(tenant_id, category_id);
create index idx_products_barcode on public.products(tenant_id, barcode) where barcode is not null;

-- ============================================================
-- 9. PRICE BOOKS (Bảng giá)
-- ============================================================
create table public.price_books (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  start_date date,
  end_date date,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index idx_price_books_tenant on public.price_books(tenant_id);

-- ============================================================
-- 10. PRODUCT PRICES (Giá sản phẩm theo bảng giá)
-- ============================================================
create table public.product_prices (
  id uuid primary key default uuid_generate_v4(),
  price_book_id uuid not null references public.price_books(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  price numeric(15,2) not null,
  unique(price_book_id, product_id)
);

-- ============================================================
-- 11. INVOICES (Hóa đơn bán hàng)
-- ============================================================
create table public.invoices (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  code text not null,
  customer_id uuid references public.customers(id) on delete set null,
  customer_name text not null default 'Khách lẻ',
  status text not null default 'draft'
    check (status in ('draft', 'confirmed', 'completed', 'cancelled')),
  subtotal numeric(15,2) not null default 0,
  discount_amount numeric(15,2) not null default 0,
  total numeric(15,2) not null default 0,
  paid numeric(15,2) not null default 0,
  debt numeric(15,2) not null default 0,
  payment_method text not null default 'cash'
    check (payment_method in ('cash', 'transfer', 'card', 'mixed')),
  note text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id, code)
);

create index idx_invoices_tenant on public.invoices(tenant_id);
create index idx_invoices_customer on public.invoices(tenant_id, customer_id);
create index idx_invoices_date on public.invoices(tenant_id, created_at desc);

-- ============================================================
-- 12. INVOICE ITEMS (Chi tiết hóa đơn)
-- ============================================================
create table public.invoice_items (
  id uuid primary key default uuid_generate_v4(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  product_id uuid not null references public.products(id),
  product_name text not null,
  unit text not null default 'Cái',
  quantity numeric(15,2) not null default 1,
  unit_price numeric(15,2) not null default 0,
  discount numeric(15,2) not null default 0,
  total numeric(15,2) not null default 0
);

create index idx_invoice_items_invoice on public.invoice_items(invoice_id);

-- ============================================================
-- 13. PURCHASE ORDERS (Đơn nhập hàng)
-- ============================================================
create table public.purchase_orders (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  code text not null,
  supplier_id uuid not null references public.suppliers(id),
  supplier_name text not null,
  status text not null default 'draft'
    check (status in ('draft', 'ordered', 'partial', 'completed', 'cancelled')),
  subtotal numeric(15,2) not null default 0,
  discount_amount numeric(15,2) not null default 0,
  total numeric(15,2) not null default 0,
  paid numeric(15,2) not null default 0,
  debt numeric(15,2) not null default 0,
  note text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id, code)
);

create index idx_po_tenant on public.purchase_orders(tenant_id);

-- ============================================================
-- 14. PURCHASE ORDER ITEMS (Chi tiết đơn nhập)
-- ============================================================
create table public.purchase_order_items (
  id uuid primary key default uuid_generate_v4(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  product_id uuid not null references public.products(id),
  product_name text not null,
  unit text not null default 'Cái',
  quantity numeric(15,2) not null default 0,
  received_quantity numeric(15,2) not null default 0,
  unit_price numeric(15,2) not null default 0,
  discount numeric(15,2) not null default 0,
  total numeric(15,2) not null default 0
);

create index idx_po_items_po on public.purchase_order_items(purchase_order_id);

-- ============================================================
-- 15. STOCK MOVEMENTS (Lịch sử kho)
-- ============================================================
create table public.stock_movements (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  product_id uuid not null references public.products(id),
  type text not null check (type in ('in', 'out', 'adjust', 'transfer')),
  quantity numeric(15,2) not null,
  reference_type text,
  reference_id uuid,
  note text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index idx_stock_moves_product on public.stock_movements(tenant_id, product_id);
create index idx_stock_moves_date on public.stock_movements(tenant_id, created_at desc);

-- ============================================================
-- 16. INVENTORY CHECKS (Kiểm kho)
-- ============================================================
create table public.inventory_checks (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  code text not null,
  status text not null default 'draft'
    check (status in ('draft', 'in_progress', 'balanced', 'cancelled')),
  note text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id, code)
);

-- ============================================================
-- 17. INVENTORY CHECK ITEMS
-- ============================================================
create table public.inventory_check_items (
  id uuid primary key default uuid_generate_v4(),
  check_id uuid not null references public.inventory_checks(id) on delete cascade,
  product_id uuid not null references public.products(id),
  product_name text not null,
  system_stock numeric(15,2) not null default 0,
  actual_stock numeric(15,2) not null default 0,
  difference numeric(15,2) not null default 0
);

-- ============================================================
-- 18. SALES RETURNS (Trả hàng)
-- ============================================================
create table public.sales_returns (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  code text not null,
  invoice_id uuid not null references public.invoices(id),
  customer_id uuid references public.customers(id) on delete set null,
  customer_name text not null default 'Khách lẻ',
  status text not null default 'draft'
    check (status in ('draft', 'confirmed', 'completed', 'cancelled')),
  total numeric(15,2) not null default 0,
  refunded numeric(15,2) not null default 0,
  reason text,
  note text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id, code)
);

create index idx_returns_tenant on public.sales_returns(tenant_id);

-- ============================================================
-- 19. RETURN ITEMS (Chi tiết trả hàng)
-- ============================================================
create table public.return_items (
  id uuid primary key default uuid_generate_v4(),
  return_id uuid not null references public.sales_returns(id) on delete cascade,
  product_id uuid not null references public.products(id),
  product_name text not null,
  unit text not null default 'Cái',
  quantity numeric(15,2) not null default 1,
  unit_price numeric(15,2) not null default 0,
  total numeric(15,2) not null default 0
);

-- ============================================================
-- 20. DELIVERY PARTNERS (Đối tác giao hàng)
-- ============================================================
create table public.delivery_partners (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  code text not null,
  phone text,
  api_key text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(tenant_id, code)
);

-- ============================================================
-- 21. SHIPPING ORDERS (Vận đơn)
-- ============================================================
create table public.shipping_orders (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id),
  partner_id uuid references public.delivery_partners(id) on delete set null,
  code text not null,
  status text not null default 'pending'
    check (status in ('pending', 'picked_up', 'in_transit', 'delivered', 'returned', 'cancelled')),
  shipping_fee numeric(15,2) not null default 0,
  cod_amount numeric(15,2) not null default 0,
  receiver_name text not null,
  receiver_phone text not null,
  receiver_address text not null,
  tracking_code text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id, code)
);

create index idx_shipping_tenant on public.shipping_orders(tenant_id);

-- ============================================================
-- 22. CASH TRANSACTIONS (Sổ quỹ - Thu chi)
-- ============================================================
create table public.cash_transactions (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  code text not null,
  type text not null check (type in ('receipt', 'payment')),
  category text not null,
  amount numeric(15,2) not null default 0,
  counterparty text,
  payment_method text not null default 'cash'
    check (payment_method in ('cash', 'transfer', 'card')),
  reference_type text,
  reference_id uuid,
  note text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(tenant_id, code)
);

create index idx_cash_tenant on public.cash_transactions(tenant_id);
create index idx_cash_date on public.cash_transactions(tenant_id, created_at desc);

-- ============================================================
-- 23. SALES CHANNELS (Kênh bán hàng online)
-- ============================================================
create table public.sales_channels (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  platform text not null,
  api_key text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 24. NOTIFICATIONS (Thông báo)
-- ============================================================
create table public.notifications (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  description text,
  is_read boolean not null default false,
  reference_type text,
  reference_id uuid,
  created_at timestamptz not null default now()
);

create index idx_notifications_user on public.notifications(user_id, is_read, created_at desc);

-- ============================================================
-- 25. CODE SEQUENCES (Sinh mã tự động)
-- ============================================================
create table public.code_sequences (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  entity_type text not null,
  prefix text not null,
  current_number int not null default 0,
  padding int not null default 6,
  unique(tenant_id, entity_type)
);

-- ============================================================
-- 26. AUDIT LOG (Nhật ký hoạt động)
-- ============================================================
create table public.audit_log (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  old_data jsonb,
  new_data jsonb,
  ip_address text,
  created_at timestamptz not null default now()
);

create index idx_audit_tenant on public.audit_log(tenant_id, created_at desc);
