-- 00406: Profit/loss COGS must use immutable sale-time snapshots only.
--
-- This migration is read-only with respect to business rows. It introduces
-- new report RPCs so the current website remains compatible until the UI is
-- deployed with explicit incomplete-cost handling.

begin;

create or replace function public.resolve_sales_return_source_line(
  p_return_item_id uuid
) returns table (
  invoice_item_id uuid,
  unit_cost numeric,
  resolution text
)
language sql
stable
security definer
set search_path = ''
as $$
  with target as (
    select ri.id, ri.invoice_item_id as exact_invoice_item_id,
           ri.product_id, ri.product_name, ri.unit_price, sr.invoice_id
      from public.return_items ri
      join public.sales_returns sr on sr.id = ri.return_id
     where ri.id = p_return_item_id
  ),
  candidates as (
    select ii.id, ii.unit_cost, 1 as priority, 'exact_id'::text as resolution
      from target t
      join public.invoice_items ii
        on ii.id = t.exact_invoice_item_id
       and ii.invoice_id = t.invoice_id

    union all

    select ii.id, ii.unit_cost, 2, 'name_and_price'
      from target t
      join public.invoice_items ii
        on ii.invoice_id = t.invoice_id
       and ii.product_id = t.product_id
       and ii.product_name = t.product_name
       and abs(ii.total / nullif(ii.quantity, 0) - t.unit_price) < 0.01
     where t.exact_invoice_item_id is null
       and 1 = (
         select count(*)
           from public.invoice_items match_line
          where match_line.invoice_id = t.invoice_id
            and match_line.product_id = t.product_id
            and match_line.product_name = t.product_name
            and abs(
              match_line.total / nullif(match_line.quantity, 0) - t.unit_price
            ) < 0.01
       )

    union all

    select ii.id, ii.unit_cost, 3, 'single_product_line'
      from target t
      join public.invoice_items ii
        on ii.invoice_id = t.invoice_id
       and ii.product_id = t.product_id
     where t.exact_invoice_item_id is null
       and 1 = (
         select count(*)
           from public.invoice_items product_line
          where product_line.invoice_id = t.invoice_id
            and product_line.product_id = t.product_id
       )
  )
  select c.id, c.unit_cost, c.resolution
    from candidates c
   order by c.priority
   limit 1;
$$;

revoke all on function public.resolve_sales_return_source_line(uuid)
  from public, anon, authenticated;

comment on function public.resolve_sales_return_source_line(uuid) is
  'Internal read-only resolver: exact FK first; legacy rows only when one source line is uniquely identifiable.';

create or replace function public.get_profit_and_loss_report_v2(
  p_current_from timestamptz,
  p_current_to timestamptz,
  p_previous_from timestamptz,
  p_previous_to timestamptz,
  p_branch_id uuid default null,
  p_exclude_internal boolean default false
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_exclude_internal boolean := coalesce(p_exclude_internal, false)
    and p_branch_id is null;
begin
  if p_current_from is null or p_current_to is null
    or p_previous_from is null or p_previous_to is null
    or p_current_from >= p_current_to
    or p_previous_from >= p_previous_to then
    raise exception using errcode = '22007', message = 'REPORT_DATE_RANGE_INVALID';
  end if;

  perform public.assert_report_access('reports.analytics', p_branch_id);
  perform public.assert_report_access('reports.view_detail', p_branch_id);

  select p.tenant_id into v_tenant_id
    from public.profiles p
   where p.id = auth.uid() and coalesce(p.is_active, true);

  if v_tenant_id is null then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;

  return (
    with periods as (
      select * from (values
        ('current'::text, p_current_from, p_current_to),
        ('previous'::text, p_previous_from, p_previous_to)
      ) p(period, date_from, date_to)
    ),
    scoped_invoices as (
      select p.period, i.id, i.total,
             coalesce(i.delivery_fee, 0) as delivery_fee
        from periods p
        join public.invoices i
          on coalesce(i.issued_at, i.created_at) >= p.date_from
         and coalesce(i.issued_at, i.created_at) < p.date_to
       where i.tenant_id = v_tenant_id
         and i.status = 'completed'
         and (p_branch_id is null or i.branch_id = p_branch_id)
         and (not v_exclude_internal or coalesce(i.source, '') <> 'internal')
    ),
    invoice_totals as (
      select period, count(*) as invoice_count,
             coalesce(sum(total), 0) as revenue,
             coalesce(sum(delivery_fee), 0) as delivery_fee
        from scoped_invoices
       group by period
    ),
    sales_cost_totals as (
      select si.period,
             coalesce(sum(ii.quantity * ii.unit_cost)
               filter (where ii.unit_cost is not null), 0) as sales_cogs,
             count(*) filter (where ii.unit_cost is not null) as snapshot_lines,
             count(*) filter (where ii.unit_cost is null) as missing_cost_lines
        from scoped_invoices si
        join public.invoice_items ii on ii.invoice_id = si.id
       group by si.period
    ),
    scoped_returns as (
      select p.period, sr.id, sr.invoice_id, sr.total
        from periods p
        join public.sales_returns sr
          on sr.created_at >= p.date_from and sr.created_at < p.date_to
        join public.invoices source_invoice
          on source_invoice.id = sr.invoice_id
         and source_invoice.tenant_id = v_tenant_id
       where sr.tenant_id = v_tenant_id
         and sr.status in ('confirmed', 'completed')
         and (p_branch_id is null or sr.branch_id = p_branch_id)
         and (not v_exclude_internal
           or coalesce(source_invoice.source, '') <> 'internal')
    ),
    return_totals as (
      select period, count(*) as return_count,
             coalesce(sum(total), 0) as returned
        from scoped_returns
       group by period
    ),
    return_cost_lines as (
      select sr.period, ri.quantity, source_line.unit_cost,
             source_line.resolution
        from scoped_returns sr
        join public.return_items ri on ri.return_id = sr.id
        left join lateral public.resolve_sales_return_source_line(ri.id)
          source_line on true
    ),
    return_cost_totals as (
      select period,
             coalesce(sum(quantity * unit_cost)
               filter (where unit_cost is not null), 0) as returned_cogs,
             count(*) filter (where unit_cost is not null) as snapshot_lines,
             count(*) filter (where unit_cost is null) as missing_cost_lines
        from return_cost_lines
       group by period
    ),
    internal_revenue_totals as (
      select p.period,
             coalesce((
               select sum(i.total)
                 from public.invoices i
                where v_exclude_internal
                  and i.tenant_id = v_tenant_id
                  and i.status = 'completed'
                  and i.source = 'internal'
                  and coalesce(i.issued_at, i.created_at) >= p.date_from
                  and coalesce(i.issued_at, i.created_at) < p.date_to
             ), 0) - coalesce((
               select sum(sr.total)
                 from public.sales_returns sr
                 join public.invoices i on i.id = sr.invoice_id
                where v_exclude_internal
                  and sr.tenant_id = v_tenant_id
                  and sr.status in ('confirmed', 'completed')
                  and i.source = 'internal'
                  and sr.created_at >= p.date_from
                  and sr.created_at < p.date_to
             ), 0) as internal_revenue
        from periods p
    ),
    expense_totals as (
      select p.period, coalesce(sum(ct.amount), 0) as operating_expense
        from periods p
        join public.cash_transactions ct
          on ct.created_at >= p.date_from and ct.created_at < p.date_to
       where ct.tenant_id = v_tenant_id
         and ct.type = 'payment'
         and coalesce(ct.status, 'completed') = 'completed'
         and coalesce(ct.category, '') <> all(array[
           'Nhập hàng', 'Mua hàng nội bộ', 'Hoàn tiền hủy đơn',
           'Hoàn trả', 'Trả hàng', 'Trả nhà cung cấp', 'supplier_payment'
         ])
         and (p_branch_id is null or ct.branch_id = p_branch_id)
       group by p.period
    ),
    summary as (
      select p.period,
             coalesce(i.invoice_count, 0) as invoice_count,
             coalesce(i.revenue, 0) - coalesce(r.returned, 0) as revenue,
             coalesce(i.delivery_fee, 0) as delivery_fee,
             coalesce(r.return_count, 0) as return_count,
             coalesce(r.returned, 0) as returned_total,
             coalesce(sc.sales_cogs, 0) as sales_cogs,
             coalesce(rc.returned_cogs, 0) as returned_cogs,
             case
               when coalesce(sc.missing_cost_lines, 0)
                    + coalesce(rc.missing_cost_lines, 0) = 0
               then coalesce(sc.sales_cogs, 0) - coalesce(rc.returned_cogs, 0)
               else null
             end as cogs,
             coalesce(e.operating_expense, 0) as operating_expense,
             coalesce(sc.snapshot_lines, 0)
               + coalesce(rc.snapshot_lines, 0) as snapshot_lines,
             coalesce(sc.missing_cost_lines, 0) as missing_sales_cost_lines,
             coalesce(rc.missing_cost_lines, 0) as missing_return_cost_lines,
             coalesce(sc.missing_cost_lines, 0)
               + coalesce(rc.missing_cost_lines, 0) = 0 as cogs_complete,
             coalesce(ir.internal_revenue, 0) as internal_revenue
        from periods p
        left join invoice_totals i using (period)
        left join sales_cost_totals sc using (period)
        left join return_totals r using (period)
        left join return_cost_totals rc using (period)
        left join internal_revenue_totals ir using (period)
        left join expense_totals e using (period)
    )
    select jsonb_build_object(
      'current', (select to_jsonb(s) - 'period' from summary s where period = 'current'),
      'previous', (select to_jsonb(s) - 'period' from summary s where period = 'previous'),
      'exclude_internal', v_exclude_internal
    )
  );
end;
$$;

revoke all on function public.get_profit_and_loss_report_v2(
  timestamptz, timestamptz, timestamptz, timestamptz, uuid, boolean
) from public, anon;

grant execute on function public.get_profit_and_loss_report_v2(
  timestamptz, timestamptz, timestamptz, timestamptz, uuid, boolean
) to authenticated;

comment on function public.get_profit_and_loss_report_v2(
  timestamptz, timestamptz, timestamptz, timestamptz, uuid, boolean
) is
  'Read-only P&L. COGS is NULL when any sale or return line lacks an immutable source-cost snapshot.';

create or replace function public.get_branch_profit_and_loss_report_v2(
  p_date_from timestamptz,
  p_date_to timestamptz
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_branch record;
  v_payload jsonb;
  v_row jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_goods_revenue numeric;
  v_known_cogs numeric;
  v_cogs_complete boolean;
  v_operating_expense numeric;
begin
  if p_date_from is null or p_date_to is null or p_date_from >= p_date_to then
    raise exception using errcode = '22007', message = 'REPORT_DATE_RANGE_INVALID';
  end if;

  perform public.assert_report_access('reports.analytics', null);
  perform public.assert_report_access('reports.view_detail', null);

  select p.tenant_id into v_tenant_id
    from public.profiles p
   where p.id = auth.uid() and coalesce(p.is_active, true);

  if v_tenant_id is null then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;

  for v_branch in
    select b.id, b.name, coalesce(b.branch_type, 'store') as branch_type
      from public.branches b
     where b.tenant_id = v_tenant_id and b.is_active
     order by b.name, b.id
  loop
    v_payload := public.get_profit_and_loss_report_v2(
      p_date_from, p_date_to, p_date_from, p_date_to, v_branch.id, false
    );
    v_row := v_payload->'current';
    v_goods_revenue := coalesce((v_row->>'revenue')::numeric, 0)
      - coalesce((v_row->>'delivery_fee')::numeric, 0);
    v_known_cogs := coalesce((v_row->>'sales_cogs')::numeric, 0)
      - coalesce((v_row->>'returned_cogs')::numeric, 0);
    v_cogs_complete := coalesce((v_row->>'cogs_complete')::boolean, false);
    v_operating_expense := coalesce((v_row->>'operating_expense')::numeric, 0);

    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'branch_id', v_branch.id,
      'branch_name', v_branch.name,
      'branch_type', v_branch.branch_type,
      'total_revenue', coalesce((v_row->>'revenue')::numeric, 0),
      'delivery_fee', coalesce((v_row->>'delivery_fee')::numeric, 0),
      'goods_revenue', v_goods_revenue,
      'cogs', case when v_cogs_complete then v_known_cogs else null end,
      'known_cogs', v_known_cogs,
      'gross_profit', case when v_cogs_complete then v_goods_revenue - v_known_cogs else null end,
      'gross_margin', case
        when v_cogs_complete and v_goods_revenue <> 0
          then round((v_goods_revenue - v_known_cogs) * 100 / v_goods_revenue, 1)
        when v_cogs_complete then 0
        else null
      end,
      'operating_expense', v_operating_expense,
      'operating_result', case
        when v_cogs_complete
          then v_goods_revenue - v_known_cogs - v_operating_expense
        else null
      end,
      'operating_margin', case
        when v_cogs_complete and v_goods_revenue <> 0
          then round(
            (v_goods_revenue - v_known_cogs - v_operating_expense)
              * 100 / v_goods_revenue,
            1
          )
        when v_cogs_complete then 0
        else null
      end,
      'cogs_complete', v_cogs_complete,
      'snapshot_lines', coalesce((v_row->>'snapshot_lines')::integer, 0),
      'missing_cost_lines',
        coalesce((v_row->>'missing_sales_cost_lines')::integer, 0)
        + coalesce((v_row->>'missing_return_cost_lines')::integer, 0)
    ));
  end loop;

  return jsonb_build_object('rows', v_rows);
end;
$$;

revoke all on function public.get_branch_profit_and_loss_report_v2(
  timestamptz, timestamptz
) from public, anon;

grant execute on function public.get_branch_profit_and_loss_report_v2(
  timestamptz, timestamptz
) to authenticated;

comment on function public.get_branch_profit_and_loss_report_v2(
  timestamptz, timestamptz
) is 'Read-only branch P&L comparison with explicit COGS completeness.';

create or replace function public.get_financial_analysis_details_report_v2(
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
  v_exclude_internal boolean := coalesce(p_exclude_internal, false)
    and p_branch_id is null;
  v_granularity text;
  v_step interval;
  v_days numeric;
  v_pnl jsonb;
  v_current jsonb;
  v_goods_revenue numeric;
  v_cogs numeric;
  v_cogs_complete boolean;
  v_opening_value numeric;
  v_closing_value numeric;
  v_inventory_complete boolean;
  v_average_inventory numeric;
  v_turnover numeric;
  v_receivables numeric;
  v_average_daily_revenue numeric;
begin
  if p_date_from is null or p_date_to is null or p_date_from >= p_date_to then
    raise exception using errcode = '22007', message = 'REPORT_DATE_RANGE_INVALID';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 50000 then
    raise exception using errcode = '22023', message = 'REPORT_LIMIT_INVALID';
  end if;

  perform public.assert_report_access('reports.analytics', p_branch_id);
  perform public.assert_report_access('reports.view_detail', p_branch_id);
  select p.tenant_id into v_tenant_id
    from public.profiles p
   where p.id = auth.uid() and coalesce(p.is_active, true);
  if v_tenant_id is null then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;

  if p_date_to - p_date_from <= interval '45 days' then
    v_granularity := 'day'; v_step := interval '1 day';
  elsif p_date_to - p_date_from <= interval '550 days' then
    v_granularity := 'month'; v_step := interval '1 month';
  else
    v_granularity := 'year'; v_step := interval '1 year';
  end if;
  v_days := greatest(1, ceil(extract(epoch from (p_date_to - p_date_from)) / 86400));

  v_pnl := public.get_profit_and_loss_report_v2(
    p_date_from, p_date_to, p_date_from, p_date_to,
    p_branch_id, v_exclude_internal
  );
  v_current := v_pnl->'current';
  v_goods_revenue := coalesce((v_current->>'revenue')::numeric, 0)
    - coalesce((v_current->>'delivery_fee')::numeric, 0);
  v_cogs_complete := coalesce((v_current->>'cogs_complete')::boolean, false);
  v_cogs := case when v_cogs_complete then (v_current->>'cogs')::numeric else null end;

  select aggregate.inventory_complete,
         case when aggregate.inventory_complete then aggregate.opening_value else null end,
         case when aggregate.inventory_complete then aggregate.closing_value else null end
    into v_inventory_complete, v_opening_value, v_closing_value
    from (
      select coalesce(bool_and(x.valuation_complete), true) as inventory_complete,
             coalesce(sum(x.opening_value), 0) as opening_value,
             coalesce(sum(x.closing_value), 0) as closing_value
        from public.get_xnt_report_v2(
          p_date_from, p_date_to, p_branch_id, null
        ) x
    ) aggregate;
  v_average_inventory := case when v_inventory_complete
    then (v_opening_value + v_closing_value) / 2 else null end;
  v_turnover := case
    when v_cogs_complete and v_inventory_complete and v_average_inventory > 0
      then round(v_cogs / v_average_inventory, 2)
    else null
  end;

  select coalesce(sum(greatest(i.debt, 0)), 0)
    into v_receivables
    from public.invoices i
   where i.tenant_id = v_tenant_id and i.status = 'completed'
     and coalesce(i.debt, 0) > 0
     and (p_branch_id is null or i.branch_id = p_branch_id)
     and (not v_exclude_internal or coalesce(i.source, '') <> 'internal');
  v_average_daily_revenue := v_goods_revenue / v_days;

  return (
    with scoped_invoices as (
      select i.id, coalesce(i.issued_at, i.created_at) as event_at,
             i.total, coalesce(i.delivery_fee, 0) as delivery_fee
        from public.invoices i
       where i.tenant_id = v_tenant_id and i.status = 'completed'
         and coalesce(i.issued_at, i.created_at) >= p_date_from
         and coalesce(i.issued_at, i.created_at) < p_date_to
         and (p_branch_id is null or i.branch_id = p_branch_id)
         and (not v_exclude_internal or coalesce(i.source, '') <> 'internal')
    ),
    invoice_lines as (
      select si.event_at,
             coalesce(ii.product_id::text, 'name:' || md5(coalesce(ii.product_name, ''))) as product_key,
             coalesce(nullif(trim(ii.product_name), ''), 'Sản phẩm') as product_name,
             coalesce(ii.quantity, 0)::numeric as quantity,
             ii.unit_cost
        from scoped_invoices si
        join public.invoice_items ii on ii.invoice_id = si.id
    ),
    scoped_returns as (
      select sr.id, sr.created_at as event_at, sr.total
        from public.sales_returns sr
        join public.invoices source_invoice
          on source_invoice.id = sr.invoice_id
         and source_invoice.tenant_id = v_tenant_id
       where sr.tenant_id = v_tenant_id
         and sr.status in ('confirmed', 'completed')
         and sr.created_at >= p_date_from and sr.created_at < p_date_to
         and (p_branch_id is null or sr.branch_id = p_branch_id)
         and (not v_exclude_internal or coalesce(source_invoice.source, '') <> 'internal')
    ),
    return_lines as (
      select sr.event_at,
             coalesce(ri.product_id::text, 'name:' || md5(coalesce(ri.product_name, ''))) as product_key,
             coalesce(nullif(trim(ri.product_name), ''), 'Sản phẩm') as product_name,
             coalesce(ri.quantity, 0)::numeric as quantity,
             source_line.unit_cost
        from scoped_returns sr
        join public.return_items ri on ri.return_id = sr.id
        left join lateral public.resolve_sales_return_source_line(ri.id)
          source_line on true
    ),
    product_events as (
      select product_key, product_name, quantity,
             quantity * unit_cost as known_cost,
             (unit_cost is null)::integer as missing_cost
        from invoice_lines
      union all
      select product_key, product_name, -quantity,
             -(quantity * unit_cost),
             (unit_cost is null)::integer
        from return_lines
    ),
    product_totals as (
      select product_key, max(product_name) as product_name,
             sum(quantity)::numeric as quantity,
             coalesce(sum(known_cost), 0)::numeric as known_total_cost,
             sum(missing_cost)::integer as missing_cost_lines
        from product_events
       group by product_key
    ),
    product_ranked as (
      select pt.*,
             sum(known_total_cost) filter (where missing_cost_lines = 0) over ()
               as complete_product_cost
        from product_totals pt
       where pt.quantity <> 0 or pt.known_total_cost <> 0 or pt.missing_cost_lines > 0
    ),
    cogs_breakdown as (
      select * from product_ranked
       order by missing_cost_lines > 0, known_total_cost desc, product_name
       limit p_limit
    ),
    buckets as (
      select generate_series(
        date_trunc(v_granularity, p_date_from),
        p_date_to - interval '1 microsecond', v_step
      ) as bucket_start
    ),
    revenue_events as (
      select date_trunc(v_granularity, si.event_at) as bucket_start,
             (si.total - si.delivery_fee)::numeric as revenue
        from scoped_invoices si
      union all
      select date_trunc(v_granularity, sr.event_at), -sr.total::numeric
        from scoped_returns sr
    ),
    cost_events as (
      select date_trunc(v_granularity, il.event_at) as bucket_start,
             il.quantity * il.unit_cost as cost,
             (il.unit_cost is null)::integer as missing_cost
        from invoice_lines il
      union all
      select date_trunc(v_granularity, rl.event_at),
             -(rl.quantity * rl.unit_cost),
             (rl.unit_cost is null)::integer
        from return_lines rl
    ),
    revenue_by_bucket as (
      select bucket_start, sum(revenue)::numeric as revenue
        from revenue_events group by bucket_start
    ),
    cost_by_bucket as (
      select bucket_start, coalesce(sum(cost), 0)::numeric as known_cogs,
             sum(missing_cost)::integer as missing_cost_lines
        from cost_events group by bucket_start
    ),
    trend as (
      select b.bucket_start, coalesce(r.revenue, 0)::numeric as revenue,
             coalesce(c.known_cogs, 0)::numeric as known_cogs,
             coalesce(c.missing_cost_lines, 0)::integer as missing_cost_lines
        from buckets b
        left join revenue_by_bucket r using (bucket_start)
        left join cost_by_bucket c using (bucket_start)
       order by b.bucket_start
    )
    select jsonb_build_object(
      'granularity', v_granularity,
      'exclude_internal', v_exclude_internal,
      'cogs_complete', v_cogs_complete,
      'missing_sales_cost_lines', coalesce((v_current->>'missing_sales_cost_lines')::integer, 0),
      'missing_return_cost_lines', coalesce((v_current->>'missing_return_cost_lines')::integer, 0),
      'cogs_total_count', (select count(*) from product_ranked),
      'cogs_breakdown', coalesce((select jsonb_agg(jsonb_build_object(
        'product_name', cb.product_name,
        'quantity', cb.quantity,
        'average_unit_cost', case
          when cb.missing_cost_lines = 0 and cb.quantity <> 0
            then cb.known_total_cost / cb.quantity else null end,
        'total_cost', case when cb.missing_cost_lines = 0 then cb.known_total_cost else null end,
        'known_total_cost', cb.known_total_cost,
        'missing_cost_lines', cb.missing_cost_lines,
        'cost_complete', cb.missing_cost_lines = 0,
        'pct_of_cogs', case
          when cb.missing_cost_lines = 0 and cb.complete_product_cost <> 0
            then round(cb.known_total_cost / cb.complete_product_cost * 100, 1)
          else null end
      ) order by cb.missing_cost_lines > 0, cb.known_total_cost desc, cb.product_name)
        from cogs_breakdown cb), '[]'::jsonb),
      'margin_trend', coalesce((select jsonb_agg(jsonb_build_object(
        'bucket_start', t.bucket_start,
        'revenue', t.revenue,
        'cogs', case when t.missing_cost_lines = 0 then t.known_cogs else null end,
        'known_cogs', t.known_cogs,
        'missing_cost_lines', t.missing_cost_lines,
        'cogs_complete', t.missing_cost_lines = 0,
        'gross_margin', case
          when t.missing_cost_lines = 0 and t.revenue <> 0
            then round((t.revenue - t.known_cogs) / t.revenue * 100, 1)
          when t.missing_cost_lines = 0 then 0 else null end
      ) order by t.bucket_start) from trend t), '[]'::jsonb),
      'reconciliation', jsonb_build_object(
        'invoice_count', coalesce((v_current->>'invoice_count')::integer, 0),
        'invoice_total', coalesce((v_current->>'revenue')::numeric, 0)
          + coalesce((v_current->>'returned_total')::numeric, 0),
        'delivery_fee', coalesce((v_current->>'delivery_fee')::numeric, 0),
        'return_count', coalesce((v_current->>'return_count')::integer, 0),
        'returned_total', coalesce((v_current->>'returned_total')::numeric, 0),
        'sales_cogs', coalesce((v_current->>'sales_cogs')::numeric, 0),
        'returned_cogs', coalesce((v_current->>'returned_cogs')::numeric, 0),
        'cogs_complete', v_cogs_complete,
        'missing_sales_cost_lines', coalesce((v_current->>'missing_sales_cost_lines')::integer, 0),
        'missing_return_cost_lines', coalesce((v_current->>'missing_return_cost_lines')::integer, 0)
      ),
      'turnover', jsonb_build_object(
        'turnover_ratio', v_turnover,
        'average_days_to_sell', case when v_turnover > 0 then round(v_days / v_turnover) else null end,
        'cogs_period', v_cogs,
        'opening_inventory_value', v_opening_value,
        'closing_inventory_value', v_closing_value,
        'average_inventory_value', v_average_inventory,
        'valuation_complete', v_cogs_complete and v_inventory_complete,
        'period_days', v_days
      ),
      'dso', jsonb_build_object(
        'days', case when v_average_daily_revenue > 0
          then round(v_receivables / v_average_daily_revenue) else 0 end,
        'receivables', v_receivables,
        'average_daily_revenue', v_average_daily_revenue,
        'receivables_as_of', now(), 'period_days', v_days
      )
    )
  );
end;
$$;

revoke all on function public.get_financial_analysis_details_report_v2(
  timestamptz, timestamptz, uuid, boolean, integer
) from public, anon;

grant execute on function public.get_financial_analysis_details_report_v2(
  timestamptz, timestamptz, uuid, boolean, integer
) to authenticated;

comment on function public.get_financial_analysis_details_report_v2(
  timestamptz, timestamptz, uuid, boolean, integer
) is 'Read-only COGS details, trend and turnover with explicit snapshot completeness.';

commit;
