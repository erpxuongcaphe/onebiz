-- ============================================================
-- OneBiz ERP - Row Level Security Policies
-- Mọi table đều isolate theo tenant_id
-- ============================================================

-- Helper: lấy tenant_id của user hiện tại
create or replace function public.get_user_tenant_id()
returns uuid
language sql
stable
security definer
as $$
  select tenant_id from public.profiles where id = auth.uid()
$$;

-- ============================================================
-- Enable RLS trên tất cả tables
-- ============================================================
alter table public.tenants enable row level security;
alter table public.branches enable row level security;
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.suppliers enable row level security;
alter table public.customer_groups enable row level security;
alter table public.customers enable row level security;
alter table public.products enable row level security;
alter table public.price_books enable row level security;
alter table public.product_prices enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;
alter table public.stock_movements enable row level security;
alter table public.inventory_checks enable row level security;
alter table public.inventory_check_items enable row level security;
alter table public.sales_returns enable row level security;
alter table public.return_items enable row level security;
alter table public.delivery_partners enable row level security;
alter table public.shipping_orders enable row level security;
alter table public.cash_transactions enable row level security;
alter table public.sales_channels enable row level security;
alter table public.notifications enable row level security;
alter table public.code_sequences enable row level security;
alter table public.audit_log enable row level security;

-- ============================================================
-- TENANTS: user chỉ thấy tenant của mình
-- ============================================================
create policy "tenants_select" on public.tenants
  for select using (id = public.get_user_tenant_id());

-- ============================================================
-- BRANCHES
-- ============================================================
create policy "branches_select" on public.branches
  for select using (tenant_id = public.get_user_tenant_id());

create policy "branches_insert" on public.branches
  for insert with check (tenant_id = public.get_user_tenant_id());

create policy "branches_update" on public.branches
  for update using (tenant_id = public.get_user_tenant_id());

-- ============================================================
-- PROFILES
-- ============================================================
create policy "profiles_select" on public.profiles
  for select using (tenant_id = public.get_user_tenant_id());

create policy "profiles_update_own" on public.profiles
  for update using (id = auth.uid());

-- ============================================================
-- Macro: Standard CRUD policies cho tenant-scoped tables
-- ============================================================

-- CATEGORIES
create policy "categories_select" on public.categories
  for select using (tenant_id = public.get_user_tenant_id());
create policy "categories_insert" on public.categories
  for insert with check (tenant_id = public.get_user_tenant_id());
create policy "categories_update" on public.categories
  for update using (tenant_id = public.get_user_tenant_id());
create policy "categories_delete" on public.categories
  for delete using (tenant_id = public.get_user_tenant_id());

-- SUPPLIERS
create policy "suppliers_select" on public.suppliers
  for select using (tenant_id = public.get_user_tenant_id());
create policy "suppliers_insert" on public.suppliers
  for insert with check (tenant_id = public.get_user_tenant_id());
create policy "suppliers_update" on public.suppliers
  for update using (tenant_id = public.get_user_tenant_id());
create policy "suppliers_delete" on public.suppliers
  for delete using (tenant_id = public.get_user_tenant_id());

-- CUSTOMER GROUPS
create policy "customer_groups_select" on public.customer_groups
  for select using (tenant_id = public.get_user_tenant_id());
create policy "customer_groups_insert" on public.customer_groups
  for insert with check (tenant_id = public.get_user_tenant_id());
create policy "customer_groups_update" on public.customer_groups
  for update using (tenant_id = public.get_user_tenant_id());
create policy "customer_groups_delete" on public.customer_groups
  for delete using (tenant_id = public.get_user_tenant_id());

-- CUSTOMERS
create policy "customers_select" on public.customers
  for select using (tenant_id = public.get_user_tenant_id());
create policy "customers_insert" on public.customers
  for insert with check (tenant_id = public.get_user_tenant_id());
create policy "customers_update" on public.customers
  for update using (tenant_id = public.get_user_tenant_id());
create policy "customers_delete" on public.customers
  for delete using (tenant_id = public.get_user_tenant_id());

-- PRODUCTS
create policy "products_select" on public.products
  for select using (tenant_id = public.get_user_tenant_id());
create policy "products_insert" on public.products
  for insert with check (tenant_id = public.get_user_tenant_id());
create policy "products_update" on public.products
  for update using (tenant_id = public.get_user_tenant_id());
create policy "products_delete" on public.products
  for delete using (tenant_id = public.get_user_tenant_id());

-- PRICE BOOKS
create policy "price_books_select" on public.price_books
  for select using (tenant_id = public.get_user_tenant_id());
create policy "price_books_insert" on public.price_books
  for insert with check (tenant_id = public.get_user_tenant_id());
create policy "price_books_update" on public.price_books
  for update using (tenant_id = public.get_user_tenant_id());
create policy "price_books_delete" on public.price_books
  for delete using (tenant_id = public.get_user_tenant_id());

-- PRODUCT PRICES (qua price_book)
create policy "product_prices_select" on public.product_prices
  for select using (
    exists (
      select 1 from public.price_books pb
      where pb.id = product_prices.price_book_id
      and pb.tenant_id = public.get_user_tenant_id()
    )
  );
create policy "product_prices_insert" on public.product_prices
  for insert with check (
    exists (
      select 1 from public.price_books pb
      where pb.id = product_prices.price_book_id
      and pb.tenant_id = public.get_user_tenant_id()
    )
  );
create policy "product_prices_update" on public.product_prices
  for update using (
    exists (
      select 1 from public.price_books pb
      where pb.id = product_prices.price_book_id
      and pb.tenant_id = public.get_user_tenant_id()
    )
  );
create policy "product_prices_delete" on public.product_prices
  for delete using (
    exists (
      select 1 from public.price_books pb
      where pb.id = product_prices.price_book_id
      and pb.tenant_id = public.get_user_tenant_id()
    )
  );

-- INVOICES
create policy "invoices_select" on public.invoices
  for select using (tenant_id = public.get_user_tenant_id());
create policy "invoices_insert" on public.invoices
  for insert with check (tenant_id = public.get_user_tenant_id());
create policy "invoices_update" on public.invoices
  for update using (tenant_id = public.get_user_tenant_id());

-- INVOICE ITEMS (qua invoice)
create policy "invoice_items_select" on public.invoice_items
  for select using (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_items.invoice_id
      and i.tenant_id = public.get_user_tenant_id()
    )
  );
create policy "invoice_items_insert" on public.invoice_items
  for insert with check (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_items.invoice_id
      and i.tenant_id = public.get_user_tenant_id()
    )
  );
create policy "invoice_items_update" on public.invoice_items
  for update using (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_items.invoice_id
      and i.tenant_id = public.get_user_tenant_id()
    )
  );

-- PURCHASE ORDERS
create policy "po_select" on public.purchase_orders
  for select using (tenant_id = public.get_user_tenant_id());
create policy "po_insert" on public.purchase_orders
  for insert with check (tenant_id = public.get_user_tenant_id());
create policy "po_update" on public.purchase_orders
  for update using (tenant_id = public.get_user_tenant_id());

-- PURCHASE ORDER ITEMS (qua PO)
create policy "po_items_select" on public.purchase_order_items
  for select using (
    exists (
      select 1 from public.purchase_orders po
      where po.id = purchase_order_items.purchase_order_id
      and po.tenant_id = public.get_user_tenant_id()
    )
  );
create policy "po_items_insert" on public.purchase_order_items
  for insert with check (
    exists (
      select 1 from public.purchase_orders po
      where po.id = purchase_order_items.purchase_order_id
      and po.tenant_id = public.get_user_tenant_id()
    )
  );

-- STOCK MOVEMENTS
create policy "stock_moves_select" on public.stock_movements
  for select using (tenant_id = public.get_user_tenant_id());
create policy "stock_moves_insert" on public.stock_movements
  for insert with check (tenant_id = public.get_user_tenant_id());

-- INVENTORY CHECKS
create policy "inv_checks_select" on public.inventory_checks
  for select using (tenant_id = public.get_user_tenant_id());
create policy "inv_checks_insert" on public.inventory_checks
  for insert with check (tenant_id = public.get_user_tenant_id());
create policy "inv_checks_update" on public.inventory_checks
  for update using (tenant_id = public.get_user_tenant_id());

-- INVENTORY CHECK ITEMS (qua check)
create policy "inv_check_items_select" on public.inventory_check_items
  for select using (
    exists (
      select 1 from public.inventory_checks ic
      where ic.id = inventory_check_items.check_id
      and ic.tenant_id = public.get_user_tenant_id()
    )
  );
create policy "inv_check_items_insert" on public.inventory_check_items
  for insert with check (
    exists (
      select 1 from public.inventory_checks ic
      where ic.id = inventory_check_items.check_id
      and ic.tenant_id = public.get_user_tenant_id()
    )
  );

-- SALES RETURNS
create policy "returns_select" on public.sales_returns
  for select using (tenant_id = public.get_user_tenant_id());
create policy "returns_insert" on public.sales_returns
  for insert with check (tenant_id = public.get_user_tenant_id());
create policy "returns_update" on public.sales_returns
  for update using (tenant_id = public.get_user_tenant_id());

-- RETURN ITEMS (qua return)
create policy "return_items_select" on public.return_items
  for select using (
    exists (
      select 1 from public.sales_returns sr
      where sr.id = return_items.return_id
      and sr.tenant_id = public.get_user_tenant_id()
    )
  );
create policy "return_items_insert" on public.return_items
  for insert with check (
    exists (
      select 1 from public.sales_returns sr
      where sr.id = return_items.return_id
      and sr.tenant_id = public.get_user_tenant_id()
    )
  );

-- DELIVERY PARTNERS
create policy "delivery_partners_select" on public.delivery_partners
  for select using (tenant_id = public.get_user_tenant_id());
create policy "delivery_partners_insert" on public.delivery_partners
  for insert with check (tenant_id = public.get_user_tenant_id());
create policy "delivery_partners_update" on public.delivery_partners
  for update using (tenant_id = public.get_user_tenant_id());

-- SHIPPING ORDERS
create policy "shipping_select" on public.shipping_orders
  for select using (tenant_id = public.get_user_tenant_id());
create policy "shipping_insert" on public.shipping_orders
  for insert with check (tenant_id = public.get_user_tenant_id());
create policy "shipping_update" on public.shipping_orders
  for update using (tenant_id = public.get_user_tenant_id());

-- CASH TRANSACTIONS
create policy "cash_select" on public.cash_transactions
  for select using (tenant_id = public.get_user_tenant_id());
create policy "cash_insert" on public.cash_transactions
  for insert with check (tenant_id = public.get_user_tenant_id());

-- SALES CHANNELS
create policy "channels_select" on public.sales_channels
  for select using (tenant_id = public.get_user_tenant_id());
create policy "channels_insert" on public.sales_channels
  for insert with check (tenant_id = public.get_user_tenant_id());
create policy "channels_update" on public.sales_channels
  for update using (tenant_id = public.get_user_tenant_id());

-- NOTIFICATIONS
create policy "notifications_select" on public.notifications
  for select using (user_id = auth.uid());
create policy "notifications_update" on public.notifications
  for update using (user_id = auth.uid());

-- CODE SEQUENCES
create policy "code_seq_select" on public.code_sequences
  for select using (tenant_id = public.get_user_tenant_id());
create policy "code_seq_insert" on public.code_sequences
  for insert with check (tenant_id = public.get_user_tenant_id());
create policy "code_seq_update" on public.code_sequences
  for update using (tenant_id = public.get_user_tenant_id());

-- AUDIT LOG (read-only cho user)
create policy "audit_select" on public.audit_log
  for select using (tenant_id = public.get_user_tenant_id());
