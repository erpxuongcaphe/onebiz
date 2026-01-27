-- OneBiz ERP - Inventory policies using RBAC

-- Read policies
drop policy if exists "inventory_categories: read within tenant" on public.inventory_categories;
create policy "inventory_categories: read"
on public.inventory_categories
for select
using (
  tenant_id = public.current_tenant_id()
  and public.has_permission('inventory.read')
);

drop policy if exists "inventory_products: read within tenant" on public.inventory_products;
create policy "inventory_products: read"
on public.inventory_products
for select
using (
  tenant_id = public.current_tenant_id()
  and public.has_permission('inventory.read')
);

drop policy if exists "inventory_warehouses: read within tenant" on public.inventory_warehouses;
create policy "inventory_warehouses: read"
on public.inventory_warehouses
for select
using (
  tenant_id = public.current_tenant_id()
  and public.has_permission('inventory.read')
);

drop policy if exists "inventory_stock: read within tenant" on public.inventory_stock;
create policy "inventory_stock: read"
on public.inventory_stock
for select
using (
  tenant_id = public.current_tenant_id()
  and public.has_permission('inventory.read')
);

drop policy if exists "inventory_stock_movements: read within tenant" on public.inventory_stock_movements;
create policy "inventory_stock_movements: read"
on public.inventory_stock_movements
for select
using (
  tenant_id = public.current_tenant_id()
  and public.has_permission('inventory.movement.read')
);


-- Write policies

-- Categories
drop policy if exists "inventory_categories: insert within tenant" on public.inventory_categories;
create policy "inventory_categories: insert"
on public.inventory_categories
for insert
with check (
  tenant_id = public.current_tenant_id()
  and public.has_permission('inventory.category.create')
);

drop policy if exists "inventory_categories: update within tenant" on public.inventory_categories;
create policy "inventory_categories: update"
on public.inventory_categories
for update
using (
  tenant_id = public.current_tenant_id()
  and public.has_permission('inventory.category.update')
)
with check (
  tenant_id = public.current_tenant_id()
  and public.has_permission('inventory.category.update')
);

drop policy if exists "inventory_categories: delete within tenant" on public.inventory_categories;
create policy "inventory_categories: delete"
on public.inventory_categories
for delete
using (
  tenant_id = public.current_tenant_id()
  and public.has_permission('inventory.category.delete')
);

-- Products
drop policy if exists "inventory_products: insert within tenant" on public.inventory_products;
create policy "inventory_products: insert"
on public.inventory_products
for insert
with check (
  tenant_id = public.current_tenant_id()
  and public.has_permission('inventory.product.create')
);

drop policy if exists "inventory_products: update within tenant" on public.inventory_products;
create policy "inventory_products: update"
on public.inventory_products
for update
using (
  tenant_id = public.current_tenant_id()
  and public.has_permission('inventory.product.update')
)
with check (
  tenant_id = public.current_tenant_id()
  and public.has_permission('inventory.product.update')
);

drop policy if exists "inventory_products: delete within tenant" on public.inventory_products;
create policy "inventory_products: delete"
on public.inventory_products
for delete
using (
  tenant_id = public.current_tenant_id()
  and public.has_permission('inventory.product.delete.hard')
);

-- Warehouses
drop policy if exists "inventory_warehouses: insert within tenant" on public.inventory_warehouses;
create policy "inventory_warehouses: insert"
on public.inventory_warehouses
for insert
with check (
  tenant_id = public.current_tenant_id()
  and public.has_permission('inventory.warehouse.create')
);

drop policy if exists "inventory_warehouses: update within tenant" on public.inventory_warehouses;
create policy "inventory_warehouses: update"
on public.inventory_warehouses
for update
using (
  tenant_id = public.current_tenant_id()
  and public.has_permission('inventory.warehouse.update')
)
with check (
  tenant_id = public.current_tenant_id()
  and public.has_permission('inventory.warehouse.update')
);

drop policy if exists "inventory_warehouses: delete within tenant" on public.inventory_warehouses;
create policy "inventory_warehouses: delete"
on public.inventory_warehouses
for delete
using (
  tenant_id = public.current_tenant_id()
  and public.has_permission('inventory.warehouse.delete.hard')
);

-- Stock
drop policy if exists "inventory_stock: upsert within tenant" on public.inventory_stock;
create policy "inventory_stock: insert"
on public.inventory_stock
for insert
with check (
  tenant_id = public.current_tenant_id()
  and public.has_permission('inventory.stock.adjust')
);

drop policy if exists "inventory_stock: update within tenant" on public.inventory_stock;
create policy "inventory_stock: update"
on public.inventory_stock
for update
using (
  tenant_id = public.current_tenant_id()
  and public.has_permission('inventory.stock.adjust')
)
with check (
  tenant_id = public.current_tenant_id()
  and public.has_permission('inventory.stock.adjust')
);

-- Movements
drop policy if exists "inventory_stock_movements: insert within tenant" on public.inventory_stock_movements;
create policy "inventory_stock_movements: insert"
on public.inventory_stock_movements
for insert
with check (
  tenant_id = public.current_tenant_id()
  and public.has_permission('inventory.stock.adjust')
);
