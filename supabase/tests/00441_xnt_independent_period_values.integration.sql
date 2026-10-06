-- Disposable xnt_valuation_test database only, after the 00411 integration test.
\set ON_ERROR_STOP on
begin;
update public.stock_movements set unit_cost = null, unit_price = null
where id = '50000000-0000-0000-0000-000000000001';

do $$
declare r record;
begin
  select * into r from public.get_xnt_report_v2(
    '2026-01-01 00:00:00+00', '2026-02-01 00:00:00+00',
    '30000000-0000-0000-0000-000000000001', null
  ) where code = 'NVL-001';
  if r.valuation_complete or r.opening_value is not null or r.closing_value is not null
     or r.in_value is distinct from 300::numeric or r.out_value is distinct from 420::numeric then
    raise exception 'opening gap erased valid period values: %', row_to_json(r);
  end if;

  delete from public.fnb_branch_product_cost_events
  where source_stock_movement_id = '50000000-0000-0000-0000-000000000003';
  select * into r from public.get_xnt_report_v2(
    '2026-01-01 00:00:00+00', '2026-02-01 00:00:00+00',
    '30000000-0000-0000-0000-000000000001', null
  ) where code = 'NVL-001';
  if r.in_value is distinct from 300::numeric or r.out_value is not null then
    raise exception 'strict F&B missing event guard lost: %', row_to_json(r);
  end if;

  select * into r from public.get_xnt_report_v2(
    '2026-01-01 00:00:00+00', '2026-02-01 00:00:00+00',
    '30000000-0000-0000-0000-000000000001', null
  ) where code = 'OLD-001';
  if r.in_value is distinct from 0::numeric or r.out_value is distinct from 0::numeric
     or r.opening_value is not null or r.closing_value is not null then
    raise exception 'zero-activity period did not remain independently valid: %', row_to_json(r);
  end if;
end $$;
rollback;
