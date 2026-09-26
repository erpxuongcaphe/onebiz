-- Extends the disposable 00397 fixture; never run on an application database.
\set ON_ERROR_STOP on
create table public.products (id uuid primary key, is_fnb_stock_item boolean);
create table public.production_orders (
  id uuid primary key, tenant_id uuid, branch_id uuid, product_id uuid, cogs_amount numeric
);
\ir /tmp/fnb-original-cost-trigger.sql
create trigger capture_fnb_branch_cost_stock_movement_00390
  after insert on public.stock_movements for each row
  execute function public._capture_fnb_branch_cost_stock_movement_00390();
\ir ../migrations/00398_fnb_production_cancel_cost_restore.sql

insert into public.products values
  ('90000000-0000-0000-0000-000000000001', true),
  ('90000000-0000-0000-0000-000000000002', false);
insert into public.production_orders values (
  '90000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '90000000-0000-0000-0000-000000000001', 30
);
insert into public.fnb_branch_product_cost_events (
  tenant_id, branch_id, product_id, direction, source_type,
  source_reference_type, source_reference_id, quantity, unit_cost, total_cost
) values (
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '90000000-0000-0000-0000-000000000002', 'out', 'production_consume',
  'production_order', '90000000-0000-0000-0000-000000000003', 4, 7, 28
);

-- Completion is still costed from the completed batch, not ingredient issue cost.
insert into public.stock_movements values (
  '90000000-0000-0000-0000-000000000004',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '90000000-0000-0000-0000-000000000001', 'in', 'production_order',
  '90000000-0000-0000-0000-000000000003', 10, null, null
);
-- Returning half the ingredients restores 14, not the whole batch's cost 30.
insert into public.stock_movements values (
  '90000000-0000-0000-0000-000000000005',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '90000000-0000-0000-0000-000000000002', 'in', 'production_order',
  '90000000-0000-0000-0000-000000000003', 2, null, null
);
insert into public.stock_movements values (
  '90000000-0000-0000-0000-000000000006',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '90000000-0000-0000-0000-000000000002', 'in', 'production_order',
  '90000000-0000-0000-0000-000000000003', 2, null, null
);

do $$
begin
  if not exists (
    select 1 from public.fnb_branch_product_cost_balances
     where product_id = '90000000-0000-0000-0000-000000000002'
       and costed_quantity = 4 and total_cost = 28 and unit_cost = 7
  ) or not exists (
    select 1 from public.fnb_branch_product_cost_balances
     where product_id = '90000000-0000-0000-0000-000000000001'
       and costed_quantity = 10 and total_cost = 30 and unit_cost = 3
  ) then raise exception 'Production return/completion cost mismatch'; end if;
  begin
    insert into public.stock_movements values (
      '90000000-0000-0000-0000-000000000007',
      '10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      '90000000-0000-0000-0000-000000000002', 'in', 'production_order',
      '90000000-0000-0000-0000-000000000003', 1, null, null
    );
    raise exception 'Expected over-return rejection';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'FNB_PRODUCTION_RETURN_QUANTITY_EXCEEDED' then raise; end if;
  end;
  begin
    insert into public.stock_movements values (
      '90000000-0000-0000-0000-000000000008',
      '10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      '90000000-0000-0000-0000-000000000099', 'in', 'production_order',
      '90000000-0000-0000-0000-000000000003', 1, null, null
    );
    raise exception 'Expected missing-history rejection';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'FNB_PRODUCTION_RETURN_HISTORY_REQUIRED' then raise; end if;
  end;
  if exists (select 1 from public.stock_movements where id in (
    '90000000-0000-0000-0000-000000000007',
    '90000000-0000-0000-0000-000000000008'
  )) then raise exception 'Rejected movement was not rolled back'; end if;
end;
$$;

-- Non-opted-in branch bypasses both cost triggers.
insert into public.stock_movements values (
  '90000000-0000-0000-0000-000000000009',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000002',
  '90000000-0000-0000-0000-000000000002', 'in', 'production_order',
  '90000000-0000-0000-0000-000000000003', 100, null, null
);
do $$
begin
  if exists (select 1 from public.fnb_branch_product_cost_events
    where source_stock_movement_id = '90000000-0000-0000-0000-000000000009') then
    raise exception 'Non-opted-in branch was changed';
  end if;
end;
$$;
select '00398 production return/completion assertions passed' as result;
