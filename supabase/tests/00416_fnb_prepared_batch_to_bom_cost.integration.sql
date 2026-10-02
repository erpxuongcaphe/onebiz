-- Disposable extension of the 00414 supply fixture. The original production
-- completion implementation is stubbed at its stock-movement boundary; the
-- 00392 guard and 00390 cost helpers/trigger are production code under test.
\set ON_ERROR_STOP on

create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
create table public.profiles (
  id uuid primary key, tenant_id uuid not null, role text not null,
  is_active boolean not null default true
);
create function public.user_has_permission(uuid, text) returns boolean
language sql stable as $$ select true $$;
create function public.user_has_branch_access(uuid, uuid) returns boolean
language sql stable as $$
  select $2 = '20000000-0000-0000-0000-000000000002'::uuid;
$$;

create table public.products (
  id uuid primary key, tenant_id uuid not null, is_fnb_stock_item boolean not null
);
create table public.production_orders (
  id uuid primary key, tenant_id uuid not null, branch_id uuid not null,
  product_id uuid not null, status text not null, planned_qty numeric not null,
  cogs_amount numeric not null default 0
);
create table public.production_order_materials (
  id uuid primary key, production_order_id uuid not null,
  product_id uuid not null, planned_qty numeric not null,
  actual_qty numeric, unit_cost numeric
);
create table public.branch_stock (
  tenant_id uuid not null, branch_id uuid not null, product_id uuid not null,
  variant_id uuid, quantity numeric not null,
  primary key (tenant_id, branch_id, product_id)
);
create table public.stock_movements (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
  branch_id uuid not null, product_id uuid not null, type text not null,
  reference_type text not null, reference_id uuid not null,
  quantity numeric not null, note text, created_by uuid
);
\ir /tmp/fnb-prepared-cost-trigger.sql
create trigger capture_fnb_branch_cost_stock_movement_00390
  after insert on public.stock_movements for each row
  execute function public._capture_fnb_branch_cost_stock_movement_00390();

-- The real implementation creates lots and moves physical stock. This stub
-- models only its movement/cogs boundary so this fixture does not claim to
-- test the full production-order, lot, POS or UI workflow.
create function public.complete_production_atomic(
  p_production_order_id uuid, p_completed_qty numeric,
  p_lot_number text default null, p_manufactured_date date default current_date,
  p_expiry_date date default null
) returns uuid language plpgsql as $$
declare
  v_order public.production_orders%rowtype;
  v_material record;
  v_cogs numeric := 0;
begin
  select * into strict v_order from public.production_orders
   where id = p_production_order_id for update;
  for v_material in select * from public.production_order_materials
     where production_order_id = p_production_order_id loop
    if v_material.unit_cost is null then
      raise exception 'Completion did not snapshot ingredient cost';
    end if;
    update public.branch_stock set quantity = quantity - v_material.planned_qty
     where branch_id = v_order.branch_id and product_id = v_material.product_id;
    insert into public.stock_movements
      (tenant_id, branch_id, product_id, type, reference_type, reference_id,
       quantity)
    values (v_order.tenant_id, v_order.branch_id, v_material.product_id,
      'out', 'production_order', v_order.id, v_material.planned_qty);
    v_cogs := v_cogs + v_material.planned_qty * v_material.unit_cost;
  end loop;
  update public.production_orders set cogs_amount = v_cogs, status = 'completed'
   where id = v_order.id;
  insert into public.stock_movements
    (tenant_id, branch_id, product_id, type, reference_type, reference_id,
     quantity)
  values (v_order.tenant_id, v_order.branch_id, v_order.product_id,
    'in', 'production_order', v_order.id, p_completed_qty);
  insert into public.branch_stock
    (tenant_id, branch_id, product_id, quantity)
  values (v_order.tenant_id, v_order.branch_id, v_order.product_id, p_completed_qty)
  on conflict (tenant_id, branch_id, product_id)
    do update set quantity = public.branch_stock.quantity + excluded.quantity;
  return gen_random_uuid();
end;
$$;
\ir ../migrations/00392_fnb_prepared_batch_completion_cost.sql

insert into public.profiles values (
  '40000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001', 'owner', true
);
insert into public.products values
  ('30000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001', false),
  ('30000000-0000-0000-0000-000000000002',
   '10000000-0000-0000-0000-000000000001', true);
insert into public.branch_stock (tenant_id, branch_id, product_id, quantity)
values ('10000000-0000-0000-0000-000000000001',
        '20000000-0000-0000-0000-000000000002',
        '30000000-0000-0000-0000-000000000001', 3);
insert into public.production_orders values (
  '70000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000002',
  '30000000-0000-0000-0000-000000000002', 'planned', 10, 0
);
insert into public.production_order_materials values (
  '71000000-0000-0000-0000-000000000001',
  '70000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001', 1, null, null
);

-- The order was planned at 11,000 per ingredient in 00414. A later receipt
-- at 17,000 raises the branch average to 12,500 before batch completion.
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
-- The fixture's source-sale stub records cost, not physical receipt.
update public.branch_stock set quantity = 4
 where product_id = '30000000-0000-0000-0000-000000000001';
select set_config('request.jwt.claim.sub',
  '40000000-0000-0000-0000-000000000001', false);
select public.complete_production_atomic(
  '70000000-0000-0000-0000-000000000001', 10,
  'UAT-BTP-COST', current_date, null
);

do $$
begin
  if (select unit_cost from public.production_order_materials
       where id = '71000000-0000-0000-0000-000000000001') <> 12500
     or (select cogs_amount from public.production_orders
       where id = '70000000-0000-0000-0000-000000000001') <> 12500
     or (select total_cost from public.fnb_branch_product_cost_balances
       where product_id = '30000000-0000-0000-0000-000000000002') <> 12500
     or (select unit_cost from public.fnb_branch_product_cost_balances
       where product_id = '30000000-0000-0000-0000-000000000002') <> 1250
     or (select count(*) from public.fnb_branch_product_cost_events
       where source_reference_id = '70000000-0000-0000-0000-000000000001'
         and source_type in ('production_consume', 'production_complete')) <> 2 then
    raise exception 'Prepared batch did not use completion-time branch cost';
  end if;
end;
$$;

-- A drink consumes 2 units of this batch, then void restores the snapshot.
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
     or (select total_cost from public.fnb_branch_product_cost_balances
       where product_id = '30000000-0000-0000-0000-000000000002') <> 10000 then
    raise exception 'Drink BOM did not consume prepared-batch cost';
  end if;
end;
$$;
insert into public.stock_movements
  (tenant_id, branch_id, product_id, type, reference_type, reference_id, quantity)
values ('10000000-0000-0000-0000-000000000001',
        '20000000-0000-0000-0000-000000000002',
        '30000000-0000-0000-0000-000000000002',
        'in', 'invoice_void', '72000000-0000-0000-0000-000000000001', 2);
do $$
begin
  if (select total_cost from public.fnb_branch_product_cost_balances
       where product_id = '30000000-0000-0000-0000-000000000002') <> 12500 then
    raise exception 'Void did not restore prepared-batch cost';
  end if;
end;
$$;
select '00416 isolated prepared-batch to drink BOM cost passed' as result;
