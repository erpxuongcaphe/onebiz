-- Disposable test of the actual 00150/00158/00283/00284/00392 production
-- function chain. Commercial receipt, global WAC and lot reconciliation are
-- bounded stubs; no application database or live business rows are involved.
\set ON_ERROR_STOP on

create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
create table public.profiles (
  id uuid primary key, tenant_id uuid not null, role text not null,
  is_active boolean not null default true, created_at timestamptz default now()
);
create function public.user_has_permission(uuid, text) returns boolean
language sql stable as $$ select true $$;
create function public.user_has_branch_access(uuid, uuid) returns boolean
language sql stable as $$
  select $2 = '20000000-0000-0000-0000-000000000002'::uuid;
$$;
create table public.products (
  id uuid primary key, tenant_id uuid not null, is_fnb_stock_item boolean not null,
  stock numeric not null default 0, cost_price numeric not null default 0,
  shelf_life_days integer, shelf_life_unit text
);
create table public.production_orders (
  id uuid primary key, tenant_id uuid not null, branch_id uuid not null,
  product_id uuid not null, variant_id uuid, code text not null,
  created_by uuid, status text not null, planned_qty numeric not null,
  cogs_amount numeric not null default 0, completed_qty numeric,
  lot_number text, actual_end timestamptz, updated_at timestamptz
);
create table public.production_order_materials (
  id uuid primary key, production_order_id uuid not null,
  product_id uuid not null, planned_qty numeric not null,
  actual_qty numeric, unit text not null, unit_cost numeric
);
create table public.branch_stock (
  tenant_id uuid not null, branch_id uuid not null, product_id uuid not null,
  variant_id uuid, quantity numeric not null, updated_at timestamptz
);
create unique index branch_stock_base_test on public.branch_stock
  (tenant_id, branch_id, product_id) where variant_id is null;
create table public.stock_movements (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
  branch_id uuid not null, product_id uuid not null, type text not null,
  reference_type text not null, reference_id uuid not null,
  quantity numeric not null, note text, created_by uuid
);
create table public.product_lots (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
  product_id uuid not null, variant_id uuid, lot_number text not null,
  source_type text not null, production_order_id uuid,
  manufactured_date date, expiry_date date, received_date date,
  initial_qty numeric not null, current_qty numeric not null,
  branch_id uuid not null, status text not null
);
create table public.audit_log (
  tenant_id uuid, user_id uuid, action text, entity_type text,
  entity_id uuid, old_data jsonb, new_data jsonb
);
create table public.lot_reconciliations (product_id uuid, branch_id uuid);
create function public._reconcile_product_lots_to_branch_00284(
  uuid, uuid, uuid, text, uuid, uuid, text
) returns jsonb language plpgsql as $$
begin
  insert into public.lot_reconciliations(product_id, branch_id) values ($3, $2);
  return '{}'::jsonb;
end;
$$;
create function public.apply_weighted_avg_cost(
  uuid, numeric, numeric, text, text, uuid
) returns jsonb language sql as $$ select '{}'::jsonb $$;

\ir 00414_fnb_supply_to_bom_cost.setup.sql
\ir /tmp/fnb-supply-cost-flow.sql
\ir /tmp/fnb-prepared-cost-trigger.sql
create trigger capture_fnb_branch_cost_stock_movement_00390
  after insert on public.stock_movements for each row
  execute function public._capture_fnb_branch_cost_stock_movement_00390();
\ir /tmp/fnb-real-production-chain.sql
\ir ../migrations/00392_fnb_prepared_batch_completion_cost.sql

insert into public.profiles(id, tenant_id, role) values (
  '40000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001', 'owner'
);
insert into public.products(id, tenant_id, is_fnb_stock_item, stock, cost_price) values
  ('30000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001', false, 4, 11000),
  ('30000000-0000-0000-0000-000000000002',
   '10000000-0000-0000-0000-000000000001', true, 0, 0);
insert into public.fnb_supply_branch_scopes values (
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000002', true
);
select public.create_internal_sale_atomic(
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000002',
  '40000000-0000-0000-0000-000000000001',
  null, 'XTB', null, 'Retail',
  jsonb_build_array(jsonb_build_object(
    'productId', '30000000-0000-0000-0000-000000000001',
    'quantity', 3, 'unitPrice', 11000
  )), 'debt', false, 'isolated batch test'
);
insert into public.production_orders (
  id, tenant_id, branch_id, product_id, code, created_by, status, planned_qty
) values (
  '70000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000002',
  '30000000-0000-0000-0000-000000000002',
  'SX-ISOLATED', '40000000-0000-0000-0000-000000000001', 'planned', 10
);
insert into public.production_order_materials values (
  '71000000-0000-0000-0000-000000000001',
  '70000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001', 1, null, 'Tui', 11000
);
select public.create_internal_sale_atomic(
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000002',
  '40000000-0000-0000-0000-000000000001',
  null, 'XTB', null, 'Retail',
  jsonb_build_array(jsonb_build_object(
    'productId', '30000000-0000-0000-0000-000000000001',
    'quantity', 1, 'unitPrice', 17000
  )), 'debt', false, 'isolated batch test'
);
-- Commercial-source stub posts branch cost only, so seed its physical receipt.
insert into public.branch_stock(tenant_id, branch_id, product_id, quantity)
values ('10000000-0000-0000-0000-000000000001',
        '20000000-0000-0000-0000-000000000002',
        '30000000-0000-0000-0000-000000000001', 4);
select set_config('request.jwt.claim.sub',
  '40000000-0000-0000-0000-000000000001', false);
select public.complete_production_atomic(
  '70000000-0000-0000-0000-000000000001', 10,
  'LOT-ISOLATED-BTP', current_date, null
);

do $$
begin
  if (select status from public.production_orders where code = 'SX-ISOLATED') <> 'completed'
     or (select cogs_amount from public.production_orders where code = 'SX-ISOLATED') <> 12500
     or (select unit_cost from public.production_order_materials
           where production_order_id = '70000000-0000-0000-0000-000000000001') <> 12500
     or (select quantity from public.branch_stock
           where product_id = '30000000-0000-0000-0000-000000000001') <> 3
     or (select quantity from public.branch_stock
           where product_id = '30000000-0000-0000-0000-000000000002') <> 10
     or (select current_qty from public.product_lots
           where lot_number = 'LOT-ISOLATED-BTP') <> 10
     or (select unit_cost from public.fnb_branch_product_cost_balances
           where product_id = '30000000-0000-0000-0000-000000000002') <> 1250
     or (select count(*) from public.stock_movements
           where reference_id = '70000000-0000-0000-0000-000000000001') <> 2
     or (select count(*) from public.lot_reconciliations) <> 1 then
    raise exception 'Real production chain failed to consume, receive, cost or reconcile';
  end if;
end;
$$;
select '00417 real production function chain passed' as result;
