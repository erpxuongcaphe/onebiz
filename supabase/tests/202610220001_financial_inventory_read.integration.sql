-- Fresh disposable database only. Synthetic rows; no application connection or data.
\set ON_ERROR_STOP on
\ir 00406_profit_loss_snapshot_cogs.integration.sql

create table public.test_branch_policy (tenant_id uuid, branch_id uuid, can_read boolean, tracked boolean);
insert into public.test_branch_policy values
  ('20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', true, true),
  ('20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002', true, false),
  ('20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000003', false, true);

create function public._can_read_branch_inventory_00476(uuid, uuid, uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select can_read from public.test_branch_policy where tenant_id = $2 and branch_id = $3), false)
$$;
create function public._fnb_branch_cost_tracking_enabled_00390(uuid, uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select tracked from public.test_branch_policy where tenant_id = $1 and branch_id = $2
$$;
create function public.user_has_permission(uuid, text) returns boolean language sql stable as $$ select true $$;
create table public.products (
  id uuid primary key, tenant_id uuid, code text, name text, unit text,
  category_id uuid, cost_price numeric, stock numeric, inventory_role text
);
create table public.categories (id uuid primary key, tenant_id uuid, name text);
create table public.branch_stock (tenant_id uuid, branch_id uuid, product_id uuid, variant_id uuid, quantity numeric);
create table public.stock_movements (
  id uuid primary key, tenant_id uuid, branch_id uuid, product_id uuid, created_at timestamptz,
  type text, reference_type text, quantity numeric, unit_cost numeric, unit_price numeric
);
create table public.fnb_branch_product_cost_events (
  id uuid primary key, tenant_id uuid, branch_id uuid, product_id uuid, created_at timestamptz,
  direction text, source_reference_type text, source_type text,
  quantity numeric, total_cost numeric, source_stock_movement_id uuid
);
insert into public.products
select md5('fixture-product-' || i)::uuid, '20000000-0000-0000-0000-000000000001',
  'TEST-' || i, 'Synthetic product ' || i, 'g', null, 2, 0, 'retail_sku'
from generate_series(1, 30) i;
insert into public.stock_movements
select md5('fixture-stock-' || i)::uuid, '20000000-0000-0000-0000-000000000001',
  ('40000000-0000-0000-0000-' || lpad((1 + i % 3)::text, 12, '0'))::uuid,
  md5('fixture-product-' || (1 + i % 30))::uuid,
  '2026-09-01'::timestamptz + (i % 50) * interval '1 day',
  case when i % 4 = 0 then 'out' else 'in' end,
  case when i % 4 = 0 then 'sale' else 'purchase_entry' end,
  1, 2, 2
from generate_series(1, 3000) i;
insert into public.fnb_branch_product_cost_events
select md5('fixture-event-' || s.id)::uuid, s.tenant_id, s.branch_id, s.product_id, s.created_at,
  s.type, s.reference_type, 'purchase_entry', s.quantity, 2, s.id
from public.stock_movements s;
insert into public.branch_stock
select tenant_id, branch_id, product_id, null, sum(case type when 'in' then quantity else -quantity end)
from public.stock_movements group by tenant_id, branch_id, product_id;

drop function public.get_xnt_report_v2(timestamptz, timestamptz, uuid, text);
\ir ../../.tmp/financial-inventory-baseline.sql

-- Same-query comparison retains all JSON fields, including transaction timestamps.
do $$
begin
  execute replace(
    pg_get_functiondef('public.get_financial_analysis_details_report_v2(timestamptz,timestamptz,uuid,boolean,integer)'::regprocedure),
    'FUNCTION public.get_financial_analysis_details_report_v2(', 'FUNCTION public.test_financial_before('
  );
end $$;
create table public.test_function_metadata as
select p.oid, p.proname, p.proowner, p.proacl, p.proconfig, pg_get_functiondef(p.oid) definition
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in (
  'get_financial_analysis_details_report_v2', 'get_xnt_report', 'get_xnt_report_v2',
  '_inventory_value_timeline_00540', '_can_read_branch_inventory_00476',
  '_fnb_branch_cost_tracking_enabled_00390', 'assert_report_access'
);
create function public.test_business_hash() returns text language sql stable as $$
  select md5(jsonb_build_array(
    (select jsonb_agg(s order by id) from public.stock_movements s),
    (select jsonb_agg(e order by id) from public.fnb_branch_product_cost_events e),
    (select jsonb_agg(p order by id) from public.products p),
    (select jsonb_agg(b order by branch_id, product_id) from public.branch_stock b),
    (select jsonb_agg(i order by id) from public.invoices i),
    (select jsonb_agg(i order by id) from public.invoice_items i),
    (select jsonb_agg(r order by id) from public.sales_returns r),
    (select jsonb_agg(c order by id) from public.cash_transactions c)
  )::text)
$$;
create table public.test_business_before as select public.test_business_hash() hash;
\ir ../migrations/202610220001_financial_report_inventory_read.sql

do $$
begin
  if public.test_business_hash() is distinct from (select hash from public.test_business_before) then
    raise exception 'Migration changed business rows';
  end if;
end $$;

create function public.test_financial_inventory_equivalence() returns void language plpgsql as $$
declare
  b uuid; x boolean; dates text[]; baseline jsonb; candidate jsonb; lim integer;
  tenant constant uuid := '20000000-0000-0000-0000-000000000001';
begin
  foreach b in array array[null::uuid,
    '40000000-0000-0000-0000-000000000001'::uuid,
    '40000000-0000-0000-0000-000000000002'::uuid,
    '40000000-0000-0000-0000-000000000003'::uuid]
  loop
    foreach dates slice 1 in array array[
      array['2026-09-01', '2026-10-01'], array['2026-09-10', '2026-09-11'],
      array['2026-01-01', '2027-01-01'], array['2026-12-01', '2026-12-02']]
    loop
      if exists (
        (select * from public._inventory_value_timeline_00540('-infinity', dates[2]::timestamptz, b, tenant)
         except all select * from public._financial_inventory_timeline_20261022('-infinity', dates[2]::timestamptz, b, tenant))
        union all
        (select * from public._financial_inventory_timeline_20261022('-infinity', dates[2]::timestamptz, b, tenant)
         except all select * from public._inventory_value_timeline_00540('-infinity', dates[2]::timestamptz, b, tenant))
      ) then raise exception 'Timeline differs for branch % and dates %', b, dates; end if;
      foreach x in array array[false, true] loop
        foreach lim in array array[1, 10, 50000] loop
          select public.test_financial_before(dates[1]::timestamptz, dates[2]::timestamptz, b, x, lim),
                 public.get_financial_analysis_details_report_v2(dates[1]::timestamptz, dates[2]::timestamptz, b, x, lim)
          into baseline, candidate;
          if baseline is distinct from candidate then
            raise exception 'Report JSON differs for branch %, dates %, exclude %, limit %', b, dates, x, lim;
          end if;
        end loop;
      end loop;
    end loop;
  end loop;
end $$;
select public.test_financial_inventory_equivalence();

-- Missing costs and correction restatements must not become complete/zero valuations.
update public.fnb_branch_product_cost_events set total_cost = null
where source_stock_movement_id = md5('fixture-stock-1')::uuid;
update public.fnb_branch_product_cost_events set source_reference_type = 'production_correction',
  source_type = 'production_complete', direction = 'out'
where source_stock_movement_id = md5('fixture-stock-3')::uuid;
update public.fnb_branch_product_cost_events set direction = 'out'
where source_stock_movement_id = md5('fixture-stock-7')::uuid;
select public.test_financial_inventory_equivalence();
update public.test_branch_policy set tracked = not tracked;
select public.test_financial_inventory_equivalence();
update public.test_branch_policy set can_read = false;
select public.test_financial_inventory_equivalence();
update public.test_branch_policy set can_read = null, tracked = null;
select public.test_financial_inventory_equivalence();

do $$
declare m record;
begin
  for m in select * from public.test_function_metadata loop
    if m.proname <> 'get_financial_analysis_details_report_v2'
       and pg_get_functiondef(m.oid) is distinct from m.definition then
      raise exception 'Shared function changed: %', m.proname;
    end if;
    if exists (select 1 from pg_proc p where p.oid = m.oid and
      (p.proowner is distinct from m.proowner or p.proacl is distinct from m.proacl
       or p.proconfig is distinct from m.proconfig)) then
      raise exception 'Metadata changed: %', m.proname;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'public._financial_inventory_summary_20261022(timestamptz,timestamptz,uuid,uuid)', 'execute')
    or has_function_privilege('anon', 'public._financial_inventory_summary_20261022(timestamptz,timestamptz,uuid,uuid)', 'execute')
    or has_function_privilege('authenticated', 'public._financial_inventory_timeline_20261022(timestamptz,timestamptz,uuid,uuid)', 'execute')
    or has_function_privilege('anon', 'public._financial_inventory_timeline_20261022(timestamptz,timestamptz,uuid,uuid)', 'execute') then
    raise exception 'Report internals exposed';
  end if;
end $$;

select 'PASS: report equivalence, date/branch/internal/limit filters, incomplete cost, correction, dynamic policy, private helpers, shared function preservation';

