-- Sales order workflow, POS invoice unpaid, and walk-in customer

-- 1) Extend sales_orders for branch/warehouse and new statuses
alter table public.sales_orders
  add column if not exists branch_id uuid references public.branches (id) on delete restrict,
  add column if not exists warehouse_id uuid references public.inventory_warehouses (id) on delete restrict,
  add column if not exists due_date date;

update public.sales_orders
set branch_id = coalesce(branch_id, (select id from public.branches order by created_at asc limit 1))
where branch_id is null;

update public.sales_orders so
set warehouse_id = coalesce(
  so.warehouse_id,
  (select w.id from public.inventory_warehouses w where w.branch_id = so.branch_id order by created_at asc limit 1),
  (select w.id from public.inventory_warehouses w order by created_at asc limit 1)
)
where so.warehouse_id is null;

alter table public.sales_orders
  drop constraint if exists sales_orders_status_check;

alter table public.sales_orders
  add constraint sales_orders_status_check
    check (status in (
      'draft',
      'confirmed',
      'processing',
      'shipped',
      'delivered',
      'waiting_pick',
      'completed',
      'cancelled'
    ));

-- 2) Ensure walk-in customer exists per tenant
insert into public.sales_customers (tenant_id, code, name, status)
select t.id, 'WALKIN', 'Khách lẻ', 'active'
from public.tenants t
where not exists (
  select 1 from public.sales_customers c where c.tenant_id = t.id and c.code = 'WALKIN'
);

-- 3) Allow sales order and customer insert/update with POS permissions
drop policy if exists "sales_orders: insert" on public.sales_orders;
create policy "sales_orders: insert"
on public.sales_orders
for insert
with check (
  tenant_id = public.current_tenant_id()
  and public.has_permission('pos.order.create')
);

drop policy if exists "sales_orders: update" on public.sales_orders;
create policy "sales_orders: update"
on public.sales_orders
for update
using (
  tenant_id = public.current_tenant_id()
  and public.has_permission('pos.order.update')
)
with check (
  tenant_id = public.current_tenant_id()
  and public.has_permission('pos.order.update')
);

drop policy if exists "sales_order_items: insert" on public.sales_order_items;
create policy "sales_order_items: insert"
on public.sales_order_items
for insert
with check (
  tenant_id = public.current_tenant_id()
  and public.has_permission('pos.order.create')
);

drop policy if exists "sales_order_items: update" on public.sales_order_items;
create policy "sales_order_items: update"
on public.sales_order_items
for update
using (
  tenant_id = public.current_tenant_id()
  and public.has_permission('pos.order.update')
)
with check (
  tenant_id = public.current_tenant_id()
  and public.has_permission('pos.order.update')
);

drop policy if exists "sales_customers: insert" on public.sales_customers;
create policy "sales_customers: insert"
on public.sales_customers
for insert
with check (
  tenant_id = public.current_tenant_id()
  and public.has_permission('pos.order.create')
);

drop policy if exists "sales_customers: update" on public.sales_customers;
create policy "sales_customers: update"
on public.sales_customers
for update
using (
  tenant_id = public.current_tenant_id()
  and public.has_permission('pos.order.update')
)
with check (
  tenant_id = public.current_tenant_id()
  and public.has_permission('pos.order.update')
);

-- 4) POS orders: add unpaid + link to sales order
alter table public.pos_orders
  add column if not exists sales_order_id uuid references public.sales_orders (id) on delete set null;

alter table public.pos_orders
  add column if not exists due_date date;

create index if not exists idx_pos_orders_sales_order_id on public.pos_orders (sales_order_id);

alter table public.pos_orders
  drop constraint if exists pos_orders_status_check;

alter table public.pos_orders
  add constraint pos_orders_status_check
    check (status in ('draft', 'paid', 'void', 'refunded', 'unpaid'));

-- 5) Update POS sale RPC to accept customer_id
drop function if exists public.pos_create_sale(uuid, uuid, uuid, jsonb, text, numeric);

create or replace function public.pos_create_sale(
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_shift_id uuid,
  p_lines jsonb,
  p_payment_method text,
  p_payment_amount numeric,
  p_customer_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  t_id uuid;
  order_id uuid;
  order_no text;
  total numeric := 0;
  line jsonb;
  qty numeric;
  unit_price numeric;
  prod_id uuid;
  sku text;
  name text;
  wh_branch uuid;
begin
  if not public.has_permission('pos.order.create') or not public.has_permission('pos.payment.record') then
    raise exception 'Permission denied';
  end if;

  t_id := public.current_tenant_id();
  if t_id is null then
    raise exception 'No tenant for current user';
  end if;

  if p_branch_id is null then
    raise exception 'branch_id required';
  end if;

  if not public.has_branch_access(p_branch_id) then
    raise exception 'Branch access denied';
  end if;

  select branch_id into wh_branch
  from public.inventory_warehouses
  where id = p_warehouse_id and tenant_id = t_id;

  if wh_branch is null or (wh_branch <> p_branch_id) then
    raise exception 'Warehouse not found in branch';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'lines must be array';
  end if;

  order_no := 'POS-' || to_char(timezone('Asia/Ho_Chi_Minh', now()), 'YYYYMMDD') || '-' || upper(substr(md5(random()::text), 1, 6));

  insert into public.pos_orders (
    tenant_id, branch_id, shift_id, order_number, status,
    subtotal, discount, tax, total,
    customer_id,
    created_by
  )
  values (
    t_id, p_branch_id, p_shift_id, order_no, 'paid',
    0, 0, 0, 0,
    p_customer_id,
    auth.uid()
  )
  returning id into order_id;

  for line in select * from jsonb_array_elements(p_lines) loop
    prod_id := (line->>'product_id')::uuid;
    qty := (line->>'quantity')::numeric;
    unit_price := (line->>'unit_price')::numeric;
    if qty is null or qty <= 0 then
      raise exception 'Invalid quantity';
    end if;
    if unit_price is null or unit_price < 0 then
      raise exception 'Invalid unit_price';
    end if;

    select p.sku, p.name into sku, name
    from public.inventory_products p
    where p.id = prod_id and p.tenant_id = t_id;

    if sku is null then
      raise exception 'Product not found';
    end if;

    insert into public.pos_order_items (
      tenant_id, order_id, product_id, sku, name, quantity, unit_price
    )
    values (
      t_id, order_id, prod_id, sku, name, qty, unit_price
    );

    total := total + (qty * unit_price);

    perform public.inventory_apply_stock_movement(
      prod_id,
      p_warehouse_id,
      'sale',
      -qty,
      'pos_order',
      order_id,
      order_no
    );
  end loop;

  update public.pos_orders
  set subtotal = total, total = total, updated_at = now()
  where id = order_id;

  insert into public.pos_payments (tenant_id, order_id, method, amount)
  values (t_id, order_id, p_payment_method, p_payment_amount);

  return order_id;
end;
$$;

grant execute on function public.pos_create_sale(uuid, uuid, uuid, jsonb, text, numeric, uuid) to authenticated;

-- 6) Create invoice from sales order (unpaid)
create or replace function public.pos_create_invoice_from_order(
  p_order_id uuid,
  p_shift_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  t_id uuid;
  order_row record;
  order_no text;
  invoice_id uuid;
  line record;
  total numeric := 0;
  sku text;
  name text;
begin
  if not public.has_permission('pos.order.create') then
    raise exception 'Permission denied';
  end if;

  t_id := public.current_tenant_id();
  if t_id is null then
    raise exception 'No tenant for current user';
  end if;

  select * into order_row
  from public.sales_orders
  where id = p_order_id and tenant_id = t_id
  limit 1;

  if order_row.id is null then
    raise exception 'Order not found';
  end if;

  if order_row.status <> 'waiting_pick' then
    raise exception 'Order not ready for invoicing';
  end if;

  if order_row.branch_id is null or order_row.warehouse_id is null then
    raise exception 'Order missing branch/warehouse';
  end if;

  if not public.has_branch_access(order_row.branch_id) then
    raise exception 'Branch access denied';
  end if;

  order_no := 'INV-' || to_char(timezone('Asia/Ho_Chi_Minh', now()), 'YYYYMMDD') || '-' || upper(substr(md5(random()::text), 1, 6));

  insert into public.pos_orders (
    tenant_id, branch_id, shift_id, order_number, status,
    subtotal, discount, tax, total,
    customer_id,
    due_date,
    sales_order_id,
    created_by
  )
  values (
    t_id, order_row.branch_id, p_shift_id, order_no, 'unpaid',
    0, 0, 0, 0,
    order_row.customer_id,
    order_row.due_date,
    order_row.id,
    auth.uid()
  )
  returning id into invoice_id;

  for line in
    select * from public.sales_order_items where order_id = order_row.id and tenant_id = t_id
  loop
    select p.sku, p.name into sku, name
    from public.inventory_products p
    where p.id = line.product_id and p.tenant_id = t_id;

    insert into public.pos_order_items (
      tenant_id, order_id, product_id, sku, name, quantity, unit_price
    )
    values (
      t_id, invoice_id, line.product_id, sku, name, line.quantity, line.unit_price
    );

    total := total + (line.quantity * line.unit_price);

    perform public.inventory_apply_stock_movement(
      line.product_id,
      order_row.warehouse_id,
      'sale',
      -line.quantity,
      'pos_order',
      invoice_id,
      order_no
    );
  end loop;

  update public.pos_orders
  set subtotal = total, total = total, updated_at = now()
  where id = invoice_id;

  update public.sales_orders
  set status = 'completed', payment_status = 'unpaid', updated_at = now()
  where id = order_row.id;

  return invoice_id;
end;
$$;

grant execute on function public.pos_create_invoice_from_order(uuid, uuid) to authenticated;
