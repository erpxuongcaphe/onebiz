-- ============================================================
-- 00260: Consistent financial analysis details
-- ============================================================
-- Read-only report function. It does not insert, update or delete business data.
-- COGS breakdown, gross-margin trend, inventory turnover and DSO now use the
-- same date range, branch scope and internal-sale treatment.

create or replace function public.get_financial_analysis_details_report(
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_branch_id uuid default null,
  p_exclude_internal boolean default false,
  p_limit integer default 10
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_exclude_internal boolean := coalesce(p_exclude_internal, false) and p_branch_id is null;
  v_granularity text;
  v_step interval;
  v_days numeric;
  v_pnl jsonb;
  v_current jsonb;
  v_goods_revenue numeric;
  v_cogs numeric;
  v_opening_value numeric := 0;
  v_closing_value numeric := 0;
  v_average_inventory numeric := 0;
  v_turnover numeric := 0;
  v_receivables numeric := 0;
  v_average_daily_revenue numeric := 0;
begin
  if p_date_from is null or p_date_to is null or p_date_from >= p_date_to then
    raise exception using errcode = '22007', message = 'REPORT_DATE_RANGE_INVALID';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 50000 then
    raise exception using errcode = '22023', message = 'REPORT_LIMIT_INVALID';
  end if;

  perform public.assert_report_access('reports.analytics', p_branch_id);
  perform public.assert_report_access('reports.view_detail', p_branch_id);

  select p.tenant_id
    into v_tenant_id
    from public.profiles p
   where p.id = auth.uid()
     and coalesce(p.is_active, true);

  if v_tenant_id is null then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;

  if p_date_to - p_date_from <= interval '45 days' then
    v_granularity := 'day';
    v_step := interval '1 day';
  elsif p_date_to - p_date_from <= interval '550 days' then
    v_granularity := 'month';
    v_step := interval '1 month';
  else
    v_granularity := 'year';
    v_step := interval '1 year';
  end if;

  v_days := greatest(
    1,
    ceil(extract(epoch from (p_date_to - p_date_from)) / 86400)
  );

  if v_exclude_internal then
    v_pnl := public.get_consolidated_profit_and_loss_report(
      p_date_from, p_date_to, p_date_from, p_date_to
    );
  else
    v_pnl := public.get_profit_and_loss_report(
      p_date_from, p_date_to, p_date_from, p_date_to, p_branch_id
    );
  end if;

  v_current := v_pnl->'current';
  v_goods_revenue :=
    coalesce((v_current->>'revenue')::numeric, 0)
    - coalesce((v_current->>'delivery_fee')::numeric, 0);
  v_cogs := coalesce((v_current->>'cogs')::numeric, 0);

  select
    coalesce(sum(x.opening_qty * x.cost_price), 0),
    coalesce(sum(x.closing_qty * x.cost_price), 0)
    into v_opening_value, v_closing_value
  from public.get_xnt_report(p_date_from, p_date_to, p_branch_id, null) x;

  v_average_inventory := (v_opening_value + v_closing_value) / 2;
  v_turnover := case
    when v_average_inventory > 0 then round(v_cogs / v_average_inventory, 2)
    else 0
  end;

  select coalesce(sum(greatest(i.debt, 0)), 0)
    into v_receivables
    from public.invoices i
   where i.tenant_id = v_tenant_id
     and i.status = 'completed'
     and coalesce(i.debt, 0) > 0
     and (p_branch_id is null or i.branch_id = p_branch_id)
     and (not v_exclude_internal or coalesce(i.source, '') <> 'internal');

  v_average_daily_revenue := v_goods_revenue / v_days;

  return (
    with scoped_invoices as (
      select
        i.id,
        i.created_at,
        i.total,
        coalesce(i.delivery_fee, 0) as delivery_fee
      from public.invoices i
      where i.tenant_id = v_tenant_id
        and i.status = 'completed'
        and i.created_at >= p_date_from
        and i.created_at < p_date_to
        and (p_branch_id is null or i.branch_id = p_branch_id)
        and (not v_exclude_internal or coalesce(i.source, '') <> 'internal')
    ),
    invoice_lines as (
      select
        si.created_at,
        coalesce(ii.product_id::text, 'name:' || md5(coalesce(ii.product_name, ''))) as product_key,
        coalesce(nullif(trim(ii.product_name), ''), pr.name, 'Sản phẩm') as product_name,
        coalesce(ii.quantity, 0)::numeric as quantity,
        coalesce(ii.unit_cost, pr.cost_price, 0)::numeric as unit_cost
      from scoped_invoices si
      join public.invoice_items ii on ii.invoice_id = si.id
      left join public.products pr on pr.id = ii.product_id
    ),
    scoped_returns as (
      select sr.id, sr.invoice_id, sr.created_at, sr.total
      from public.sales_returns sr
      join public.invoices source_invoice
        on source_invoice.id = sr.invoice_id
       and source_invoice.tenant_id = v_tenant_id
      where sr.tenant_id = v_tenant_id
        and sr.status in ('confirmed', 'completed')
        and sr.created_at >= p_date_from
        and sr.created_at < p_date_to
        and (p_branch_id is null or sr.branch_id = p_branch_id)
        and (not v_exclude_internal or coalesce(source_invoice.source, '') <> 'internal')
    ),
    return_lines as (
      select
        sr.created_at,
        coalesce(ri.product_id::text, 'name:' || md5(coalesce(pr.name, ''))) as product_key,
        coalesce(pr.name, 'Sản phẩm') as product_name,
        coalesce(ri.quantity, 0)::numeric as quantity,
        coalesce(source_cost.unit_cost, pr.cost_price, 0)::numeric as unit_cost
      from scoped_returns sr
      join public.return_items ri on ri.return_id = sr.id
      left join lateral (
        select ii.unit_cost
        from public.invoice_items ii
        where ii.invoice_id = sr.invoice_id
          and ii.product_id = ri.product_id
        order by ii.id
        limit 1
      ) source_cost on true
      left join public.products pr on pr.id = ri.product_id
    ),
    product_events as (
      select product_key, product_name, quantity, quantity * unit_cost as cost
      from invoice_lines
      union all
      select product_key, product_name, -quantity, -(quantity * unit_cost)
      from return_lines
    ),
    product_totals as (
      select
        product_key,
        max(product_name) as product_name,
        sum(quantity)::numeric as quantity,
        sum(cost)::numeric as total_cost
      from product_events
      group by product_key
    ),
    product_ranked as (
      select
        pt.*,
        sum(pt.total_cost) over () as all_product_cost
      from product_totals pt
      where pt.quantity <> 0 or pt.total_cost <> 0
    ),
    cogs_breakdown as (
      select *
      from product_ranked
      order by total_cost desc, product_name
      limit p_limit
    ),
    buckets as (
      select generate_series(
        date_trunc(v_granularity, p_date_from),
        p_date_to - interval '1 microsecond',
        v_step
      ) as bucket_start
    ),
    revenue_events as (
      select
        date_trunc(v_granularity, si.created_at) as bucket_start,
        (si.total - si.delivery_fee)::numeric as revenue
      from scoped_invoices si
      union all
      select
        date_trunc(v_granularity, sr.created_at) as bucket_start,
        -sr.total::numeric as revenue
      from scoped_returns sr
    ),
    cost_events as (
      select
        date_trunc(v_granularity, il.created_at) as bucket_start,
        (il.quantity * il.unit_cost)::numeric as cogs
      from invoice_lines il
      union all
      select
        date_trunc(v_granularity, rl.created_at) as bucket_start,
        -(rl.quantity * rl.unit_cost)::numeric as cogs
      from return_lines rl
    ),
    revenue_by_bucket as (
      select bucket_start, sum(revenue)::numeric as revenue
      from revenue_events
      group by bucket_start
    ),
    cost_by_bucket as (
      select bucket_start, sum(cogs)::numeric as cogs
      from cost_events
      group by bucket_start
    ),
    trend as (
      select
        b.bucket_start,
        coalesce(r.revenue, 0)::numeric as revenue,
        coalesce(c.cogs, 0)::numeric as cogs
      from buckets b
      left join revenue_by_bucket r using (bucket_start)
      left join cost_by_bucket c using (bucket_start)
      order by b.bucket_start
    )
    select jsonb_build_object(
      'granularity', v_granularity,
      'exclude_internal', v_exclude_internal,
      'cogs_total_count', (select count(*) from product_ranked),
      'cogs_breakdown', coalesce((
        select jsonb_agg(jsonb_build_object(
          'product_name', cb.product_name,
          'quantity', cb.quantity,
          'average_unit_cost', case
            when cb.quantity <> 0 then cb.total_cost / cb.quantity
            else 0
          end,
          'total_cost', cb.total_cost,
          'pct_of_cogs', case
            when cb.all_product_cost <> 0
              then round(cb.total_cost / cb.all_product_cost * 100, 1)
            else 0
          end
        ) order by cb.total_cost desc, cb.product_name)
        from cogs_breakdown cb
      ), '[]'::jsonb),
      'margin_trend', coalesce((
        select jsonb_agg(jsonb_build_object(
          'bucket_start', t.bucket_start,
          'revenue', t.revenue,
          'cogs', t.cogs,
          'gross_margin', case
            when t.revenue <> 0
              then round((t.revenue - t.cogs) / t.revenue * 100, 1)
            else 0
          end
        ) order by t.bucket_start)
        from trend t
      ), '[]'::jsonb),
      'turnover', jsonb_build_object(
        'turnover_ratio', v_turnover,
        'average_days_to_sell', case
          when v_turnover > 0 then round(v_days / v_turnover)
          else 0
        end,
        'cogs_period', v_cogs,
        'opening_inventory_value', v_opening_value,
        'closing_inventory_value', v_closing_value,
        'average_inventory_value', v_average_inventory,
        'period_days', v_days
      ),
      'dso', jsonb_build_object(
        'days', case
          when v_average_daily_revenue > 0
            then round(v_receivables / v_average_daily_revenue)
          else 0
        end,
        'receivables', v_receivables,
        'average_daily_revenue', v_average_daily_revenue,
        'receivables_as_of', now(),
        'period_days', v_days
      )
    )
  );
end;
$$;

revoke all on function public.get_financial_analysis_details_report(
  timestamptz, timestamptz, uuid, boolean, integer
) from public, anon;

grant execute on function public.get_financial_analysis_details_report(
  timestamptz, timestamptz, uuid, boolean, integer
) to authenticated;

comment on function public.get_financial_analysis_details_report(
  timestamptz, timestamptz, uuid, boolean, integer
) is 'Read-only COGS, gross-margin trend, inventory turnover and DSO using one scope.';

select to_regprocedure(
  'public.get_financial_analysis_details_report(timestamptz,timestamptz,uuid,boolean,integer)'
) is not null as financial_analysis_details_ok;
