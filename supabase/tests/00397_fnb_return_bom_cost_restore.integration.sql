-- Disposable PostgreSQL integration fixture for migration 00397.
-- Run only against a fresh test database, never against an application database.
\set ON_ERROR_STOP on

select 'create role anon nologin'
 where not exists (select 1 from pg_roles where rolname = 'anon') \gexec
select 'create role authenticated nologin'
 where not exists (select 1 from pg_roles where rolname = 'authenticated') \gexec

create table public.fnb_supply_branch_scopes (
  tenant_id uuid not null,
  branch_id uuid not null,
  enforcement_enabled boolean not null default false,
  primary key (tenant_id, branch_id)
);

create table public.fnb_branch_product_cost_balances (
  tenant_id uuid not null,
  branch_id uuid not null,
  product_id uuid not null,
  costed_quantity numeric(18,4) not null default 0,
  total_cost numeric(18,4) not null default 0,
  unit_cost numeric(18,6) not null default 0,
  updated_by uuid,
  primary key (tenant_id, branch_id, product_id)
);

create table public.fnb_branch_product_cost_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  product_id uuid not null,
  direction text not null check (direction in ('in', 'out')),
  source_type text not null check (source_type in (
    'opening', 'purchase_receipt', 'internal_sale_receipt',
    'production_consume', 'production_complete', 'bom_consume',
    'invoice_void_restore'
  )),
  source_reference_type text not null,
  source_reference_id uuid not null,
  source_stock_movement_id uuid,
  quantity numeric(18,4) not null check (quantity > 0),
  unit_cost numeric(18,6) not null check (unit_cost >= 0),
  total_cost numeric(18,4) not null check (total_cost >= 0),
  note text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create unique index fnb_branch_product_cost_events_movement_uniq
  on public.fnb_branch_product_cost_events(source_stock_movement_id)
  where source_stock_movement_id is not null;

create table public.stock_movements (
  id uuid primary key,
  tenant_id uuid not null,
  branch_id uuid not null,
  product_id uuid not null,
  type text not null,
  reference_type text not null,
  reference_id uuid not null,
  quantity numeric(18,4) not null,
  note text,
  created_by uuid
);

create table public.invoices (
  id uuid primary key,
  tenant_id uuid not null,
  branch_id uuid not null,
  status text not null
);

create table public.sales_returns (
  id uuid primary key,
  tenant_id uuid not null,
  branch_id uuid not null,
  invoice_id uuid not null,
  status text not null
);

create function public._fnb_branch_cost_tracking_enabled_00390(uuid, uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from public.fnb_supply_branch_scopes s
     where s.tenant_id = $1 and s.branch_id = $2 and s.enforcement_enabled
  );
$$;

-- Mirrors the production helper's ledger math/idempotency boundary so the real
-- 00397 trigger can be exercised without bootstrapping the entire application schema.
create function public._post_fnb_branch_cost_in_00390(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_product_id uuid,
  p_quantity numeric,
  p_unit_cost numeric,
  p_source_type text,
  p_source_reference_type text,
  p_source_reference_id uuid,
  p_source_stock_movement_id uuid default null,
  p_note text default null,
  p_actor uuid default null
) returns void language plpgsql as $$
declare
  v_balance public.fnb_branch_product_cost_balances%rowtype;
  v_total numeric(18,4);
  v_quantity numeric(18,4);
begin
  if p_source_stock_movement_id is not null and exists (
    select 1 from public.fnb_branch_product_cost_events e
     where e.source_stock_movement_id = p_source_stock_movement_id
  ) then
    return;
  end if;
  insert into public.fnb_branch_product_cost_balances(tenant_id, branch_id, product_id)
  values (p_tenant_id, p_branch_id, p_product_id)
  on conflict do nothing;
  select * into v_balance from public.fnb_branch_product_cost_balances
   where tenant_id = p_tenant_id and branch_id = p_branch_id and product_id = p_product_id
   for update;
  v_quantity := v_balance.costed_quantity + p_quantity;
  v_total := round(v_balance.total_cost + p_quantity * p_unit_cost, 4);
  update public.fnb_branch_product_cost_balances
     set costed_quantity = v_quantity,
         total_cost = v_total,
         unit_cost = round(v_total / v_quantity, 6),
         updated_by = p_actor
   where tenant_id = p_tenant_id and branch_id = p_branch_id and product_id = p_product_id;
  insert into public.fnb_branch_product_cost_events(
    tenant_id, branch_id, product_id, direction, source_type,
    source_reference_type, source_reference_id, source_stock_movement_id,
    quantity, unit_cost, total_cost, note, created_by
  ) values (
    p_tenant_id, p_branch_id, p_product_id, 'in', p_source_type,
    p_source_reference_type, p_source_reference_id, p_source_stock_movement_id,
    p_quantity, p_unit_cost, round(p_quantity * p_unit_cost, 4), p_note, p_actor
  ) on conflict (source_stock_movement_id) where source_stock_movement_id is not null do nothing;
end;
$$;

\ir ../migrations/00397_fnb_return_bom_cost_restore.sql

insert into public.fnb_supply_branch_scopes values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', true),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', false);

insert into public.invoices values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'completed'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'completed'),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'completed'),
  ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'completed');

insert into public.sales_returns values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'completed'),
  ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'completed'),
  ('40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'completed'),
  ('40000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 'completed'),
  ('40000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000003', 'completed'),
  ('40000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000004', 'completed'),
  ('40000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000003', 'completed'),
  ('40000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', 'completed');

insert into public.fnb_branch_product_cost_events(
  tenant_id, branch_id, product_id, direction, source_type,
  source_reference_type, source_reference_id, quantity, unit_cost, total_cost
) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'out', 'bom_consume', 'bom_consume', '30000000-0000-0000-0000-000000000001', 2, 10, 20),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'out', 'bom_consume', 'bom_consume', '30000000-0000-0000-0000-000000000001', 1, 16, 16),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000002', 'out', 'bom_consume', 'bom_consume', '30000000-0000-0000-0000-000000000003', 1, 8, 8);

-- Historical uncosted return movement in the temporarily opted-out branch.
insert into public.stock_movements values
  ('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000002', 'in', 'return_bom_restore', '40000000-0000-0000-0000-000000000007', 0.25, null, null);
update public.fnb_supply_branch_scopes set enforcement_enabled = true
 where branch_id = '20000000-0000-0000-0000-000000000002';

-- restore_bom_for_return inserts one stock movement per ingredient row.
insert into public.stock_movements values
  ('60000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'in', 'return_bom_restore', '40000000-0000-0000-0000-000000000001', 1, null, null);
insert into public.stock_movements values
  ('60000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'in', 'return_bom_restore', '40000000-0000-0000-0000-000000000002', 2, null, null);

do $$
declare
  v_unit_cost numeric;
  v_quantity numeric;
  v_message text;
  v_caught boolean;
begin
  select e.unit_cost into v_unit_cost
    from public.fnb_branch_product_cost_events e
   where e.source_stock_movement_id = '60000000-0000-0000-0000-000000000002';
  if v_unit_cost <> 12 then raise exception 'weighted source cost mismatch: %', v_unit_cost; end if;

  perform public._post_fnb_branch_cost_in_00390(
    '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000001', 1, 12, 'return_bom_restore',
    'return_bom_restore', '40000000-0000-0000-0000-000000000001',
    '60000000-0000-0000-0000-000000000002', 'retry', null
  );
  if (select count(*) from public.fnb_branch_product_cost_events
       where source_stock_movement_id in (
         '60000000-0000-0000-0000-000000000002',
         '60000000-0000-0000-0000-000000000003'
       )) <> 2 then
    raise exception 'idempotent retry duplicated return cost events';
  end if;

  select b.costed_quantity into v_quantity
    from public.fnb_branch_product_cost_balances b
   where b.branch_id = '20000000-0000-0000-0000-000000000001'
     and b.product_id = '50000000-0000-0000-0000-000000000001';
  if v_quantity <> 3 then raise exception 'returned balance mismatch: %', v_quantity; end if;

  v_caught := false;
  begin
    insert into public.stock_movements values
      ('60000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'in', 'return_bom_restore', '40000000-0000-0000-0000-000000000003', 0.1, null, null);
  exception when others then
    get stacked diagnostics v_message = message_text;
    v_caught := v_message = 'FNB_RETURN_COST_QUANTITY_EXCEEDED';
  end;
  if not v_caught then raise exception 'expected quantity guard, got: %', coalesce(v_message, 'no error'); end if;
  if exists (select 1 from public.stock_movements where id = '60000000-0000-0000-0000-000000000004') then
    raise exception 'over-return failure did not roll back its stock movement';
  end if;

  v_caught := false;
  begin
    insert into public.stock_movements values
      ('60000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000002', 'in', 'return_bom_restore', '40000000-0000-0000-0000-000000000005', 0.1, null, null);
  exception when others then
    get stacked diagnostics v_message = message_text;
    v_caught := v_message = 'FNB_RETURN_COST_HISTORY_REQUIRED';
  end;
  if not v_caught then raise exception 'expected legacy-history guard, got: %', coalesce(v_message, 'no error'); end if;
  if exists (select 1 from public.stock_movements where id = '60000000-0000-0000-0000-000000000005') then
    raise exception 'legacy-history failure did not roll back its stock movement';
  end if;

  v_caught := false;
  begin
    insert into public.stock_movements values
      ('60000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000099', 'in', 'return_bom_restore', '40000000-0000-0000-0000-000000000006', 1, null, null);
  exception when others then
    get stacked diagnostics v_message = message_text;
    v_caught := v_message = 'FNB_RETURN_COST_SOURCE_REQUIRED';
  end;
  if not v_caught then raise exception 'expected missing-source guard, got: %', coalesce(v_message, 'no error'); end if;
  if exists (select 1 from public.stock_movements where id = '60000000-0000-0000-0000-000000000006') then
    raise exception 'missing-source failure did not roll back its stock movement';
  end if;

  v_caught := false;
  begin
    insert into public.stock_movements values
      ('60000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'in', 'return_bom_restore', '40000000-0000-0000-0000-000000000008', 0.1, null, null);
  exception when others then
    get stacked diagnostics v_message = message_text;
    v_caught := v_message = 'FNB_RETURN_COST_REFERENCE_INVALID';
  end;
  if not v_caught then raise exception 'expected reference guard, got: %', coalesce(v_message, 'no error'); end if;

  insert into public.stock_movements values
    ('60000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000099', 'in', 'sales_return', '40000000-0000-0000-0000-000000000006', 1, null, null);
  if exists (select 1 from public.fnb_branch_product_cost_events where source_stock_movement_id = '60000000-0000-0000-0000-000000000007') then
    raise exception 'normal sales_return unexpectedly changed the F&B cost ledger';
  end if;
end $$;

select '00397 PostgreSQL integration assertions passed' as result;
