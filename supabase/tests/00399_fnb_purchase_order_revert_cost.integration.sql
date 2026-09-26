-- Continues the disposable database fixture from 00397/00398.
-- Never run this file against an application database.
\set ON_ERROR_STOP on

create table public.purchase_orders (
  id uuid primary key,
  tenant_id uuid not null,
  branch_id uuid not null
);

create function public._post_fnb_branch_cost_out_00390(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_product_id uuid,
  p_quantity numeric,
  p_source_type text,
  p_source_reference_type text,
  p_source_reference_id uuid,
  p_source_stock_movement_id uuid default null,
  p_note text default null,
  p_actor uuid default null
) returns numeric language plpgsql as $$
declare
  v_balance public.fnb_branch_product_cost_balances%rowtype;
  v_total numeric(18,4);
  v_unit numeric(18,6);
  v_remaining_quantity numeric(18,4);
begin
  if p_source_stock_movement_id is not null then
    select e.unit_cost into v_unit
      from public.fnb_branch_product_cost_events e
     where e.source_stock_movement_id = p_source_stock_movement_id;
    if found then return v_unit; end if;
  end if;
  select * into v_balance
    from public.fnb_branch_product_cost_balances
   where tenant_id = p_tenant_id and branch_id = p_branch_id and product_id = p_product_id
   for update;
  if not found or v_balance.costed_quantity + 0.0001 < p_quantity then
    raise exception using errcode = 'P0001', message = 'FNB_BRANCH_COST_REQUIRED';
  end if;
  v_unit := v_balance.unit_cost;
  v_total := round(v_unit * p_quantity, 4);
  v_remaining_quantity := greatest(0, v_balance.costed_quantity - p_quantity);
  update public.fnb_branch_product_cost_balances
     set costed_quantity = v_remaining_quantity,
         total_cost = greatest(0, round(v_balance.total_cost - v_total, 4)),
         unit_cost = case when v_remaining_quantity <= 0.0001 then 0
                          else round(greatest(0, v_balance.total_cost - v_total) / v_remaining_quantity, 6) end
   where tenant_id = p_tenant_id and branch_id = p_branch_id and product_id = p_product_id;
  insert into public.fnb_branch_product_cost_events (
    tenant_id, branch_id, product_id, direction, source_type,
    source_reference_type, source_reference_id, source_stock_movement_id,
    quantity, unit_cost, total_cost, note, created_by
  ) values (
    p_tenant_id, p_branch_id, p_product_id, 'out', p_source_type,
    p_source_reference_type, p_source_reference_id, p_source_stock_movement_id,
    p_quantity, v_unit, v_total, p_note, p_actor
  ) on conflict (source_stock_movement_id) where source_stock_movement_id is not null do nothing;
  return v_unit;
end;
$$;

\ir ../migrations/00399_fnb_purchase_revert_cost_ledger.sql

insert into public.products values
  ('90000000-0000-0000-0000-000000000003', false);
insert into public.purchase_orders values
  ('91000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001'),
  ('91000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001'),
  ('91000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003');
insert into public.fnb_branch_product_cost_balances (
  tenant_id, branch_id, product_id, costed_quantity, total_cost, unit_cost
) values (
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '90000000-0000-0000-0000-000000000003', 8, 80, 10
);
insert into public.fnb_branch_product_cost_events (
  tenant_id, branch_id, product_id, direction, source_type,
  source_reference_type, source_reference_id, quantity, unit_cost, total_cost
) values (
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '90000000-0000-0000-0000-000000000003', 'in', 'purchase_receipt',
  'purchase_order', '91000000-0000-0000-0000-000000000001', 10, 10, 100
), (
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '90000000-0000-0000-0000-000000000003', 'out', 'bom_consume',
  'bom_consume', '93000000-0000-0000-0000-000000000001', 2, 10, 20
);

-- A valid partial reversal reduces the branch ledger at its current WAC.
insert into public.stock_movements values (
  '92000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '90000000-0000-0000-0000-000000000003', 'out', 'purchase_order_revert',
  '91000000-0000-0000-0000-000000000001', 3, null, null
);

do $$
declare
  v_message text;
  v_caught boolean;
begin
  if not exists (
    select 1 from public.fnb_branch_product_cost_balances
     where branch_id = '20000000-0000-0000-0000-000000000001'
       and product_id = '90000000-0000-0000-0000-000000000003'
       and costed_quantity = 5 and total_cost = 50 and unit_cost = 10
  ) or not exists (
    select 1 from public.fnb_branch_product_cost_events
     where source_stock_movement_id = '92000000-0000-0000-0000-000000000001'
       and source_type = 'purchase_order_revert' and direction = 'out'
       and quantity = 3 and unit_cost = 10 and total_cost = 30
  ) then raise exception 'Purchase reversal cost mismatch'; end if;

  v_caught := false;
  begin
    insert into public.stock_movements values (
      '92000000-0000-0000-0000-000000000002',
      '10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      '90000000-0000-0000-0000-000000000003', 'out', 'purchase_order_revert',
      '91000000-0000-0000-0000-000000000002', 1, null, null
    );
  exception when others then
    get stacked diagnostics v_message = message_text;
    v_caught := v_message = 'FNB_PURCHASE_REVERT_COST_SOURCE_REQUIRED';
  end;
  if not v_caught then raise exception 'Expected purchase-source guard, got: %', coalesce(v_message, 'no error'); end if;
  if exists (select 1 from public.stock_movements where id = '92000000-0000-0000-0000-000000000002') then
    raise exception 'Wrong-source movement was not rolled back';
  end if;

  v_caught := false;
  begin
    insert into public.stock_movements values (
      '92000000-0000-0000-0000-000000000003',
      '10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000002',
      '90000000-0000-0000-0000-000000000003', 'out', 'purchase_order_revert',
      '91000000-0000-0000-0000-000000000001', 1, null, null
    );
  exception when others then
    get stacked diagnostics v_message = message_text;
    v_caught := v_message = 'FNB_PURCHASE_REVERT_COST_SOURCE_REQUIRED';
  end;
  if not v_caught then raise exception 'Expected branch-source guard, got: %', coalesce(v_message, 'no error'); end if;
  if exists (select 1 from public.stock_movements where id = '92000000-0000-0000-0000-000000000003') then
    raise exception 'Wrong-branch movement was not rolled back';
  end if;

  v_caught := false;
  begin
    insert into public.stock_movements values (
      '92000000-0000-0000-0000-000000000004',
      '10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      '90000000-0000-0000-0000-000000000003', 'out', 'purchase_order_revert',
      '91000000-0000-0000-0000-000000000001', 6, null, null
    );
  exception when others then
    get stacked diagnostics v_message = message_text;
    v_caught := v_message = 'FNB_BRANCH_COST_REQUIRED';
  end;
  if not v_caught then raise exception 'Expected cost-quantity guard, got: %', coalesce(v_message, 'no error'); end if;
  if exists (select 1 from public.stock_movements where id = '92000000-0000-0000-0000-000000000004') then
    raise exception 'Insufficient-cost movement was not rolled back';
  end if;
end;
$$;

-- A branch outside the explicit F&B cost scope is passed through untouched.
insert into public.stock_movements values (
  '92000000-0000-0000-0000-000000000005',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000003',
  '90000000-0000-0000-0000-000000000003', 'out', 'purchase_order_revert',
  '91000000-0000-0000-0000-000000000003', 1, null, null
);
do $$
begin
  if exists (select 1 from public.fnb_branch_product_cost_events
    where source_stock_movement_id = '92000000-0000-0000-0000-000000000005') then
    raise exception 'Non-opted-in branch cost ledger changed';
  end if;
end;
$$;

select '00399 purchase reversal cost assertions passed' as result;
