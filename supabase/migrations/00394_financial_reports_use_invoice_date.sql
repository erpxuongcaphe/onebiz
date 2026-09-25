-- 00394: Align financial report dates and expose a compact sales/returns bridge.
-- Sales use invoices.issued_at; sales returns remain on sales_returns.created_at.
-- The reconciliation payload explains how gross sales and returned amounts
-- net to the existing P&L totals. This changes report functions only and
-- snapshots the prior definitions for an exact rollback; it never edits data.

begin;

create function pg_temp.count_00394(p_text text, p_fragment text)
returns integer
language sql immutable
as $fn$
  select (length(p_text) - length(replace(p_text, p_fragment, ''))) / length(p_fragment)
$fn$;

do $guard$
declare
  v_count integer;
  v_definition text;
  v_details_oid oid;
  v_consolidated_oid oid;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'invoices'
      and column_name = 'issued_at'
  ) then
    raise exception '00394: invoices.issued_at is missing; run 00335/00339 first';
  end if;

  if to_regclass('public.rpc_backup_ngay_hoa_don') is null then
    raise exception '00394: missing report-function backup table from 00339';
  end if;

  v_details_oid := to_regprocedure(
    'public.get_financial_analysis_details_report(timestamptz,timestamptz,uuid,boolean,integer)'
  );
  v_consolidated_oid := to_regprocedure(
    'public.get_consolidated_profit_and_loss_report(timestamptz,timestamptz,timestamptz,timestamptz)'
  );
  select count(*) into v_count
  from pg_proc p
  where p.oid in (v_details_oid, v_consolidated_oid);
  if v_count <> 2 then
    raise exception '00394: expected 2 target report functions, found %', v_count;
  end if;

  select pg_get_functiondef(p.oid) into v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.oid = to_regprocedure(
      'public.get_profit_and_loss_report(timestamptz,timestamptz,timestamptz,timestamptz,uuid)'
    );
  if v_definition is null or v_definition not like '%ISSUED_AT_00335%' then
    raise exception '00394: base P&L is not using the 00339 issued_at definition';
  end if;
end;
$guard$;

-- Snapshot exactly once so the matching rollback can restore the prior source.
insert into public.rpc_backup_ngay_hoa_don (migration, ham_oid, chu_ky, def_truoc)
select '00394', p.oid, p.oid::regprocedure::text, pg_get_functiondef(p.oid)
from pg_proc p
where p.oid in (
  to_regprocedure(
    'public.get_financial_analysis_details_report(timestamptz,timestamptz,uuid,boolean,integer)'
  ),
  to_regprocedure(
    'public.get_consolidated_profit_and_loss_report(timestamptz,timestamptz,timestamptz,timestamptz)'
  )
)
on conflict (migration, ham_oid) do nothing;

do $patch$
declare
  v_oid regprocedure;
  v_definition text;
  v_count integer;
begin
  -- The detailed trend and product-cost breakdown must bucket sales by the
  -- same invoice date as P&L. Keep the created_at alias for downstream CTEs;
  -- returns intentionally continue to use their transaction created_at.
  v_oid := to_regprocedure(
    'public.get_financial_analysis_details_report(timestamptz,timestamptz,uuid,boolean,integer)'
  );
  v_definition := pg_get_functiondef(v_oid::oid);

  if v_definition not like '%ISSUED_AT_REPORT_00394%' then
    if pg_temp.count_00394(
         v_definition,
         $scoped_invoice_select$
      select
        i.id,
        i.created_at,
        i.total,
        coalesce(i.delivery_fee, 0) as delivery_fee
      from public.invoices i
$scoped_invoice_select$
       ) <> 1
       or pg_temp.count_00394(v_definition, 'and i.created_at >= p_date_from') <> 1
       or pg_temp.count_00394(v_definition, 'and i.created_at < p_date_to') <> 1
       or pg_temp.count_00394(v_definition, 'declare') <> 1 then
      raise exception '00394: financial-analysis function differs from reviewed shape; stopped';
    end if;

    v_definition := replace(
      v_definition,
      $old_scoped_invoice_select$
      select
        i.id,
        i.created_at,
        i.total,
        coalesce(i.delivery_fee, 0) as delivery_fee
      from public.invoices i
$old_scoped_invoice_select$,
      $new_scoped_invoice_select$
      select
        i.id,
        i.issued_at as created_at,
        i.total,
        coalesce(i.delivery_fee, 0) as delivery_fee
      from public.invoices i
$new_scoped_invoice_select$
    );
    v_definition := replace(v_definition, 'and i.created_at >= p_date_from', 'and i.issued_at >= p_date_from');
    v_definition := replace(v_definition, 'and i.created_at < p_date_to', 'and i.issued_at < p_date_to');
    v_definition := replace(v_definition, 'declare', 'declare -- ISSUED_AT_REPORT_00394');
    execute v_definition;
  end if;

  v_definition := pg_get_functiondef(v_oid::oid);
  if position('''reconciliation'', jsonb_build_object(' in v_definition) = 0 then
    if pg_temp.count_00394(
         v_definition,
         $needle$'cogs_total_count', (select count(*) from product_ranked),$needle$
       ) <> 1 then
      raise exception '00394: financial-analysis reconciliation insertion point changed; stopped';
    end if;

    v_definition := replace(
      v_definition,
      $old$
      'cogs_total_count', (select count(*) from product_ranked),
$old$,
      $new$
      'cogs_total_count', (select count(*) from product_ranked),
      'reconciliation', jsonb_build_object(
        'invoice_count', (select count(*) from scoped_invoices),
        'invoice_total', coalesce((select sum(si.total) from scoped_invoices si), 0),
        'delivery_fee', coalesce((select sum(si.delivery_fee) from scoped_invoices si), 0),
        'return_count', (select count(*) from scoped_returns),
        'returned_total', coalesce((select sum(sr.total) from scoped_returns sr), 0),
        'sales_cogs', coalesce((select sum(il.quantity * il.unit_cost) from invoice_lines il), 0),
        'returned_cogs', coalesce((select sum(rl.quantity * rl.unit_cost) from return_lines rl), 0)
      ),
$new$
    );
    execute v_definition;
  end if;

  -- Company-consolidated P&L starts with the issued_at-based base report and
  -- must exclude internal sales using that same invoice date.
  v_oid := to_regprocedure(
    'public.get_consolidated_profit_and_loss_report(timestamptz,timestamptz,timestamptz,timestamptz)'
  );
  v_definition := pg_get_functiondef(v_oid::oid);

  if v_definition not like '%ISSUED_AT_REPORT_00394%' then
    if pg_temp.count_00394(
         v_definition,
         'on i.created_at >= p.date_from and i.created_at < p.date_to'
       ) <> 1
       or pg_temp.count_00394(v_definition, 'declare') <> 1 then
      raise exception '00394: consolidated P&L differs from reviewed shape; stopped';
    end if;

    v_definition := replace(
      v_definition,
      'on i.created_at >= p.date_from and i.created_at < p.date_to',
      'on i.issued_at >= p.date_from and i.issued_at < p.date_to'
    );
    v_definition := replace(v_definition, 'declare', 'declare -- ISSUED_AT_REPORT_00394');
    execute v_definition;
  end if;
end;
$patch$;

do $verify$
declare
  v_details text;
  v_consolidated text;
  v_backup_count integer;
begin
  select pg_get_functiondef(to_regprocedure(
    'public.get_financial_analysis_details_report(timestamptz,timestamptz,uuid,boolean,integer)'
  )) into v_details;

  select pg_get_functiondef(to_regprocedure(
    'public.get_consolidated_profit_and_loss_report(timestamptz,timestamptz,timestamptz,timestamptz)'
  )) into v_consolidated;

  select count(*) into v_backup_count
  from public.rpc_backup_ngay_hoa_don
  where migration = '00394';

  if v_details not like '%ISSUED_AT_REPORT_00394%'
     or v_details not like '%i.issued_at%'
     or v_details not like '%sr.created_at%'
     or position('reconciliation' in v_details) = 0
     or position('returned_cogs' in v_details) = 0
     or v_consolidated not like '%ISSUED_AT_REPORT_00394%'
     or v_consolidated not like '%i.issued_at%'
     or v_backup_count <> 2 then
    raise exception '00394: post-patch verification failed (backup rows=%)', v_backup_count;
  end if;
end;
$verify$;

select
  (pg_get_functiondef(to_regprocedure(
    'public.get_financial_analysis_details_report(timestamptz,timestamptz,uuid,boolean,integer)'
  )) like '%ISSUED_AT_REPORT_00394%') as detail_report_uses_invoice_date,
  (pg_get_functiondef(to_regprocedure(
    'public.get_consolidated_profit_and_loss_report(timestamptz,timestamptz,timestamptz,timestamptz)'
  )) like '%ISSUED_AT_REPORT_00394%') as consolidated_pnl_uses_invoice_date,
  (select count(*) = 2 from public.rpc_backup_ngay_hoa_don where migration = '00394') as rollback_snapshot_ok;

commit;
