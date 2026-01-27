-- OneBiz ERP - Tenant defaults for inserts
-- Auto-fill tenant_id based on current user profile.

create or replace function public.set_tenant_id_from_context()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.tenant_id is null then
    new.tenant_id := public.current_tenant_id();
  end if;
  return new;
end;
$$;

-- Inventory tables
drop trigger if exists trg_inventory_categories_tenant_id on public.inventory_categories;
create trigger trg_inventory_categories_tenant_id
before insert on public.inventory_categories
for each row execute procedure public.set_tenant_id_from_context();

drop trigger if exists trg_inventory_products_tenant_id on public.inventory_products;
create trigger trg_inventory_products_tenant_id
before insert on public.inventory_products
for each row execute procedure public.set_tenant_id_from_context();

drop trigger if exists trg_inventory_warehouses_tenant_id on public.inventory_warehouses;
create trigger trg_inventory_warehouses_tenant_id
before insert on public.inventory_warehouses
for each row execute procedure public.set_tenant_id_from_context();

drop trigger if exists trg_inventory_stock_tenant_id on public.inventory_stock;
create trigger trg_inventory_stock_tenant_id
before insert on public.inventory_stock
for each row execute procedure public.set_tenant_id_from_context();

drop trigger if exists trg_inventory_stock_movements_tenant_id on public.inventory_stock_movements;
create trigger trg_inventory_stock_movements_tenant_id
before insert on public.inventory_stock_movements
for each row execute procedure public.set_tenant_id_from_context();

-- Sales tables
drop trigger if exists trg_sales_customers_tenant_id on public.sales_customers;
create trigger trg_sales_customers_tenant_id
before insert on public.sales_customers
for each row execute procedure public.set_tenant_id_from_context();

drop trigger if exists trg_sales_orders_tenant_id on public.sales_orders;
create trigger trg_sales_orders_tenant_id
before insert on public.sales_orders
for each row execute procedure public.set_tenant_id_from_context();

drop trigger if exists trg_sales_order_items_tenant_id on public.sales_order_items;
create trigger trg_sales_order_items_tenant_id
before insert on public.sales_order_items
for each row execute procedure public.set_tenant_id_from_context();

-- Finance tables
drop trigger if exists trg_finance_accounts_tenant_id on public.finance_accounts;
create trigger trg_finance_accounts_tenant_id
before insert on public.finance_accounts
for each row execute procedure public.set_tenant_id_from_context();

drop trigger if exists trg_finance_transactions_tenant_id on public.finance_transactions;
create trigger trg_finance_transactions_tenant_id
before insert on public.finance_transactions
for each row execute procedure public.set_tenant_id_from_context();

drop trigger if exists trg_finance_transaction_lines_tenant_id on public.finance_transaction_lines;
create trigger trg_finance_transaction_lines_tenant_id
before insert on public.finance_transaction_lines
for each row execute procedure public.set_tenant_id_from_context();
