-- Disposable test of the actual 00150/00158/00283/00284/00392 production
-- function chain. Commercial receipt, global WAC and lot reconciliation are
-- bounded stubs; no application database or live business rows are involved.
\set ON_ERROR_STOP on

create extension if not exists "uuid-ossp";
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

-- Consume prepared stock in a drink, then void it using the same invoice id.
update public.branch_stock set quantity = quantity - 2
 where branch_id = '20000000-0000-0000-0000-000000000002'
   and product_id = '30000000-0000-0000-0000-000000000002';
insert into public.stock_movements
  (tenant_id, branch_id, product_id, type, reference_type, reference_id, quantity)
values ('10000000-0000-0000-0000-000000000001',
        '20000000-0000-0000-0000-000000000002',
        '30000000-0000-0000-0000-000000000002',
        'out', 'bom_consume', '72000000-0000-0000-0000-000000000001', 2);
do $$
begin
  if (select total_cost from public.fnb_branch_product_cost_events
       where source_type = 'bom_consume'
         and source_reference_id = '72000000-0000-0000-0000-000000000001') <> 2500
     or (select quantity from public.branch_stock
       where product_id = '30000000-0000-0000-0000-000000000002') <> 8
     or (select total_cost from public.fnb_branch_product_cost_balances
       where product_id = '30000000-0000-0000-0000-000000000002') <> 10000 then
    raise exception 'Drink did not consume 2 prepared units at completed-batch cost';
  end if;
end;
$$;
update public.branch_stock set quantity = quantity + 2
 where branch_id = '20000000-0000-0000-0000-000000000002'
   and product_id = '30000000-0000-0000-0000-000000000002';
insert into public.stock_movements
  (tenant_id, branch_id, product_id, type, reference_type, reference_id, quantity)
values ('10000000-0000-0000-0000-000000000001',
        '20000000-0000-0000-0000-000000000002',
        '30000000-0000-0000-0000-000000000002',
        'in', 'invoice_void', '72000000-0000-0000-0000-000000000001', 2);
do $$
begin
  if (select quantity from public.branch_stock
       where product_id = '30000000-0000-0000-0000-000000000002') <> 10
     or (select total_cost from public.fnb_branch_product_cost_balances
       where product_id = '30000000-0000-0000-0000-000000000002') <> 12500
     or (select total_cost from public.fnb_branch_product_cost_events
       where source_type = 'invoice_void_restore'
         and source_reference_id = '72000000-0000-0000-0000-000000000001') <> 2500
     or exists (select 1 from public.fnb_branch_product_cost_events
       where branch_id = '20000000-0000-0000-0000-000000000001') then
    raise exception 'Void did not restore prepared stock/cost or touched Retail';
  end if;
end;
$$;
-- Retrying a completed batch must be rejected without another stock/cost issue.
do $$
declare v_message text; v_before jsonb; v_after jsonb;
begin
  select jsonb_build_object(
    'stock', (select jsonb_agg(to_jsonb(s) order by branch_id,product_id) from branch_stock s),
    'cost', (select jsonb_agg(to_jsonb(b) order by branch_id,product_id) from fnb_branch_product_cost_balances b),
    'moves', (select count(*) from stock_movements),
    'events', (select count(*) from fnb_branch_product_cost_events),
    'lots', (select count(*) from product_lots),
    'audit', (select count(*) from audit_log)
  ) into v_before;
  begin
    perform complete_production_atomic('70000000-0000-0000-0000-000000000001',10,'LOT-RETRY',current_date,null);
  exception when others then get stacked diagnostics v_message=message_text;
  end;
  if v_message is distinct from 'PRODUCTION_COMPLETE_STATUS_OR_QTY_INVALID' then
    raise exception 'Unexpected repeat-completion result: %',v_message;
  end if;
  select jsonb_build_object(
    'stock', (select jsonb_agg(to_jsonb(s) order by branch_id,product_id) from branch_stock s),
    'cost', (select jsonb_agg(to_jsonb(b) order by branch_id,product_id) from fnb_branch_product_cost_balances b),
    'moves', (select count(*) from stock_movements),
    'events', (select count(*) from fnb_branch_product_cost_events),
    'lots', (select count(*) from product_lots),
    'audit', (select count(*) from audit_log)
  ) into v_after;
  if v_before is distinct from v_after then raise exception 'Repeat completion changed stock or cost'; end if;
  raise notice 'PASS: repeat completion is finite and leaves stock/cost/lots/audit unchanged';
end $$;

insert into production_orders(id,tenant_id,branch_id,product_id,code,created_by,status,planned_qty)
values ('70000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001',
 '20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002',
 'SX-FAIL-LOT','40000000-0000-0000-0000-000000000001','planned',10);
insert into production_order_materials values ('71000000-0000-0000-0000-000000000002',
 '70000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001',1,null,'Tui',11000);
-- Deliberately fail after the real consume and receipt code has run, inside
-- this disposable database only. No production migration or trigger is changed.
create function test_fail_batch_lot() returns trigger language plpgsql as $$
begin
  if new.production_order_id='70000000-0000-0000-0000-000000000002' then
    if not exists(select 1 from stock_movements where reference_id=new.production_order_id and type='out') then
      raise exception 'TEST_FAILURE_DID_NOT_REACH_CONSUMPTION';
    end if;
    raise exception 'TEST_LOT_INSERT_FAILURE';
  end if;
  return new;
end $$;
create trigger test_fail_batch_lot before insert on product_lots for each row execute function test_fail_batch_lot();
do $$
declare v_message text; v_before jsonb; v_after jsonb;
begin
  select jsonb_build_object(
    'stock', (select jsonb_agg(to_jsonb(s) order by branch_id,product_id) from branch_stock s),
    'products', (select jsonb_agg(to_jsonb(p) order by id) from products p),
    'orders', (select jsonb_agg(to_jsonb(o) order by id) from production_orders o),
    'materials', (select jsonb_agg(to_jsonb(m) order by id) from production_order_materials m),
    'cost', (select jsonb_agg(to_jsonb(b) order by branch_id,product_id) from fnb_branch_product_cost_balances b),
    'events', (select jsonb_agg(to_jsonb(e) order by id) from fnb_branch_product_cost_events e),
    'moves', (select jsonb_agg(to_jsonb(s) order by id) from stock_movements s),
    'lots', (select jsonb_agg(to_jsonb(l) order by id) from product_lots l),
    'audit', (select count(*) from audit_log),
    'reconciliations', (select count(*) from lot_reconciliations)
  ) into v_before;
  begin
    perform complete_production_atomic('70000000-0000-0000-0000-000000000002',10,'LOT-FAIL',current_date,null);
  exception when others then get stacked diagnostics v_message=message_text;
  end;
  if v_message is distinct from 'TEST_LOT_INSERT_FAILURE' then raise exception 'Wrong late-failure path: %',v_message; end if;
  select jsonb_build_object(
    'stock', (select jsonb_agg(to_jsonb(s) order by branch_id,product_id) from branch_stock s),
    'products', (select jsonb_agg(to_jsonb(p) order by id) from products p),
    'orders', (select jsonb_agg(to_jsonb(o) order by id) from production_orders o),
    'materials', (select jsonb_agg(to_jsonb(m) order by id) from production_order_materials m),
    'cost', (select jsonb_agg(to_jsonb(b) order by branch_id,product_id) from fnb_branch_product_cost_balances b),
    'events', (select jsonb_agg(to_jsonb(e) order by id) from fnb_branch_product_cost_events e),
    'moves', (select jsonb_agg(to_jsonb(s) order by id) from stock_movements s),
    'lots', (select jsonb_agg(to_jsonb(l) order by id) from product_lots l),
    'audit', (select count(*) from audit_log),
    'reconciliations', (select count(*) from lot_reconciliations)
  ) into v_after;
  if v_before is distinct from v_after then raise exception 'Late lot failure left a partial production batch'; end if;
  raise notice 'PASS: lot failure after real material consumption rolls back stock, cost, orders, materials, lots and audit';
end $$;
drop trigger test_fail_batch_lot on product_lots;
drop function test_fail_batch_lot();
select '00417 real production function chain and late-failure rollback passed' as result;
