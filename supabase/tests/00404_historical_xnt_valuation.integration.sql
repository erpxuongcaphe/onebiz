-- Disposable PostgreSQL integration check for historical XNT valuation.
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

create table public.stock_movements (
  id uuid primary key,
  tenant_id uuid not null,
  branch_id uuid not null,
  product_id uuid not null,
  type text not null,
  reference_type text not null,
  quantity numeric not null,
  unit_cost numeric,
  unit_price numeric,
  created_at timestamptz not null
);

create table public.fnb_branch_product_cost_events (
  id uuid primary key,
  tenant_id uuid not null,
  branch_id uuid not null,
  product_id uuid not null,
  source_stock_movement_id uuid,
  total_cost numeric not null
);

create function public.assert_report_access(text, uuid)
returns void language sql stable as $$ select; $$;

create function public.get_xnt_report(
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_branch_id uuid default null,
  p_search text default null
) returns table (
  product_id uuid,
  code text,
  name text,
  unit text,
  category_name text,
  cost_price numeric,
  opening_qty numeric,
  in_supplier numeric,
  in_check numeric,
  in_return numeric,
  in_transfer numeric,
  in_production numeric,
  in_other numeric,
  out_sale numeric,
  out_disposal numeric,
  out_supplier_return numeric,
  out_check numeric,
  out_transfer numeric,
  out_production numeric,
  out_internal numeric,
  out_other numeric,
  closing_qty numeric
) language sql stable as $$
  values
    (
      '40000000-0000-0000-0000-000000000001'::uuid,
      'NVL-001', 'Đủ snapshot', 'G', 'Nguyên liệu', 999999::numeric,
      10::numeric, 2::numeric, 0::numeric, 0::numeric, 0::numeric,
      0::numeric, 0::numeric, 3::numeric, 0::numeric, 0::numeric,
      0::numeric, 0::numeric, 0::numeric, 0::numeric, 0::numeric, 9::numeric
    ),
    (
      '40000000-0000-0000-0000-000000000002'::uuid,
      'OLD-001', 'Thiếu snapshot', 'Cái', 'Dữ liệu cũ', 888888::numeric,
      2::numeric, 0::numeric, 0::numeric, 0::numeric, 0::numeric,
      0::numeric, 0::numeric, 0::numeric, 0::numeric, 0::numeric,
      0::numeric, 0::numeric, 0::numeric, 0::numeric, 0::numeric, 2::numeric
    );
$$;

insert into public.profiles(id, tenant_id) values (
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001'
);

insert into public.stock_movements(
  id, tenant_id, branch_id, product_id, type, reference_type,
  quantity, unit_cost, unit_price, created_at
) values
  (
    '50000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000001',
    'in', 'purchase_entry', 10, null, 100, '2025-12-15 00:00:00+00'
  ),
  (
    '50000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000001',
    'in', 'internal_sale_receipt', 2, 999, 999, '2026-01-10 00:00:00+00'
  ),
  (
    '50000000-0000-0000-0000-000000000003',
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000001',
    'out', 'bom_consume', 3, 120, 777, '2026-01-20 00:00:00+00'
  ),
  (
    '50000000-0000-0000-0000-000000000004',
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000002',
    'in', 'legacy_opening', 2, null, null, '2025-12-10 00:00:00+00'
  );

-- The branch cost ledger must win over both stock movement price columns.
insert into public.fnb_branch_product_cost_events(
  id, tenant_id, branch_id, product_id, source_stock_movement_id, total_cost
) values (
  '60000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000002',
  300
);

\ir ../migrations/00404_historical_xnt_valuation.sql

do $$
declare
  v_complete record;
  v_legacy record;
begin
  select * into v_complete
    from public.get_xnt_report_v2(
      '2026-01-01 00:00:00+00', '2026-02-01 00:00:00+00',
      '30000000-0000-0000-0000-000000000001', null
    ) report
   where report.code = 'NVL-001';

  if v_complete.opening_value <> 1000
     or v_complete.in_value <> 300
     or v_complete.out_value <> 360
     or v_complete.closing_value <> 940
     or not v_complete.valuation_complete
     or v_complete.valued_movement_count <> 3
     or v_complete.missing_cost_movement_count <> 0 then
    raise exception 'complete valuation mismatch: %', row_to_json(v_complete);
  end if;

  -- A sale price on an outbound row must never be accepted as historical cost.
  update public.stock_movements
     set unit_cost = null, unit_price = 777
   where id = '50000000-0000-0000-0000-000000000003';

  select * into v_complete
    from public.get_xnt_report_v2(
      '2026-01-01 00:00:00+00', '2026-02-01 00:00:00+00',
      '30000000-0000-0000-0000-000000000001', null
    ) report
   where report.code = 'NVL-001';

  if v_complete.valuation_complete
     or v_complete.out_value is not null
     or v_complete.closing_value is not null
     or v_complete.missing_cost_movement_count <> 1 then
    raise exception 'outbound sale price was incorrectly accepted as cost: %', row_to_json(v_complete);
  end if;

  select * into v_legacy
    from public.get_xnt_report_v2(
      '2026-01-01 00:00:00+00', '2026-02-01 00:00:00+00',
      '30000000-0000-0000-0000-000000000001', null
    ) report
   where report.code = 'OLD-001';

  if v_legacy.valuation_complete
     or v_legacy.opening_value is not null
     or v_legacy.closing_value is not null
     or v_legacy.missing_cost_movement_count <> 1 then
    raise exception 'legacy missing cost was presented as a value: %', row_to_json(v_legacy);
  end if;
end;
$$;

