-- Disposable PostgreSQL integration check for historical XNT valuation and
-- F&B internal-sale receipt cost mapping.
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
  reference_id uuid,
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
  direction text not null,
  source_type text not null,
  source_reference_type text not null,
  source_reference_id uuid not null,
  source_stock_movement_id uuid,
  quantity numeric not null,
  total_cost numeric not null
);

create table public.internal_sales (
  id uuid primary key,
  tenant_id uuid not null,
  to_branch_id uuid not null,
  input_invoice_id uuid
);

create table public.fnb_supply_branch_scopes (
  tenant_id uuid not null,
  branch_id uuid not null,
  enforcement_enabled boolean not null
);

create function public._fnb_branch_cost_tracking_enabled_00390(uuid, uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from public.fnb_supply_branch_scopes scope
     where scope.tenant_id = $1
       and scope.branch_id = $2
       and scope.enforcement_enabled
  );
$$;

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
    ),
    (
      '40000000-0000-0000-0000-000000000003'::uuid,
      'ZERO-RESIDUAL', 'Tồn lượng không còn, dư giá trị', 'G', 'Kiểm thử', 1::numeric,
      0::numeric, 1::numeric, 0::numeric, 0::numeric, 0::numeric,
      0::numeric, 0::numeric, 1::numeric, 0::numeric, 0::numeric,
      0::numeric, 0::numeric, 0::numeric, 0::numeric, 0::numeric, 0::numeric
    ),
    (
      '40000000-0000-0000-0000-000000000004'::uuid,
      'NEGATIVE-VALUE', 'Tồn dương có giá trị âm', 'G', 'Kiểm thử', 1::numeric,
      0::numeric, 2::numeric, 0::numeric, 0::numeric, 0::numeric,
      0::numeric, 0::numeric, 1::numeric, 0::numeric, 0::numeric,
      0::numeric, 0::numeric, 0::numeric, 0::numeric, 0::numeric, 1::numeric
    ),
    (
      '40000000-0000-0000-0000-000000000005'::uuid,
      'SKU-INT-001', 'Nhập nội bộ', 'Gói', 'F&B', 777777::numeric,
      0::numeric, 0::numeric, 0::numeric, 0::numeric, 0::numeric,
      0::numeric, 2::numeric, 0::numeric, 0::numeric, 0::numeric,
      0::numeric, 0::numeric, 0::numeric, 0::numeric, 0::numeric, 2::numeric
    ),
    (
      '40000000-0000-0000-0000-000000000006'::uuid,
      'SKU-RETAIL-001', 'Nhập nội bộ Retail', 'Gói', 'Retail', 777777::numeric,
      0::numeric, 0::numeric, 0::numeric, 0::numeric, 0::numeric,
      0::numeric, 2::numeric, 0::numeric, 0::numeric, 0::numeric,
      0::numeric, 0::numeric, 0::numeric, 0::numeric, 0::numeric, 2::numeric
    );
$$;

insert into public.profiles(id, tenant_id) values (
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001'
);

insert into public.fnb_supply_branch_scopes(tenant_id, branch_id, enforcement_enabled)
values (
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  true
);

insert into public.stock_movements(
  id, tenant_id, branch_id, product_id, type, reference_type, reference_id,
  quantity, unit_cost, unit_price, created_at
) values
  (
    '50000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000001',
    'in', 'purchase_entry', null, 10, null, 100, '2025-12-15 00:00:00+00'
  ),
  (
    '50000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000001',
    'in', 'internal_sale', '70000000-0000-0000-0000-000000000002',
    2, 999, 999, '2026-01-10 00:00:00+00'
  ),
  (
    '50000000-0000-0000-0000-000000000003',
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000001',
    'out', 'bom_consume', null, 3, 120, 777, '2026-01-20 00:00:00+00'
  ),
  (
    '50000000-0000-0000-0000-000000000004',
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000002',
    'in', 'legacy_opening', null, 2, null, null, '2025-12-10 00:00:00+00'
  ),
  (
    '50000000-0000-0000-0000-000000000005',
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000003',
    'in', 'purchase_entry', null, 1, 10, null, '2026-01-10 00:00:00+00'
  ),
  (
    '50000000-0000-0000-0000-000000000006',
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000003',
    'out', 'bom_consume', null, 1, 12, null, '2026-01-20 00:00:00+00'
  ),
  (
    '50000000-0000-0000-0000-000000000007',
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000004',
    'in', 'purchase_entry', null, 2, 10, null, '2026-01-10 00:00:00+00'
  ),
  (
    '50000000-0000-0000-0000-000000000008',
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000004',
    'out', 'bom_consume', null, 1, 25, null, '2026-01-20 00:00:00+00'
  ),
  (
    '50000000-0000-0000-0000-000000000009',
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000005',
    'in', 'internal_sale', '70000000-0000-0000-0000-000000000003',
    2, 6000, 10000, '2026-01-15 00:00:00+00'
  ),
  (
    '50000000-0000-0000-0000-000000000010',
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000002',
    '40000000-0000-0000-0000-000000000006',
    'in', 'internal_sale', '70000000-0000-0000-0000-000000000004',
    2, 7000, 10000, '2026-01-18 00:00:00+00'
  );

-- The branch cost ledger must win over both stock movement price columns.
insert into public.fnb_branch_product_cost_events(
  id, tenant_id, branch_id, product_id, direction, source_type,
  source_reference_type, source_reference_id, source_stock_movement_id,
  quantity, total_cost
) values (
  '60000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001',
  'in', 'internal_sale_receipt', 'internal_sale',
  '70000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000002',
  2,
  300
), (
  '60000000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000003',
  'in', 'internal_sale_receipt', 'internal_sale',
  '70000000-0000-0000-0000-000000000003',
  null,
  2,
  20000
), (
  '60000000-0000-0000-0000-000000000003',
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000099',
  '40000000-0000-0000-0000-000000000003',
  'in', 'internal_sale_receipt', 'internal_sale',
  '70000000-0000-0000-0000-000000000003',
  null,
  2,
  99000
);

insert into public.internal_sales(id, tenant_id, to_branch_id, input_invoice_id)
values (
  '70000000-0000-0000-0000-000000000003',
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  '70000000-0000-0000-0000-000000000003'
);

\ir ../migrations/00404_historical_xnt_valuation.sql
\ir ../migrations/00408_flag_inconsistent_xnt_valuation.sql
\ir ../migrations/00408_flag_inconsistent_xnt_valuation.sql
\ir ../migrations/00409_xnt_internal_sale_branch_cost.sql

do $$
declare
  v_complete record;
  v_legacy record;
  v_residual record;
  v_negative record;
  v_internal_sale record;
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

  select * into v_residual
    from public.get_xnt_report_v2(
      '2026-01-01 00:00:00+00', '2026-02-01 00:00:00+00',
      '30000000-0000-0000-0000-000000000001', null
    ) report
   where report.code = 'ZERO-RESIDUAL';

  if v_residual.code is distinct from 'ZERO-RESIDUAL'
     or v_residual.closing_qty <> 0
     or v_residual.valuation_complete
     or v_residual.opening_value is not null
     or v_residual.in_value is not null
     or v_residual.out_value is not null
     or v_residual.closing_value is not null then
    raise exception 'zero quantity with residual negative value was published as complete: %',
      row_to_json(v_residual);
  end if;

  select * into v_negative
    from public.get_xnt_report_v2(
      '2026-01-01 00:00:00+00', '2026-02-01 00:00:00+00',
      '30000000-0000-0000-0000-000000000001', null
    ) report
   where report.code = 'NEGATIVE-VALUE';

  if v_negative.code is distinct from 'NEGATIVE-VALUE'
     or v_negative.closing_qty <> 1
     or v_negative.valuation_complete
     or v_negative.closing_value is not null then
    raise exception 'negative ending value with positive stock was published as complete: %',
      row_to_json(v_negative);
  end if;

  select * into v_internal_sale
    from public.get_xnt_report_v2(
      '2026-01-01 00:00:00+00', '2026-02-01 00:00:00+00',
      '30000000-0000-0000-0000-000000000001', null
    ) report
   where report.code = 'SKU-INT-001';

  if v_internal_sale.in_value <> 20000
     or v_internal_sale.closing_value <> 20000
     or not v_internal_sale.valuation_complete
     or v_internal_sale.valued_movement_count <> 1
     or v_internal_sale.missing_cost_movement_count <> 0 then
    raise exception 'internal-sale receipt did not use the receiving branch cost event: %',
      row_to_json(v_internal_sale);
  end if;

  update public.fnb_branch_product_cost_events
     set quantity = 1
   where id = '60000000-0000-0000-0000-000000000002';

  select * into v_internal_sale
    from public.get_xnt_report_v2(
      '2026-01-01 00:00:00+00', '2026-02-01 00:00:00+00',
      '30000000-0000-0000-0000-000000000001', null
    ) report
   where report.code = 'SKU-INT-001';

  if v_internal_sale.valuation_complete
     or v_internal_sale.in_value is not null
     or v_internal_sale.closing_value is not null
     or v_internal_sale.missing_cost_movement_count <> 1 then
    raise exception 'mismatched internal-sale cost quantity was presented as complete: %',
      row_to_json(v_internal_sale);
  end if;

  select * into v_internal_sale
    from public.get_xnt_report_v2(
      '2026-01-01 00:00:00+00', '2026-02-01 00:00:00+00', null, null
    ) report
   where report.code = 'SKU-RETAIL-001';

  if v_internal_sale.in_value <> 14000
     or v_internal_sale.closing_value <> 14000
     or not v_internal_sale.valuation_complete
     or v_internal_sale.missing_cost_movement_count <> 0 then
    raise exception 'non-F&B internal-sale receipt no longer uses its legacy valuation: %',
      row_to_json(v_internal_sale);
  end if;
end;
$$;

