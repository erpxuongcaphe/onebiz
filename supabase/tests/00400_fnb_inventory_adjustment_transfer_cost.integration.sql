-- Continues the disposable 00397-00399 PostgreSQL fixture only.
-- Never run this file against an application database.
\set ON_ERROR_STOP on

select 'create role service_role nologin'
 where not exists (select 1 from pg_roles where rolname = 'service_role') \gexec

create table public.inventory_checks (
  id uuid primary key,
  tenant_id uuid not null,
  branch_id uuid not null
);
create table public.stock_transfers (
  id uuid primary key,
  tenant_id uuid not null,
  from_branch_id uuid not null,
  to_branch_id uuid not null
);
create table public.stock_transfer_items (
  transfer_id uuid not null,
  product_id uuid not null,
  quantity numeric(18,4) not null
);
create table public.supplier_returns (
  id uuid primary key,
  tenant_id uuid not null,
  branch_id uuid not null
);
create table public.disposal_exports (
  id uuid primary key,
  tenant_id uuid not null,
  branch_id uuid not null
);
create table public.internal_exports (
  id uuid primary key,
  tenant_id uuid not null,
  branch_id uuid not null
);

create function public.complete_stock_transfer_atomic(
  p_tenant_id uuid, p_transfer_id uuid, p_created_by uuid
) returns jsonb language plpgsql as $$
declare
  v_transfer public.stock_transfers%rowtype;
  v_item record;
begin
  select * into v_transfer from public.stock_transfers
   where id = p_transfer_id and tenant_id = p_tenant_id;
  if not found then raise exception 'fixture transfer missing'; end if;
  for v_item in select * from public.stock_transfer_items where transfer_id = p_transfer_id loop
    insert into public.stock_movements (
      id, tenant_id, branch_id, product_id, type, reference_type,
      reference_id, quantity, note, created_by
    ) values
      (gen_random_uuid(), p_tenant_id, v_transfer.from_branch_id, v_item.product_id,
       'out', 'stock_transfer', p_transfer_id, v_item.quantity, 'fixture out', p_created_by),
      (gen_random_uuid(), p_tenant_id, v_transfer.to_branch_id, v_item.product_id,
       'in', 'stock_transfer', p_transfer_id, v_item.quantity, 'fixture in', p_created_by);
  end loop;
  return jsonb_build_object('success', true);
end;
$$;

\ir ../migrations/00400_fnb_inventory_adjustment_transfer_cost.sql

insert into public.products values ('90000000-0000-0000-0000-000000000004', false);
insert into public.inventory_checks values
  ('94000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001'),
  ('94000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001'),
  ('94000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002'),
  ('94000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003'),
  ('94000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001');

-- Count gain uses the outlet's existing WAC; count loss uses the same WAC.
insert into public.stock_movements values (
  '94100000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000003',
  'in', 'inventory_check', '94000000-0000-0000-0000-000000000001', 2, null, null
);
insert into public.stock_movements values (
  '94100000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000003',
  'out', 'inventory_check', '94000000-0000-0000-0000-000000000002', 3, null, null
);

do $$
declare
  v_message text;
  v_caught boolean;
begin
  if not exists (select 1 from public.fnb_branch_product_cost_balances
    where branch_id = '20000000-0000-0000-0000-000000000001'
      and product_id = '90000000-0000-0000-0000-000000000003'
      and costed_quantity = 4 and total_cost = 40 and unit_cost = 10) then
    raise exception 'Inventory-check WAC mismatch';
  end if;

  v_caught := false;
  begin
    insert into public.stock_movements values (
      '94100000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000004',
      'in', 'inventory_check', '94000000-0000-0000-0000-000000000005', 1, null, null
    );
  exception when others then
    get stacked diagnostics v_message = message_text;
    v_caught := v_message = 'FNB_MANUAL_STOCK_GAIN_COST_REQUIRED';
  end;
  if not v_caught or exists (select 1 from public.stock_movements where id = '94100000-0000-0000-0000-000000000003') then
    raise exception 'Uncosted inventory gain was not rejected atomically';
  end if;

  v_caught := false;
  begin
    insert into public.stock_movements values (
      '94100000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000003',
      'in', 'inventory_check', '94000000-0000-0000-0000-000000000001', 1, null, null
    );
  exception when others then
    get stacked diagnostics v_message = message_text;
    v_caught := v_message = 'FNB_INVENTORY_COST_SOURCE_REQUIRED';
  end;
  if not v_caught then raise exception 'Wrong-branch inventory check was accepted'; end if;
end;
$$;

-- A branch outside the F&B cost scope keeps the legacy inventory-check path.
insert into public.stock_movements values (
  '94100000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000004',
  'in', 'inventory_check', '94000000-0000-0000-0000-000000000004', 1, null, null
);
do $$
begin
  if exists (select 1 from public.fnb_branch_product_cost_events
    where source_stock_movement_id = '94100000-0000-0000-0000-000000000005') then
    raise exception 'Non-opted-in inventory check changed F&B cost ledger';
  end if;
end;
$$;

-- Existing source branch has WAC 10; destination already carries WAC 6.
insert into public.fnb_branch_product_cost_balances (
  tenant_id, branch_id, product_id, costed_quantity, total_cost, unit_cost
) values (
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000002',
  '90000000-0000-0000-0000-000000000003', 1, 6, 6
);
insert into public.stock_transfers values
  ('95000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002'),
  ('95000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001'),
  ('95000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003'),
  ('95000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002');
insert into public.stock_transfer_items values
  ('95000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000003', 2),
  ('95000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000003', 1),
  ('95000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000003', 1),
  ('95000000-0000-0000-0000-000000000004', '90000000-0000-0000-0000-000000000003', 3);

select public.complete_stock_transfer_atomic(
  '10000000-0000-0000-0000-000000000001',
  '95000000-0000-0000-0000-000000000001', null
);

do $$
declare
  v_message text;
  v_caught boolean;
begin
  if not exists (select 1 from public.fnb_branch_product_cost_balances
    where branch_id = '20000000-0000-0000-0000-000000000001'
      and product_id = '90000000-0000-0000-0000-000000000003'
      and costed_quantity = 2 and total_cost = 20 and unit_cost = 10)
     or not exists (select 1 from public.fnb_branch_product_cost_balances
    where branch_id = '20000000-0000-0000-0000-000000000002'
      and product_id = '90000000-0000-0000-0000-000000000003'
      and costed_quantity = 3 and total_cost = 26 and unit_cost = 8.666667) then
    raise exception 'Inter-branch WAC transfer mismatch';
  end if;

  v_caught := false;
  begin
    perform public.complete_stock_transfer_atomic(
      '10000000-0000-0000-0000-000000000001',
      '95000000-0000-0000-0000-000000000002', null
    );
  exception when others then
    get stacked diagnostics v_message = message_text;
    v_caught := v_message = 'FNB_TRANSFER_SOURCE_COST_REQUIRED';
  end;
  if not v_caught or exists (select 1 from public.stock_movements
    where reference_id = '95000000-0000-0000-0000-000000000002') then
    raise exception 'Uncosted source transfer was not rejected atomically';
  end if;

  perform public.complete_stock_transfer_atomic(
    '10000000-0000-0000-0000-000000000001',
    '95000000-0000-0000-0000-000000000003', null
  );
  if not exists (select 1 from public.fnb_branch_product_cost_balances
    where branch_id = '20000000-0000-0000-0000-000000000001'
      and product_id = '90000000-0000-0000-0000-000000000003'
      and costed_quantity = 1 and total_cost = 10) then
    raise exception 'Transfer out of tracked branch mismatch';
  end if;

  v_caught := false;
  begin
    perform public.complete_stock_transfer_atomic(
      '10000000-0000-0000-0000-000000000001',
      '95000000-0000-0000-0000-000000000004', null
    );
  exception when others then
    get stacked diagnostics v_message = message_text;
    v_caught := v_message = 'FNB_BRANCH_COST_REQUIRED';
  end;
  if not v_caught or exists (select 1 from public.stock_movements
    where reference_id = '95000000-0000-0000-0000-000000000004') then
    raise exception 'Transfer exceeding costed source was not rejected atomically';
  end if;
end;
$$;

-- Manual adjustments, supplier returns, exports, and their reversals share
-- the branch WAC ledger without consulting the Retail product cost field.
insert into public.stock_movements values
  ('96000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000003',
   'in', 'stock_adjustment', '96000000-0000-0000-0000-000000000101', 2, 'count gain', null),
  ('96000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000003',
   'out', 'stock_adjustment', '96000000-0000-0000-0000-000000000102', 1, 'count loss', null);

insert into public.disposal_exports values
  ('96100000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001');
insert into public.stock_movements values
  ('96100000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000003',
   'out', 'disposal_export', '96100000-0000-0000-0000-000000000001', 1, 'disposed', null),
  ('96100000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000003',
   'in', 'disposal_export_void', '96100000-0000-0000-0000-000000000001', 1, 'cancel disposal', null);

insert into public.internal_exports values
  ('96200000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001');
insert into public.stock_movements values
  ('96200000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000003',
   'out', 'internal_export', '96200000-0000-0000-0000-000000000001', 1, 'internal use', null),
  ('96200000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000003',
   'in', 'internal_export_void', '96200000-0000-0000-0000-000000000001', 1, 'cancel internal use', null);

insert into public.supplier_returns values
  ('96300000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001');
insert into public.stock_movements values
  ('96300000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000003',
   'out', 'supplier_return', '96300000-0000-0000-0000-000000000001', 1, 'return to supplier', null),
  ('96300000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000003',
   'in', 'initial_stock_reset', '96300000-0000-0000-0000-000000000002', 1, 'opening adjustment', null);

do $$
declare
  v_message text;
  v_caught boolean;
begin
  if not exists (select 1 from public.fnb_branch_product_cost_balances
    where branch_id = '20000000-0000-0000-0000-000000000001'
      and product_id = '90000000-0000-0000-0000-000000000003'
      and costed_quantity = 2 and total_cost = 20 and unit_cost = 10) then
    raise exception 'Manual/export/supplier-return WAC mismatch';
  end if;

  v_caught := false;
  begin
    insert into public.stock_movements values (
      '96400000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000003',
      'in', 'disposal_export_void', '96100000-0000-0000-0000-000000000001', 1, 'duplicate restore', null
    );
  exception when others then
    get stacked diagnostics v_message = message_text;
    v_caught := v_message = 'FNB_STOCK_EXPORT_RESTORE_SOURCE_REQUIRED';
  end;
  if not v_caught or exists (select 1 from public.stock_movements where id = '96400000-0000-0000-0000-000000000001') then
    raise exception 'Over-restored export cost was not rejected atomically';
  end if;

  v_caught := false;
  begin
    insert into public.stock_movements values (
      '96400000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000004',
      'in', 'stock_adjustment', '96400000-0000-0000-0000-000000000003', 1, 'unknown gain', null
    );
  exception when others then
    get stacked diagnostics v_message = message_text;
    v_caught := v_message = 'FNB_MANUAL_STOCK_GAIN_COST_REQUIRED';
  end;
  if not v_caught then raise exception 'Manual gain without cost basis was accepted'; end if;
end;
$$;

select '00400 inventory adjustment and transfer cost assertions passed' as result;
