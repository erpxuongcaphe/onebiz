-- ============================================================
-- 00198: Reporting V3 core server-side aggregates
-- ============================================================

-- One round trip for the sales dashboard. All aggregation happens in Postgres,
-- so PostgREST's row limit cannot silently truncate KPI or chart totals.
create or replace function public.get_sales_report_summary(
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_branch_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_previous_from timestamptz;
begin
  if p_date_from is null or p_date_to is null or p_date_from >= p_date_to then
    raise exception using errcode = '22007', message = 'REPORT_DATE_RANGE_INVALID';
  end if;

  perform public.assert_report_access('reports.analytics', p_branch_id);
  perform public.assert_report_access('reports.view_detail', p_branch_id);

  select p.tenant_id into v_tenant_id
  from public.profiles p
  where p.id = auth.uid() and coalesce(p.is_active, true);

  v_previous_from := p_date_from - (p_date_to - p_date_from);

  return (
    with scoped_invoices as (
      select
        i.id,
        i.code,
        i.customer_name,
        i.total,
        coalesce(i.delivery_fee, 0) as delivery_fee,
        i.created_at,
        case when i.created_at >= p_date_from then 'current' else 'previous' end as period
      from public.invoices i
      where i.tenant_id = v_tenant_id
        and i.status = 'completed'
        and i.created_at >= v_previous_from
        and i.created_at < p_date_to
        and (p_branch_id is null or i.branch_id = p_branch_id)
    ),
    invoice_totals as (
      select
        period,
        coalesce(sum(total), 0) as gross_revenue,
        coalesce(sum(delivery_fee), 0) as delivery_fee,
        count(*) as invoice_count
      from scoped_invoices
      group by period
    ),
    item_totals as (
      select
        si.period,
        coalesce(sum(ii.quantity), 0) as sold_qty
      from scoped_invoices si
      join public.invoice_items ii on ii.invoice_id = si.id
      group by si.period
    ),
    return_totals as (
      select
        case when sr.created_at >= p_date_from then 'current' else 'previous' end as period,
        count(*) as return_count,
        coalesce(sum(sr.total), 0) as return_amount
      from public.sales_returns sr
      where sr.tenant_id = v_tenant_id
        and sr.status in ('confirmed', 'completed')
        and sr.created_at >= v_previous_from
        and sr.created_at < p_date_to
        and (p_branch_id is null or sr.branch_id = p_branch_id)
      group by 1
    ),
    periods as (
      select * from (values ('current'::text), ('previous'::text)) p(period)
    ),
    summary as (
      select
        p.period,
        coalesce(it.gross_revenue, 0) as gross_revenue,
        coalesce(it.gross_revenue, 0) - coalesce(rt.return_amount, 0)
          as net_revenue,
        coalesce(it.delivery_fee, 0) as delivery_fee,
        coalesce(items.sold_qty, 0) as sold_qty,
        coalesce(it.invoice_count, 0) as invoice_count,
        coalesce(rt.return_count, 0) as return_count,
        coalesce(rt.return_amount, 0) as return_amount
      from periods p
      left join invoice_totals it using (period)
      left join item_totals items using (period)
      left join return_totals rt using (period)
    ),
    current_invoices as (
      select * from scoped_invoices where period = 'current'
    ),
    current_returns as (
      select sr.total as returned, sr.created_at
      from public.sales_returns sr
      where sr.tenant_id = v_tenant_id
        and sr.status in ('confirmed', 'completed')
        and sr.created_at >= p_date_from
        and sr.created_at < p_date_to
        and (p_branch_id is null or sr.branch_id = p_branch_id)
    ),
    daily_invoice as (
      select
        timezone('Asia/Ho_Chi_Minh', ci.created_at)::date as day,
        coalesce(sum(ci.total), 0) as revenue
      from current_invoices ci
      group by 1
    ),
    daily_return as (
      select
        timezone('Asia/Ho_Chi_Minh', cr.created_at)::date as day,
        coalesce(sum(cr.returned), 0) as returned
      from current_returns cr
      group by 1
    ),
    daily as (
      select
        d.day::date as day,
        coalesce(di.revenue, 0) - coalesce(dr.returned, 0) as revenue
      from generate_series(
        timezone('Asia/Ho_Chi_Minh', p_date_from)::date,
        timezone('Asia/Ho_Chi_Minh', p_date_to - interval '1 microsecond')::date,
        interval '1 day'
      ) d(day)
      left join daily_invoice di on di.day = d.day::date
      left join daily_return dr on dr.day = d.day::date
      order by d.day
    ),
    weekday_invoice as (
      select
        extract(isodow from timezone('Asia/Ho_Chi_Minh', ci.created_at))::int as weekday_no,
        coalesce(sum(ci.total), 0) as revenue
      from current_invoices ci
      group by 1
    ),
    weekday_return as (
      select
        extract(isodow from timezone('Asia/Ho_Chi_Minh', cr.created_at))::int as weekday_no,
        coalesce(sum(cr.returned), 0) as returned
      from current_returns cr
      group by 1
    ),
    hourly_invoice as (
      select
        extract(hour from timezone('Asia/Ho_Chi_Minh', ci.created_at))::int as hour_no,
        coalesce(sum(ci.total), 0) as revenue
      from current_invoices ci
      group by 1
    ),
    hourly_return as (
      select
        extract(hour from timezone('Asia/Ho_Chi_Minh', cr.created_at))::int as hour_no,
        coalesce(sum(cr.returned), 0) as returned
      from current_returns cr
      group by 1
    )
    select jsonb_build_object(
      'current', (
        select to_jsonb(s) - 'period' from summary s where s.period = 'current'
      ),
      'previous', (
        select to_jsonb(s) - 'period' from summary s where s.period = 'previous'
      ),
      'daily', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'date', to_char(d.day, 'DD/MM'),
          'revenue', d.revenue
        ) order by d.day), '[]'::jsonb) from daily d
      ),
      'weekday', (
        select jsonb_agg(jsonb_build_object(
          'label', case n
            when 1 then 'T2' when 2 then 'T3' when 3 then 'T4'
            when 4 then 'T5' when 5 then 'T6' when 6 then 'T7' else 'CN'
          end,
          'value', coalesce(wi.revenue, 0) - coalesce(wr.returned, 0)
        ) order by n)
        from generate_series(1, 7) n
        left join weekday_invoice wi on wi.weekday_no = n
        left join weekday_return wr on wr.weekday_no = n
      ),
      'hourly', (
        select jsonb_agg(jsonb_build_object(
          'label', h::text || 'h',
          'value', coalesce(hi.revenue, 0) - coalesce(hr.returned, 0)
        ) order by h)
        from generate_series(0, 23) h
        left join hourly_invoice hi on hi.hour_no = h
        left join hourly_return hr on hr.hour_no = h
      ),
      'top_invoices', (
        select coalesce(jsonb_agg(to_jsonb(t) order by t.value desc), '[]'::jsonb)
        from (
          select
            ci.code,
            coalesce(nullif(ci.customer_name, ''), 'Khách lẻ') as customer,
            ci.total as value,
            to_char(timezone('Asia/Ho_Chi_Minh', ci.created_at), 'DD/MM/YYYY') as date
          from current_invoices ci
          order by ci.total desc
          limit 10
        ) t
      )
    )
  );
end;
$$;

revoke all on function public.get_sales_report_summary(timestamptz, timestamptz, uuid)
  from public, anon;
grant execute on function public.get_sales_report_summary(timestamptz, timestamptz, uuid)
  to authenticated;

-- Full invoice detail is intentionally paginated. The client loops until
-- has_more=false only after the user explicitly requests a full export.
create or replace function public.get_sales_report_invoice_page(
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_branch_id uuid default null,
  p_offset integer default 0,
  p_limit integer default 1000
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_limit integer;
  v_rows jsonb;
  v_count integer;
begin
  if p_date_from is null or p_date_to is null or p_date_from >= p_date_to then
    raise exception using errcode = '22007', message = 'REPORT_DATE_RANGE_INVALID';
  end if;

  perform public.assert_report_access('reports.analytics', p_branch_id);
  perform public.assert_report_access('reports.view_detail', p_branch_id);
  perform public.assert_report_access('reports.export_detail', p_branch_id);

  select p.tenant_id into v_tenant_id
  from public.profiles p
  where p.id = auth.uid() and coalesce(p.is_active, true);

  v_limit := greatest(1, least(coalesce(p_limit, 1000), 1000));

  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc, t.code), '[]'::jsonb), count(*)
  into v_rows, v_count
  from (
    select
      i.code,
      i.branch_id,
      i.customer_name,
      i.subtotal,
      i.discount_amount,
      coalesce(i.delivery_fee, 0) as delivery_fee,
      i.total,
      i.paid,
      i.debt,
      i.payment_method,
      i.created_at
    from public.invoices i
    where i.tenant_id = v_tenant_id
      and i.status = 'completed'
      and i.created_at >= p_date_from
      and i.created_at < p_date_to
      and (p_branch_id is null or i.branch_id = p_branch_id)
    order by i.created_at desc, i.code
    offset greatest(coalesce(p_offset, 0), 0)
    limit v_limit
  ) t;

  return jsonb_build_object(
    'rows', v_rows,
    'has_more', v_count = v_limit
  );
end;
$$;

revoke all on function public.get_sales_report_invoice_page(
  timestamptz, timestamptz, uuid, integer, integer
) from public, anon;
grant execute on function public.get_sales_report_invoice_page(
  timestamptz, timestamptz, uuid, integer, integer
) to authenticated;

-- P&L aggregate. New invoice lines use the immutable unit_cost snapshot;
-- legacy lines retain the existing current-cost estimate and are counted so
-- the UI/export can disclose that limitation.
create or replace function public.get_profit_and_loss_report(
  p_current_from timestamptz,
  p_current_to timestamptz,
  p_previous_from timestamptz,
  p_previous_to timestamptz,
  p_branch_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
begin
  if p_current_from is null or p_current_to is null
    or p_previous_from is null or p_previous_to is null
    or p_current_from >= p_current_to or p_previous_from >= p_previous_to then
    raise exception using errcode = '22007', message = 'REPORT_DATE_RANGE_INVALID';
  end if;

  perform public.assert_report_access('reports.analytics', p_branch_id);
  perform public.assert_report_access('reports.view_detail', p_branch_id);

  select p.tenant_id into v_tenant_id
  from public.profiles p
  where p.id = auth.uid() and coalesce(p.is_active, true);

  return (
    with periods as (
      select * from (values
        ('current'::text, p_current_from, p_current_to),
        ('previous'::text, p_previous_from, p_previous_to)
      ) p(period, date_from, date_to)
    ),
    scoped_invoices as (
      select p.period, i.id, i.total, coalesce(i.delivery_fee, 0) as delivery_fee
      from periods p
      join public.invoices i
        on i.created_at >= p.date_from and i.created_at < p.date_to
      where i.tenant_id = v_tenant_id
        and i.status = 'completed'
        and (p_branch_id is null or i.branch_id = p_branch_id)
    ),
    invoice_totals as (
      select
        period,
        coalesce(sum(total), 0) as revenue,
        coalesce(sum(delivery_fee), 0) as delivery_fee
      from scoped_invoices
      group by period
    ),
    cost_totals as (
      select
        si.period,
        coalesce(sum(ii.quantity * coalesce(ii.unit_cost, pr.cost_price, 0)), 0) as cogs,
        count(*) filter (where ii.unit_cost is null) as estimated_legacy_lines,
        count(*) filter (where ii.unit_cost is not null) as snapshot_lines
      from scoped_invoices si
      join public.invoice_items ii on ii.invoice_id = si.id
      left join public.products pr on pr.id = ii.product_id
      group by si.period
    ),
    return_revenue_totals as (
      select
        p.period,
        coalesce(sum(sr.total), 0) as returned
      from periods p
      join public.sales_returns sr
        on sr.created_at >= p.date_from and sr.created_at < p.date_to
      where sr.tenant_id = v_tenant_id
        and sr.status in ('confirmed', 'completed')
        and (p_branch_id is null or sr.branch_id = p_branch_id)
      group by p.period
    ),
    return_cost_lines as (
      select
        p.period,
        ri.quantity,
        source_cost.unit_cost,
        coalesce(source_cost.unit_cost, pr.cost_price, 0) as effective_unit_cost
      from periods p
      join public.sales_returns sr
        on sr.created_at >= p.date_from and sr.created_at < p.date_to
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
      where sr.tenant_id = v_tenant_id
        and sr.status in ('confirmed', 'completed')
        and (p_branch_id is null or sr.branch_id = p_branch_id)
    ),
    return_cost_totals as (
      select
        period,
        coalesce(sum(quantity * effective_unit_cost), 0) as return_cogs,
        count(*) filter (where unit_cost is null) as estimated_legacy_lines,
        count(*) filter (where unit_cost is not null) as snapshot_lines
      from return_cost_lines
      group by period
    ),
    expense_totals as (
      select
        p.period,
        coalesce(sum(ct.amount), 0) as operating_expense
      from periods p
      join public.cash_transactions ct
        on ct.created_at >= p.date_from and ct.created_at < p.date_to
      where ct.tenant_id = v_tenant_id
        and ct.type = 'payment'
        and coalesce(ct.status, 'completed') = 'completed'
        and coalesce(ct.category, '') <> all(array[
          'Nhập hàng',
          'Mua hàng nội bộ',
          'Hoàn tiền hủy đơn',
          'Hoàn trả',
          'Trả hàng'
        ])
        and (p_branch_id is null or ct.branch_id = p_branch_id)
      group by p.period
    ),
    summary as (
      select
        p.period,
        coalesce(i.revenue, 0) - coalesce(rr.returned, 0) as revenue,
        coalesce(i.delivery_fee, 0) as delivery_fee,
        coalesce(c.cogs, 0) - coalesce(rc.return_cogs, 0) as cogs,
        coalesce(e.operating_expense, 0) as operating_expense,
        coalesce(c.estimated_legacy_lines, 0) +
          coalesce(rc.estimated_legacy_lines, 0) as estimated_legacy_lines,
        coalesce(c.snapshot_lines, 0) +
          coalesce(rc.snapshot_lines, 0) as snapshot_lines
      from periods p
      left join invoice_totals i using (period)
      left join cost_totals c using (period)
      left join return_revenue_totals rr using (period)
      left join return_cost_totals rc using (period)
      left join expense_totals e using (period)
    )
    select jsonb_build_object(
      'current', (select to_jsonb(s) - 'period' from summary s where period = 'current'),
      'previous', (select to_jsonb(s) - 'period' from summary s where period = 'previous')
    )
  );
end;
$$;

revoke all on function public.get_profit_and_loss_report(
  timestamptz, timestamptz, timestamptz, timestamptz, uuid
) from public, anon;
grant execute on function public.get_profit_and_loss_report(
  timestamptz, timestamptz, timestamptz, timestamptz, uuid
) to authenticated;

-- Branch comparison uses the same return, cost snapshot, and operating-expense
-- rules as the consolidated report. It is available only to all-branch viewers.
create or replace function public.get_branch_profit_and_loss_report(
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
begin
  if p_date_from is null or p_date_to is null or p_date_from >= p_date_to then
    raise exception using errcode = '22007', message = 'REPORT_DATE_RANGE_INVALID';
  end if;

  perform public.assert_report_access('reports.analytics', null);
  perform public.assert_report_access('reports.view_detail', null);

  select p.tenant_id into v_tenant_id
  from public.profiles p
  where p.id = auth.uid() and coalesce(p.is_active, true);

  return (
    with active_branches as (
      select b.id, b.name, coalesce(b.branch_type, 'store') as branch_type
      from public.branches b
      where b.tenant_id = v_tenant_id
        and b.is_active
    ),
    scoped_invoices as (
      select i.id, i.branch_id, i.total, coalesce(i.delivery_fee, 0) as delivery_fee
      from public.invoices i
      where i.tenant_id = v_tenant_id
        and i.status = 'completed'
        and i.created_at >= p_date_from
        and i.created_at < p_date_to
    ),
    invoice_totals as (
      select
        branch_id,
        coalesce(sum(total), 0) as total_revenue,
        coalesce(sum(delivery_fee), 0) as delivery_fee
      from scoped_invoices
      group by branch_id
    ),
    cost_totals as (
      select
        si.branch_id,
        coalesce(sum(ii.quantity * coalesce(ii.unit_cost, pr.cost_price, 0)), 0) as cogs,
        count(*) filter (where ii.unit_cost is null) as estimated_legacy_lines,
        count(*) filter (where ii.unit_cost is not null) as snapshot_lines
      from scoped_invoices si
      join public.invoice_items ii on ii.invoice_id = si.id
      left join public.products pr on pr.id = ii.product_id
      group by si.branch_id
    ),
    scoped_returns as (
      select sr.id, sr.invoice_id, sr.branch_id, sr.total
      from public.sales_returns sr
      where sr.tenant_id = v_tenant_id
        and sr.status in ('confirmed', 'completed')
        and sr.created_at >= p_date_from
        and sr.created_at < p_date_to
    ),
    return_totals as (
      select branch_id, coalesce(sum(total), 0) as returned
      from scoped_returns
      group by branch_id
    ),
    return_cost_lines as (
      select
        sr.branch_id,
        ri.quantity,
        source_cost.unit_cost,
        coalesce(source_cost.unit_cost, pr.cost_price, 0) as effective_unit_cost
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
    return_cost_totals as (
      select
        branch_id,
        coalesce(sum(quantity * effective_unit_cost), 0) as return_cogs,
        count(*) filter (where unit_cost is null) as estimated_legacy_lines,
        count(*) filter (where unit_cost is not null) as snapshot_lines
      from return_cost_lines
      group by branch_id
    ),
    expense_totals as (
      select
        ct.branch_id,
        coalesce(sum(ct.amount), 0) as operating_expense
      from public.cash_transactions ct
      where ct.tenant_id = v_tenant_id
        and ct.type = 'payment'
        and coalesce(ct.status, 'completed') = 'completed'
        and ct.created_at >= p_date_from
        and ct.created_at < p_date_to
        and coalesce(ct.category, '') <> all(array[
          'Nhập hàng',
          'Mua hàng nội bộ',
          'Hoàn tiền hủy đơn',
          'Hoàn trả',
          'Trả hàng'
        ])
      group by ct.branch_id
    ),
    base as (
      select
        b.id as branch_id,
        b.name as branch_name,
        b.branch_type,
        coalesce(i.total_revenue, 0) - coalesce(r.returned, 0) as total_revenue,
        coalesce(i.delivery_fee, 0) as delivery_fee,
        coalesce(c.cogs, 0) - coalesce(rc.return_cogs, 0) as cogs,
        coalesce(e.operating_expense, 0) as operating_expense,
        coalesce(c.estimated_legacy_lines, 0) +
          coalesce(rc.estimated_legacy_lines, 0) as estimated_legacy_lines,
        coalesce(c.snapshot_lines, 0) +
          coalesce(rc.snapshot_lines, 0) as snapshot_lines
      from active_branches b
      left join invoice_totals i on i.branch_id = b.id
      left join cost_totals c on c.branch_id = b.id
      left join return_totals r on r.branch_id = b.id
      left join return_cost_totals rc on rc.branch_id = b.id
      left join expense_totals e on e.branch_id = b.id
    ),
    calculated as (
      select
        base.*,
        total_revenue - delivery_fee as goods_revenue,
        total_revenue - delivery_fee - cogs as gross_profit,
        total_revenue - delivery_fee - cogs - operating_expense as operating_result
      from base
    )
    select jsonb_build_object(
      'rows',
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'branch_id', branch_id,
            'branch_name', branch_name,
            'branch_type', branch_type,
            'total_revenue', total_revenue,
            'delivery_fee', delivery_fee,
            'goods_revenue', goods_revenue,
            'cogs', cogs,
            'gross_profit', gross_profit,
            'gross_margin', coalesce(
              round(gross_profit * 100 / nullif(goods_revenue, 0), 1),
              0
            ),
            'operating_expense', operating_expense,
            'operating_result', operating_result,
            'operating_margin', coalesce(
              round(operating_result * 100 / nullif(goods_revenue, 0), 1),
              0
            ),
            'estimated_legacy_lines', estimated_legacy_lines,
            'snapshot_lines', snapshot_lines
          )
          order by branch_name
        ),
        '[]'::jsonb
      )
    )
    from calculated
  );
end;
$$;

revoke all on function public.get_branch_profit_and_loss_report(
  timestamptz, timestamptz
) from public, anon;
grant execute on function public.get_branch_profit_and_loss_report(
  timestamptz, timestamptz
) to authenticated;
