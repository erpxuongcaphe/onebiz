-- Fresh disposable database only. Production RPCs; permission and XNT adapters
-- come from the snapshot fixture, so this does not certify RLS or stock valuation.
\set ON_ERROR_STOP on
do $$ begin
  if current_database() <> 'profit_loss_cross_period_test' then
    raise exception 'DISPOSABLE_DATABASE_REQUIRED';
  end if;
end $$;
set timezone = 'Asia/Ho_Chi_Minh';
\ir 00406_profit_loss_snapshot_cogs.integration.sql

-- Move a half-unit return to exactly the next period's opening boundary.
update public.sales_returns set total = 15, created_at = '2026-10-01 00:00:00+07';
update public.return_items set quantity = 0.5;
update public.cash_transactions set created_at = '2026-10-15 12:00:00+07';
update public.invoices set source = 'fnb' where status = 'completed';

-- A cancelled return must not contribute; a confirmed Size M return belongs
-- to November, not October. Both link to the original immutable sale cost.
insert into public.sales_returns values
 ('70000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','cancelled',900,'2026-10-10'),
 ('70000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','confirmed',20,'2026-11-01 00:00:00+07');
insert into public.return_items values
 ('80000000-0000-0000-0000-000000000002','70000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','Xuong Gu Viet (Size L)',1,900),
 ('80000000-0000-0000-0000-000000000003','70000000-0000-0000-0000-000000000003','50000000-0000-0000-0000-000000000002','60000000-0000-0000-0000-000000000001','Xuong Gu Viet (Size M)',1,20);

do $$
declare
  report jsonb; current_period jsonb; previous_period jsonb;
  details jsonb; branch_row jsonb; trend_revenue numeric; trend_cost numeric;
begin
  report := public.get_profit_and_loss_report_v2(
    '2026-10-01','2026-11-01','2026-09-01','2026-10-01',
    '40000000-0000-0000-0000-000000000001',false);
  current_period := report->'current'; previous_period := report->'previous';
  if not (current_period @> '{"revenue":-15,"sales_cogs":0,"returned_cogs":6,"cogs":-6,"operating_expense":700,"invoice_count":0,"return_count":1,"cogs_complete":true}'::jsonb)
     or not (previous_period @> '{"revenue":150,"sales_cogs":32,"returned_cogs":0,"cogs":32,"operating_expense":0,"invoice_count":3,"return_count":0,"cogs_complete":true}'::jsonb) then
    raise exception 'cross-period summary mismatch: %', report;
  end if;

  select value into strict branch_row from jsonb_array_elements(
    public.get_branch_profit_and_loss_report_v2('2026-10-01','2026-11-01')->'rows')
    where value->>'branch_id' = '40000000-0000-0000-0000-000000000001';
  if not (branch_row @> '{"total_revenue":-15,"cogs":-6,"gross_profit":-9,"operating_expense":700,"operating_result":-709,"cogs_complete":true}'::jsonb) then
    raise exception 'cross-period branch mismatch: %', branch_row;
  end if;

  details := public.get_financial_analysis_details_report_v2(
    '2026-10-01','2026-11-01','40000000-0000-0000-0000-000000000001',false,10);
  select sum((value->>'revenue')::numeric), sum((value->>'cogs')::numeric)
    into trend_revenue, trend_cost from jsonb_array_elements(details->'margin_trend');
  if not (details->'reconciliation' @> '{"invoice_count":0,"invoice_total":0,"return_count":1,"returned_total":15,"sales_cogs":0,"returned_cogs":6,"cogs_complete":true}'::jsonb)
     or trend_revenue is distinct from -15::numeric
     or trend_cost is distinct from -6::numeric
     or not (details->'cogs_breakdown'->0 @> '{"quantity":-0.5,"total_cost":-6,"cost_complete":true}'::jsonb) then
    raise exception 'cross-period detail mismatch: %', details;
  end if;

  report := public.get_profit_and_loss_report_v2(
    '2026-11-01','2026-12-01','2026-10-01','2026-11-01',
    '40000000-0000-0000-0000-000000000001',false);
  if not (report->'current' @> '{"revenue":-20,"returned_cogs":8,"cogs":-8,"return_count":1}'::jsonb)
     or not (report->'previous' @> '{"revenue":-15,"returned_cogs":6,"cogs":-6,"return_count":1}'::jsonb) then
    raise exception 'exclusive end boundary or variant snapshot mismatch: %', report;
  end if;

  report := public.get_profit_and_loss_report_v2(
    '2026-09-01','2026-12-01','2026-08-01','2026-09-01',
    '40000000-0000-0000-0000-000000000001',false);
  if not (report->'current' @> '{"revenue":115,"sales_cogs":32,"returned_cogs":14,"cogs":18,"return_count":2,"operating_expense":700}'::jsonb) then
    raise exception 'combined periods do not reconcile: %', report;
  end if;
end $$;

-- Excluding internal sales must also exclude their later returns.
update public.invoices set source = 'internal'
 where id = '30000000-0000-0000-0000-000000000001';
do $$ declare report jsonb; begin
  report := public.get_profit_and_loss_report_v2(
    '2026-10-01','2026-11-01','2026-09-01','2026-10-01',
    '40000000-0000-0000-0000-000000000001',true);
  if not (report->'current' @> '{"revenue":0,"cogs":0,"return_count":0}'::jsonb)
     or not (report->'previous' @> '{"revenue":100,"cogs":12,"invoice_count":2}'::jsonb) then
    raise exception 'internal cross-period exclusion mismatch: %', report;
  end if;
end $$;
