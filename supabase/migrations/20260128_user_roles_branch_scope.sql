-- OneBiz ERP - Branch-scoped RBAC + RPC guards

-- 1) Extend user_roles with branch scope
alter table public.user_roles
  add column if not exists branch_id uuid,
  add column if not exists scope text not null default 'branch';

alter table public.user_roles
  drop constraint if exists user_roles_user_id_role_id_key;

-- Promote roles that already have all-branch permission
update public.user_roles ur
set scope = 'all', branch_id = null
from public.roles r
where ur.role_id = r.id
  and ur.tenant_id = r.tenant_id
  and (r.permissions ? 'branch.read_all' or r.permissions ? '*');

-- Backfill branch_id from profiles where possible, else default branch
update public.user_roles ur
set branch_id = coalesce(b.id, public.seed_default_branch(ur.tenant_id)),
    scope = 'branch'
from public.profiles p
left join public.branches b
  on b.id = p.branch_id
where ur.user_id = p.id
  and (ur.scope is null or ur.scope <> 'all')
  and ur.branch_id is null;

alter table public.user_roles
  drop constraint if exists user_roles_scope_check;

alter table public.user_roles
  drop constraint if exists user_roles_branch_scope_check;

alter table public.user_roles
  add constraint user_roles_scope_check
    check (scope in ('branch', 'all'));

alter table public.user_roles
  add constraint user_roles_branch_scope_check
    check (
      (scope = 'all' and branch_id is null)
      or (scope = 'branch' and branch_id is not null)
    );

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'user_roles_branch_id_fkey'
  ) then
    alter table public.user_roles
      add constraint user_roles_branch_id_fkey
      foreign key (branch_id) references public.branches (id)
      on delete set null;
  end if;
end $$;

create unique index if not exists idx_user_roles_unique_branch
  on public.user_roles (user_id, role_id, branch_id)
  where scope = 'branch';

create unique index if not exists idx_user_roles_unique_all
  on public.user_roles (user_id, role_id)
  where scope = 'all';

-- 2) Tenant-aware permissions
create or replace function public.get_my_permission_patterns()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct p), array[]::text[])
  from (
    select jsonb_array_elements_text(r.permissions) as p
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = auth.uid()
      and ur.tenant_id = public.current_tenant_id()
  ) s;
$$;

grant execute on function public.get_my_permission_patterns() to authenticated;

-- 3) Branch access helper
create or replace function public.has_branch_access(p_branch_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  t_id uuid;
begin
  if p_branch_id is null then
    return false;
  end if;

  t_id := public.current_tenant_id();
  if t_id is null then
    return false;
  end if;

  return exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.tenant_id = t_id
      and (
        ur.scope = 'all'
        or (ur.scope = 'branch' and ur.branch_id = p_branch_id)
      )
  );
end;
$$;

grant execute on function public.has_branch_access(uuid) to authenticated;

-- 4) Update branch switch to enforce branch access
create or replace function public.branch_is_active(p_branch_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  has_status boolean;
  has_is_active boolean;
  result boolean;
begin
  select exists(
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'branches'
      and column_name = 'status'
  ) into has_status;

  select exists(
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'branches'
      and column_name = 'is_active'
  ) into has_is_active;

  if has_status then
    execute 'select exists(select 1 from public.branches where id = $1 and status = ''active'')'
      into result using p_branch_id;
    return result;
  elsif has_is_active then
    execute 'select exists(select 1 from public.branches where id = $1 and is_active = true)'
      into result using p_branch_id;
    return result;
  end if;

  execute 'select exists(select 1 from public.branches where id = $1)'
    into result using p_branch_id;
  return result;
end;
$$;

grant execute on function public.branch_is_active(uuid) to authenticated;

create or replace function public.set_my_branch(p_branch_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t_id uuid;
begin
  if not public.has_permission('branch.switch') and not public.has_permission('branch.read_all') then
    raise exception 'Permission denied';
  end if;

  t_id := public.current_tenant_id();
  if t_id is null then
    raise exception 'No tenant for current user';
  end if;

  if not public.branch_is_active(p_branch_id) then
    raise exception 'Branch not found or inactive';
  end if;

  if not public.has_branch_access(p_branch_id) then
    raise exception 'Branch access denied';
  end if;

  update public.profiles
  set branch_id = p_branch_id,
      updated_at = now()
  where id = auth.uid() and tenant_id = t_id;
end;
$$;

grant execute on function public.set_my_branch(uuid) to authenticated;

-- 5) Update handle_new_user to set branch scope
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t_id uuid;
  b_id uuid;
  full_name text;
  role_id uuid;
  role_name text;
  has_any_role boolean;
  requested_tenant uuid;
begin
  requested_tenant := null;
  begin
    requested_tenant := (new.raw_user_meta_data->>'tenant_id')::uuid;
  exception when others then
    requested_tenant := null;
  end;

  if requested_tenant is not null then
    select id into t_id from public.tenants where id = requested_tenant limit 1;
  end if;

  if t_id is null then
    select id into t_id from public.tenants where custom_domain = 'onebiz.com.vn' limit 1;
  end if;
  if t_id is null then
    select id into t_id from public.tenants order by created_at asc limit 1;
  end if;

  full_name := coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1));

  b_id := public.seed_default_branch(t_id);
  perform public.seed_default_roles(t_id);

  insert into public.profiles (id, tenant_id, branch_id, email, full_name)
  values (new.id, t_id, b_id, new.email, full_name)
  on conflict (id) do nothing;

  select exists(select 1 from public.user_roles where tenant_id = t_id) into has_any_role;
  if not has_any_role then
    select r.id, r.name into role_id, role_name
    from public.roles r
    where r.tenant_id = t_id and r.name = 'Super Admin'
    limit 1;
  else
    select r.id, r.name into role_id, role_name
    from public.roles r
    where r.tenant_id = t_id and r.name = 'Employee'
    limit 1;
  end if;

  if role_id is not null then
    insert into public.user_roles (tenant_id, user_id, role_id, branch_id, scope)
    values (
      t_id,
      new.id,
      role_id,
      case when role_name = 'Super Admin' then null else b_id end,
      case when role_name = 'Super Admin' then 'all' else 'branch' end
    )
    on conflict do nothing;
  end if;

  return new;
end;
$$;

-- 6) POS and Inventory policies use branch access
drop policy if exists "pos_shifts: read" on public.pos_shifts;
create policy "pos_shifts: read"
on public.pos_shifts
for select
using (
  tenant_id = public.current_tenant_id()
  and public.has_permission('pos.read')
  and public.has_branch_access(branch_id)
);

drop policy if exists "pos_shifts: insert" on public.pos_shifts;
create policy "pos_shifts: insert"
on public.pos_shifts
for insert
with check (
  tenant_id = public.current_tenant_id()
  and public.has_permission('pos.shift.open')
  and public.has_branch_access(branch_id)
);

drop policy if exists "pos_shifts: update" on public.pos_shifts;
create policy "pos_shifts: update"
on public.pos_shifts
for update
using (
  tenant_id = public.current_tenant_id()
  and public.has_permission('pos.shift.update')
  and public.has_branch_access(branch_id)
)
with check (
  tenant_id = public.current_tenant_id()
  and public.has_permission('pos.shift.update')
);

drop policy if exists "pos_orders: read" on public.pos_orders;
create policy "pos_orders: read"
on public.pos_orders
for select
using (
  tenant_id = public.current_tenant_id()
  and public.has_permission('pos.read')
  and public.has_branch_access(branch_id)
);

drop policy if exists "pos_orders: insert" on public.pos_orders;
create policy "pos_orders: insert"
on public.pos_orders
for insert
with check (
  tenant_id = public.current_tenant_id()
  and public.has_permission('pos.order.create')
  and public.has_branch_access(branch_id)
);

drop policy if exists "pos_orders: update" on public.pos_orders;
create policy "pos_orders: update"
on public.pos_orders
for update
using (
  tenant_id = public.current_tenant_id()
  and public.has_permission('pos.order.update')
  and public.has_branch_access(branch_id)
)
with check (
  tenant_id = public.current_tenant_id()
  and public.has_permission('pos.order.update')
);

drop policy if exists "inventory_documents: read" on public.inventory_documents;
create policy "inventory_documents: read"
on public.inventory_documents
for select
using (
  tenant_id = public.current_tenant_id()
  and public.has_permission('inventory.document.read')
  and public.has_branch_access(branch_id)
);

drop policy if exists "inventory_documents: insert" on public.inventory_documents;
create policy "inventory_documents: insert"
on public.inventory_documents
for insert
with check (
  tenant_id = public.current_tenant_id()
  and public.has_permission('inventory.document.create')
  and public.has_branch_access(branch_id)
);

drop policy if exists "inventory_documents: update" on public.inventory_documents;
create policy "inventory_documents: update"
on public.inventory_documents
for update
using (
  tenant_id = public.current_tenant_id()
  and public.has_permission('inventory.document.update')
)
with check (
  tenant_id = public.current_tenant_id()
  and public.has_permission('inventory.document.update')
);

-- Inventory warehouses, stock, movements scoped by branch
drop policy if exists "inventory_warehouses: read" on public.inventory_warehouses;
create policy "inventory_warehouses: read"
on public.inventory_warehouses
for select
using (
  tenant_id = public.current_tenant_id()
  and public.has_permission('inventory.read')
  and (branch_id is null or public.has_branch_access(branch_id))
);

drop policy if exists "inventory_warehouses: insert" on public.inventory_warehouses;
create policy "inventory_warehouses: insert"
on public.inventory_warehouses
for insert
with check (
  tenant_id = public.current_tenant_id()
  and public.has_permission('inventory.warehouse.create')
  and (branch_id is null or public.has_branch_access(branch_id))
);

drop policy if exists "inventory_warehouses: update" on public.inventory_warehouses;
create policy "inventory_warehouses: update"
on public.inventory_warehouses
for update
using (
  tenant_id = public.current_tenant_id()
  and public.has_permission('inventory.warehouse.update')
  and (branch_id is null or public.has_branch_access(branch_id))
)
with check (
  tenant_id = public.current_tenant_id()
  and public.has_permission('inventory.warehouse.update')
  and (branch_id is null or public.has_branch_access(branch_id))
);

drop policy if exists "inventory_warehouses: delete" on public.inventory_warehouses;
create policy "inventory_warehouses: delete"
on public.inventory_warehouses
for delete
using (
  tenant_id = public.current_tenant_id()
  and public.has_permission('inventory.warehouse.delete.hard')
  and (branch_id is null or public.has_branch_access(branch_id))
);

drop policy if exists "inventory_stock: read" on public.inventory_stock;
create policy "inventory_stock: read"
on public.inventory_stock
for select
using (
  tenant_id = public.current_tenant_id()
  and public.has_permission('inventory.read')
  and exists (
    select 1 from public.inventory_warehouses w
    where w.id = inventory_stock.warehouse_id
      and w.tenant_id = public.current_tenant_id()
      and (w.branch_id is null or public.has_branch_access(w.branch_id))
  )
);

drop policy if exists "inventory_stock: insert" on public.inventory_stock;
create policy "inventory_stock: insert"
on public.inventory_stock
for insert
with check (
  tenant_id = public.current_tenant_id()
  and public.has_permission('inventory.stock.adjust')
  and exists (
    select 1 from public.inventory_warehouses w
    where w.id = inventory_stock.warehouse_id
      and w.tenant_id = public.current_tenant_id()
      and (w.branch_id is null or public.has_branch_access(w.branch_id))
  )
);

drop policy if exists "inventory_stock: update" on public.inventory_stock;
create policy "inventory_stock: update"
on public.inventory_stock
for update
using (
  tenant_id = public.current_tenant_id()
  and public.has_permission('inventory.stock.adjust')
  and exists (
    select 1 from public.inventory_warehouses w
    where w.id = inventory_stock.warehouse_id
      and w.tenant_id = public.current_tenant_id()
      and (w.branch_id is null or public.has_branch_access(w.branch_id))
  )
)
with check (
  tenant_id = public.current_tenant_id()
  and public.has_permission('inventory.stock.adjust')
  and exists (
    select 1 from public.inventory_warehouses w
    where w.id = inventory_stock.warehouse_id
      and w.tenant_id = public.current_tenant_id()
      and (w.branch_id is null or public.has_branch_access(w.branch_id))
  )
);

drop policy if exists "inventory_stock_movements: read" on public.inventory_stock_movements;
create policy "inventory_stock_movements: read"
on public.inventory_stock_movements
for select
using (
  tenant_id = public.current_tenant_id()
  and public.has_permission('inventory.movement.read')
  and exists (
    select 1 from public.inventory_warehouses w
    where w.id = inventory_stock_movements.warehouse_id
      and w.tenant_id = public.current_tenant_id()
      and (w.branch_id is null or public.has_branch_access(w.branch_id))
  )
);

drop policy if exists "inventory_stock_movements: insert" on public.inventory_stock_movements;
create policy "inventory_stock_movements: insert"
on public.inventory_stock_movements
for insert
with check (
  tenant_id = public.current_tenant_id()
  and public.has_permission('inventory.stock.adjust')
  and exists (
    select 1 from public.inventory_warehouses w
    where w.id = inventory_stock_movements.warehouse_id
      and w.tenant_id = public.current_tenant_id()
      and (w.branch_id is null or public.has_branch_access(w.branch_id))
  )
);

-- 7) Strengthen RPC branch checks
create or replace function public.inventory_apply_stock_movement(
  p_product_id uuid,
  p_warehouse_id uuid,
  p_movement_type text,
  p_quantity numeric,
  p_reference_type text default null,
  p_reference_id uuid default null,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t_id uuid;
  w_branch uuid;
begin
  if not public.has_permission('inventory.stock.adjust') then
    raise exception 'Permission denied';
  end if;

  t_id := public.current_tenant_id();
  if t_id is null then
    raise exception 'No tenant for current user';
  end if;

  if p_quantity = 0 then
    raise exception 'Quantity must not be zero';
  end if;

  if not exists (
    select 1 from public.inventory_products where id = p_product_id and tenant_id = t_id
  ) then
    raise exception 'Product not found in tenant';
  end if;

  select branch_id into w_branch
  from public.inventory_warehouses
  where id = p_warehouse_id and tenant_id = t_id;

  if w_branch is null then
    raise exception 'Warehouse not found in tenant';
  end if;

  if not public.has_branch_access(w_branch) then
    raise exception 'Branch access denied';
  end if;

  insert into public.inventory_stock (tenant_id, product_id, warehouse_id, quantity)
  values (t_id, p_product_id, p_warehouse_id, p_quantity)
  on conflict (tenant_id, product_id, warehouse_id)
  do update set quantity = public.inventory_stock.quantity + excluded.quantity,
                updated_at = now();

  insert into public.inventory_stock_movements (
    tenant_id,
    product_id,
    warehouse_id,
    movement_type,
    quantity,
    reference_type,
    reference_id,
    notes,
    created_by
  )
  values (
    t_id,
    p_product_id,
    p_warehouse_id,
    p_movement_type,
    p_quantity,
    p_reference_type,
    p_reference_id,
    p_notes,
    auth.uid()
  );
end;
$$;

create or replace function public.inventory_post_document(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t_id uuid;
  doc record;
  line record;
begin
  if not public.has_permission('inventory.document.post') then
    raise exception 'Permission denied';
  end if;

  t_id := public.current_tenant_id();
  if t_id is null then
    raise exception 'No tenant for current user';
  end if;

  select * into doc
  from public.inventory_documents
  where id = p_document_id and tenant_id = t_id
  limit 1;

  if doc.id is null then
    raise exception 'Document not found';
  end if;

  if not public.has_branch_access(doc.branch_id) then
    raise exception 'Branch access denied';
  end if;

  if doc.status <> 'draft' then
    raise exception 'Only draft documents can be posted';
  end if;

  if doc.doc_type = 'receipt' then
    if doc.warehouse_to_id is null then
      raise exception 'warehouse_to_id required';
    end if;
  elsif doc.doc_type = 'issue' then
    if doc.warehouse_from_id is null then
      raise exception 'warehouse_from_id required';
    end if;
  elsif doc.doc_type = 'transfer' then
    if doc.warehouse_from_id is null or doc.warehouse_to_id is null then
      raise exception 'warehouse_from_id and warehouse_to_id required';
    end if;
  end if;

  for line in
    select * from public.inventory_document_lines where document_id = doc.id and tenant_id = t_id
  loop
    if line.quantity <= 0 then
      raise exception 'Line quantity must be > 0';
    end if;

    if doc.doc_type = 'receipt' then
      perform public.inventory_apply_stock_movement(line.product_id, doc.warehouse_to_id, 'purchase', line.quantity, 'inventory_document', doc.id, doc.doc_number);
    elsif doc.doc_type = 'issue' then
      perform public.inventory_apply_stock_movement(line.product_id, doc.warehouse_from_id, 'adjustment', -line.quantity, 'inventory_document', doc.id, doc.doc_number);
    else
      perform public.inventory_apply_stock_movement(line.product_id, doc.warehouse_from_id, 'transfer_out', -line.quantity, 'inventory_document', doc.id, doc.doc_number);
      perform public.inventory_apply_stock_movement(line.product_id, doc.warehouse_to_id, 'transfer_in', line.quantity, 'inventory_document', doc.id, doc.doc_number);
    end if;
  end loop;

  update public.inventory_documents
  set status = 'posted', posted_by = auth.uid(), posted_at = now(), updated_at = now()
  where id = doc.id;
end;
$$;

create or replace function public.pos_create_sale(
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_shift_id uuid,
  p_lines jsonb,
  p_payment_method text,
  p_payment_amount numeric
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
    created_by
  )
  values (
    t_id, p_branch_id, p_shift_id, order_no, 'paid',
    0, 0, 0, 0,
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

grant execute on function public.inventory_apply_stock_movement(uuid, uuid, text, numeric, text, uuid, text) to authenticated;
grant execute on function public.inventory_post_document(uuid) to authenticated;
grant execute on function public.pos_create_sale(uuid, uuid, uuid, jsonb, text, numeric) to authenticated;
