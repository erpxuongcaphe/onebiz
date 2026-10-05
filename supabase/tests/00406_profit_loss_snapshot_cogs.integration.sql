-- Disposable PostgreSQL integration check for snapshot-only P&L COGS.
-- Run only against a fresh test database, never against an application database.
\set ON_ERROR_STOP on

select 'create role anon nologin'
 where not exists (select 1 from pg_roles where rolname = 'anon') \gexec
select 'create role authenticated nologin'
 where not exists (select 1 from pg_roles where rolname = 'authenticated') \gexec

create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select '10000000-0000-0000-0000-000000000001'::uuid;
$$;

create table public.profiles (
  id uuid primary key,
  tenant_id uuid not null,
  is_active boolean not null default true
);
create table public.branches (
  id uuid primary key,
  tenant_id uuid not null,
  name text not null,
  branch_type text,
  is_active boolean not null default true
);
create table public.invoices (
  id uuid primary key,
  tenant_id uuid not null,
  branch_id uuid not null,
  status text not null,
  source text,
  total numeric not null,
  delivery_fee numeric,
  debt numeric default 0,
  issued_at timestamptz,
  created_at timestamptz not null
);
create table public.invoice_items (
  id uuid primary key,
  invoice_id uuid not null references public.invoices(id),
  product_id uuid not null,
  product_name text not null,
  quantity numeric not null,
  total numeric not null,
  unit_cost numeric
);
create table public.sales_returns (
  id uuid primary key,
  invoice_id uuid not null references public.invoices(id),
  tenant_id uuid not null,
  branch_id uuid not null,
  status text not null,
  total numeric not null,
  created_at timestamptz not null
);
create table public.return_items (
  id uuid primary key,
  return_id uuid not null references public.sales_returns(id),
  invoice_item_id uuid references public.invoice_items(id),
  product_id uuid not null,
  product_name text not null,
  quantity numeric not null,
  unit_price numeric not null
);
create table public.cash_transactions (
  id uuid primary key,
  tenant_id uuid not null,
  branch_id uuid not null,
  type text not null,
  status text,
  category text,
  amount numeric not null,
  created_at timestamptz not null
);

create function public.assert_report_access(text, uuid)
returns void language sql stable as $$ select; $$;

create function public.get_xnt_report_v2(
  timestamptz, timestamptz, uuid default null, text default null
) returns table (
  opening_value numeric,
  closing_value numeric,
  valuation_complete boolean
) language sql stable as $$
  values (40::numeric, 60::numeric, true);
$$;

insert into public.profiles(id, tenant_id) values (
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001'
);
insert into public.branches(id, tenant_id, name, branch_type) values (
  '40000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'Xuong Tu Bua', 'store'
);

insert into public.invoices(
  id, tenant_id, branch_id, status, source, total, delivery_fee, issued_at, created_at
) values
  ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','completed','pos',50,0,'2026-09-10','2026-09-10'),
  ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','completed','pos',0,0,'2026-09-11','2026-09-11'),
  ('30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','completed','pos',100,0,'2026-09-12','2026-09-12'),
  ('30000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','cancelled','pos',999,0,'2026-09-13','2026-09-13');

insert into public.invoice_items(
  id, invoice_id, product_id, product_name, quantity, total, unit_cost
) values
  ('50000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','Xuong Gu Viet (Size L)',1,30,12),
  ('50000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','Xuong Gu Viet (Size M)',1,20,8),
  ('50000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000002','60000000-0000-0000-0000-000000000002','Ly tang mien phi',1,0,5),
  ('50000000-0000-0000-0000-000000000004','30000000-0000-0000-0000-000000000003','60000000-0000-0000-0000-000000000003','Du lieu cu thieu gia von',1,100,null),
  ('50000000-0000-0000-0000-000000000005','30000000-0000-0000-0000-000000000004','60000000-0000-0000-0000-000000000004','Hoa don huy',1,999,999);

insert into public.sales_returns(
  id, invoice_id, tenant_id, branch_id, status, total, created_at
) values (
  '70000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001',
  'completed', 30, '2026-09-14'
);

insert into public.cash_transactions(
  id, tenant_id, branch_id, type, status, category, amount, created_at
) values
  ('90000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000001',
   '40000000-0000-0000-0000-000000000001',
   'payment', 'completed', 'Tra hang', 300, '2026-09-15'),
  ('90000000-0000-0000-0000-000000000002',
   '20000000-0000-0000-0000-000000000001',
   '40000000-0000-0000-0000-000000000001',
   'payment', 'completed', 'Trả hàng', 200, '2026-09-15'),
  ('90000000-0000-0000-0000-000000000003',
   '20000000-0000-0000-0000-000000000001',
   '40000000-0000-0000-0000-000000000001',
   'payment', 'completed', 'Điện nước', 700, '2026-09-15');

-- Legacy row: same product appears twice, but name + price uniquely identifies Size L.
insert into public.return_items(
  id, return_id, invoice_item_id, product_id, product_name, quantity, unit_price
) values (
  '80000000-0000-0000-0000-000000000001',
  '70000000-0000-0000-0000-000000000001', null,
  '60000000-0000-0000-0000-000000000001',
  'Xuong Gu Viet (Size L)', 1, 30
);

\ir ../migrations/00406_profit_loss_snapshot_cogs.sql
\ir ../migrations/00407_exclude_ascii_sales_return_refunds_from_pnl.sql
\ir ../migrations/00407_exclude_ascii_sales_return_refunds_from_pnl.sql
\ir ../migrations/00427_financial_report_vietnam_buckets.sql

do $$
declare
  v_source record;
  v_report jsonb;
  v_current jsonb;
begin
  select * into strict v_source
    from public.resolve_sales_return_source_line(
      '80000000-0000-0000-0000-000000000001'
    );
  if v_source.invoice_item_id <> '50000000-0000-0000-0000-000000000001'::uuid
     or v_source.unit_cost <> 12
     or v_source.resolution <> 'name_and_price' then
    raise exception 'legacy return resolution mismatch: %', row_to_json(v_source);
  end if;

  v_report := public.get_profit_and_loss_report_v2(
    '2026-09-01','2026-10-01','2026-08-01','2026-09-01',
    '40000000-0000-0000-0000-000000000001', false
  );
  v_current := v_report->'current';

  if (v_current->>'revenue')::numeric <> 120
     or (v_current->>'operating_expense')::numeric <> 700
     or (v_current->>'sales_cogs')::numeric <> 25
     or (v_current->>'returned_cogs')::numeric <> 12
     or (v_current->>'missing_sales_cost_lines')::integer <> 1
     or (v_current->>'missing_return_cost_lines')::integer <> 0
     or (v_current->>'cogs_complete')::boolean
     or v_current->'cogs' <> 'null'::jsonb then
    raise exception 'incomplete P&L was presented as complete: %', v_current;
  end if;

  -- Completing the immutable sale-time snapshot makes COGS exact. The free
  -- sale still contributes its real cost and the return reverses Size L only.
  update public.invoice_items set unit_cost = 7
   where id = '50000000-0000-0000-0000-000000000004';

  v_report := public.get_profit_and_loss_report_v2(
    '2026-09-01','2026-10-01','2026-08-01','2026-09-01',
    '40000000-0000-0000-0000-000000000001', false
  );
  v_current := v_report->'current';

  if not (v_current->>'cogs_complete')::boolean
     or (v_current->>'cogs')::numeric <> 20
     or (v_current->>'snapshot_lines')::integer <> 5 then
    raise exception 'complete snapshot COGS mismatch: %', v_current;
  end if;

  v_current := public.get_branch_profit_and_loss_report_v2(
    '2026-09-01','2026-10-01'
  )->'rows'->0;
  if not (v_current->>'cogs_complete')::boolean
     or (v_current->>'cogs')::numeric <> 20
     or (v_current->>'gross_profit')::numeric <> 100 then
    raise exception 'branch P&L mismatch: %', v_current;
  end if;
  if (v_current->>'operating_expense')::numeric <> 700 then
    raise exception 'branch P&L counted sales-return refunds as expenses: %', v_current;
  end if;

  v_current := public.get_financial_analysis_details_report_v2(
    '2026-09-01','2026-10-01',
    '40000000-0000-0000-0000-000000000001', false, 10
  );
  if not (v_current->>'cogs_complete')::boolean
     or (v_current->'reconciliation'->>'sales_cogs')::numeric <> 32
     or (v_current->'reconciliation'->>'returned_cogs')::numeric <> 12
     or (v_current->'turnover'->>'turnover_ratio')::numeric <> 0.40
     or jsonb_array_length(v_current->'cogs_breakdown') <> 3 then
    raise exception 'financial detail mismatch: %', v_current;
  end if;
end;
$$;

-- Caller timezone must not change calendar grouping or totals.
set timezone to 'UTC';
do $$
declare
  v_report jsonb;
  v_other jsonb;
  v_from timestamptz;
  v_to timestamptz;
  v_granularity text;
  v_expected integer;
begin
  for v_from, v_to, v_granularity, v_expected in
    select * from (values
      ('2026-08-31T17:00:00Z'::timestamptz, '2026-09-30T17:00:00Z'::timestamptz, 'day', 30),
      ('2025-12-31T17:00:00Z'::timestamptz, '2026-12-31T17:00:00Z'::timestamptz, 'month', 12),
      ('2024-12-31T17:00:00Z'::timestamptz, '2026-12-31T17:00:00Z'::timestamptz, 'year', 2)
    ) ranges
  loop
    v_report := public.get_financial_analysis_details_report_v2(
      v_from, v_to, '40000000-0000-0000-0000-000000000001', false, 10
    );
    if v_report->>'granularity' <> v_granularity
       or jsonb_array_length(v_report->'margin_trend') <> v_expected
       or (v_report->'margin_trend'->0->>'bucket_start')::timestamptz <> v_from then
      raise exception 'Vietnam calendar bucket boundary mismatch: %', v_report;
    end if;
    if (select sum((x->>'revenue')::numeric)
        from jsonb_array_elements(v_report->'margin_trend') x) <> 120
       or (select sum((x->>'cogs')::numeric)
        from jsonb_array_elements(v_report->'margin_trend') x) <> 20 then
      raise exception 'Bucket totals differ from immutable sale/return snapshots';
    end if;
    perform set_config('timezone', 'America/New_York', true);
    v_other := public.get_financial_analysis_details_report_v2(
      v_from, v_to, '40000000-0000-0000-0000-000000000001', false, 10
    );
    if v_report->'margin_trend' <> v_other->'margin_trend'
       or current_setting('timezone') <> 'America/New_York' then
      raise exception 'Report leaked or depended on caller timezone';
    end if;
    perform set_config('timezone', 'UTC', true);
  end loop;
end;
$$;
