-- Disposable PostgreSQL integration check for strict branch F&B BOM valuation.
-- Run only after 00404_historical_xnt_valuation.integration.sql in its fresh
-- xnt_valuation_test database. Never run against an application database.
\set ON_ERROR_STOP on

-- Restore the legacy movement snapshot changed by the 00404 negative test.
update public.stock_movements
   set unit_cost = 120, unit_price = 777
 where id = '50000000-0000-0000-0000-000000000003';

do $$
declare
  v_report record;
begin
  select * into v_report
    from public.get_xnt_report_v2(
      '2026-01-01 00:00:00+00', '2026-02-01 00:00:00+00',
      '30000000-0000-0000-0000-000000000001', null
    ) report
   where report.code = 'NVL-001';

  if v_report.valuation_complete
     or v_report.out_value is not null
     or v_report.closing_value is not null
     or v_report.missing_cost_movement_count <> 1 then
    raise exception 'tracked F&B BOM without branch event was valued: %', row_to_json(v_report);
  end if;

  update public.fnb_supply_branch_scopes
     set enforcement_enabled = false
   where tenant_id = '20000000-0000-0000-0000-000000000001'
     and branch_id = '30000000-0000-0000-0000-000000000001';

  select * into v_report
    from public.get_xnt_report_v2(
      '2026-01-01 00:00:00+00', '2026-02-01 00:00:00+00',
      '30000000-0000-0000-0000-000000000001', null
    ) report
   where report.code = 'NVL-001';

  if not v_report.valuation_complete
     or v_report.out_value <> 360
     or v_report.closing_value <> 940
     or v_report.missing_cost_movement_count <> 0 then
    raise exception 'untracked branch did not retain legacy movement valuation: %', row_to_json(v_report);
  end if;

  update public.fnb_supply_branch_scopes
     set enforcement_enabled = true
   where tenant_id = '20000000-0000-0000-0000-000000000001'
     and branch_id = '30000000-0000-0000-0000-000000000001';

  insert into public.fnb_branch_product_cost_events(
    id, tenant_id, branch_id, product_id, direction, source_type,
    source_reference_type, source_reference_id, source_stock_movement_id,
    quantity, total_cost
  ) values (
    '60000000-0000-0000-0000-000000000004',
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000001',
    'out', 'bom_consumption', 'invoice',
    '70000000-0000-0000-0000-000000000004',
    '50000000-0000-0000-0000-000000000003',
    3, 420
  );

  select * into v_report
    from public.get_xnt_report_v2(
      '2026-01-01 00:00:00+00', '2026-02-01 00:00:00+00',
      '30000000-0000-0000-0000-000000000001', null
    ) report
   where report.code = 'NVL-001';

  if not v_report.valuation_complete
     or v_report.out_value <> 420
     or v_report.closing_value <> 880
     or v_report.missing_cost_movement_count <> 0 then
    raise exception 'movement-linked branch cost event was not prioritized: %', row_to_json(v_report);
  end if;
end;
$$;

