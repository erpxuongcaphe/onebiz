-- ============================================================
-- 00258: Finance dashboard uses the same P&L definition everywhere
-- ============================================================
-- Read-only report function. It does not update business data.
--
-- The existing finance overview calculated:
--   profit = invoice revenue - every cash payment
-- That omitted COGS/returns and treated asset purchases as expenses.
--
-- This RPC reuses get_profit_and_loss_report(), so KPI and trend share:
--   net goods revenue = invoice total - returns - delivery fee
--   total expense     = COGS + operating expense
--   operating profit  = net goods revenue - total expense

create or replace function public.get_consolidated_profit_and_loss_report(
  p_current_from timestamptz,
  p_current_to timestamptz,
  p_previous_from timestamptz,
  p_previous_to timestamptz
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_base jsonb;
begin
  if p_current_from is null or p_current_to is null
    or p_previous_from is null or p_previous_to is null
    or p_current_from >= p_current_to
    or p_previous_from >= p_previous_to then
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

  v_base := public.get_profit_and_loss_report(
    p_current_from, p_current_to, p_previous_from, p_previous_to, null
  );

  return (
    with periods as (
      select * from (values
        ('current'::text, p_current_from, p_current_to),
        ('previous'::text, p_previous_from, p_previous_to)
      ) p(period, date_from, date_to)
    ),
    internal_invoices as (
      select p.period, i.id, i.total, coalesce(i.delivery_fee, 0) as delivery_fee
      from periods p
      join public.invoices i
        on i.created_at >= p.date_from and i.created_at < p.date_to
      where i.tenant_id = v_tenant_id
        and i.status = 'completed'
        and i.source = 'internal'
    ),
    internal_invoice_totals as (
      select period, coalesce(sum(total), 0) as revenue,
             coalesce(sum(delivery_fee), 0) as delivery_fee
      from internal_invoices
      group by period
    ),
    internal_cost_totals as (
      select scope.period,
        coalesce(sum(line.quantity * coalesce(line.unit_cost, product.cost_price, 0)), 0) as cogs,
        count(*) filter (where line.unit_cost is null) as estimated_legacy_lines,
        count(*) filter (where line.unit_cost is not null) as snapshot_lines
      from internal_invoices scope
      join public.invoice_items line on line.invoice_id = scope.id
      left join public.products product on product.id = line.product_id
      group by scope.period
    ),
    internal_returns as (
      select p.period, sr.id, sr.invoice_id, sr.total
      from periods p
      join public.sales_returns sr
        on sr.created_at >= p.date_from and sr.created_at < p.date_to
      join public.invoices source_invoice
        on source_invoice.id = sr.invoice_id
       and source_invoice.tenant_id = v_tenant_id
       and source_invoice.source = 'internal'
      where sr.tenant_id = v_tenant_id
        and sr.status in ('confirmed', 'completed')
    ),
    internal_return_totals as (
      select period, coalesce(sum(total), 0) as revenue
      from internal_returns
      group by period
    ),
    internal_return_cost_lines as (
      select ir.period, return_line.quantity, source_cost.unit_cost,
        coalesce(source_cost.unit_cost, product.cost_price, 0) as effective_unit_cost
      from internal_returns ir
      join public.return_items return_line on return_line.return_id = ir.id
      left join lateral (
        select source_line.unit_cost
        from public.invoice_items source_line
        where source_line.invoice_id = ir.invoice_id
          and source_line.product_id = return_line.product_id
        order by source_line.id
        limit 1
      ) source_cost on true
      left join public.products product on product.id = return_line.product_id
    ),
    internal_return_cost_totals as (
      select period,
        coalesce(sum(quantity * effective_unit_cost), 0) as cogs,
        count(*) filter (where unit_cost is null) as estimated_legacy_lines,
        count(*) filter (where unit_cost is not null) as snapshot_lines
      from internal_return_cost_lines
      group by period
    ),
    adjustments as (
      select p.period,
        coalesce(invoice_total.revenue, 0) - coalesce(return_total.revenue, 0) as internal_revenue,
        coalesce(invoice_total.delivery_fee, 0) as internal_delivery_fee,
        coalesce(cost_total.cogs, 0) - coalesce(return_cost.cogs, 0) as internal_cogs,
        coalesce(cost_total.estimated_legacy_lines, 0)
          + coalesce(return_cost.estimated_legacy_lines, 0) as estimated_legacy_lines,
        coalesce(cost_total.snapshot_lines, 0)
          + coalesce(return_cost.snapshot_lines, 0) as snapshot_lines
      from periods p
      left join internal_invoice_totals invoice_total using (period)
      left join internal_return_totals return_total using (period)
      left join internal_cost_totals cost_total using (period)
      left join internal_return_cost_totals return_cost using (period)
    ),
    consolidated as (
      select a.period,
        coalesce(((v_base->a.period)->>'revenue')::numeric, 0) - a.internal_revenue as revenue,
        coalesce(((v_base->a.period)->>'delivery_fee')::numeric, 0)
          - a.internal_delivery_fee as delivery_fee,
        coalesce(((v_base->a.period)->>'cogs')::numeric, 0) - a.internal_cogs as cogs,
        coalesce(((v_base->a.period)->>'operating_expense')::numeric, 0) as operating_expense,
        greatest(
          coalesce(((v_base->a.period)->>'estimated_legacy_lines')::integer, 0)
            - a.estimated_legacy_lines,
          0
        ) as estimated_legacy_lines,
        greatest(
          coalesce(((v_base->a.period)->>'snapshot_lines')::integer, 0)
            - a.snapshot_lines,
          0
        ) as snapshot_lines,
        a.internal_revenue
      from adjustments a
    )
    select jsonb_build_object(
      'current', (select to_jsonb(c) - 'period' from consolidated c where c.period = 'current'),
      'previous', (select to_jsonb(c) - 'period' from consolidated c where c.period = 'previous')
    )
  );
end;
$$;

revoke all on function public.get_consolidated_profit_and_loss_report(
  timestamptz, timestamptz, timestamptz, timestamptz
) from public, anon;

grant execute on function public.get_consolidated_profit_and_loss_report(
  timestamptz, timestamptz, timestamptz, timestamptz
) to authenticated;

comment on function public.get_consolidated_profit_and_loss_report(
  timestamptz, timestamptz, timestamptz, timestamptz
) is 'Read-only company P&L excluding internal invoice revenue, returns and COGS.';

create or replace function public.get_finance_dashboard_report(
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
  v_summary jsonb;
  v_bucket_payload jsonb;
  v_trend jsonb := '[]'::jsonb;
  v_expense_breakdown jsonb;
  v_granularity text;
  v_step interval;
  v_bucket_start timestamptz;
  v_bucket_end timestamptz;
  v_current jsonb;
  v_goods_revenue numeric;
  v_total_expense numeric;
  v_profit numeric;
begin
  if p_current_from is null or p_current_to is null
    or p_previous_from is null or p_previous_to is null
    or p_current_from >= p_current_to
    or p_previous_from >= p_previous_to then
    raise exception using
      errcode = '22007',
      message = 'REPORT_DATE_RANGE_INVALID';
  end if;

  perform public.assert_report_access('reports.analytics', p_branch_id);
  perform public.assert_report_access('reports.view_detail', p_branch_id);

  select p.tenant_id
    into v_tenant_id
    from public.profiles p
   where p.id = auth.uid()
     and coalesce(p.is_active, true);

  if v_tenant_id is null then
    raise exception using
      errcode = '42501',
      message = 'ACTIVE_PROFILE_REQUIRED';
  end if;

  if p_branch_id is null then
    v_summary := public.get_consolidated_profit_and_loss_report(
      p_current_from, p_current_to, p_previous_from, p_previous_to
    );
  else
    v_summary := public.get_profit_and_loss_report(
      p_current_from, p_current_to, p_previous_from, p_previous_to, p_branch_id
    );
  end if;

  if p_current_to - p_current_from <= interval '45 days' then
    v_granularity := 'day';
    v_step := interval '1 day';
  elsif p_current_to - p_current_from <= interval '550 days' then
    v_granularity := 'month';
    v_step := interval '1 month';
  else
    v_granularity := 'year';
    v_step := interval '1 year';
  end if;

  v_bucket_start := date_trunc(v_granularity, p_current_from);
  while v_bucket_start < p_current_to loop
    v_bucket_end := least(v_bucket_start + v_step, p_current_to);

    if v_bucket_end > p_current_from then
      if p_branch_id is null then
        v_bucket_payload := public.get_consolidated_profit_and_loss_report(
          greatest(v_bucket_start, p_current_from), v_bucket_end,
          greatest(v_bucket_start, p_current_from), v_bucket_end
        );
      else
        v_bucket_payload := public.get_profit_and_loss_report(
          greatest(v_bucket_start, p_current_from), v_bucket_end,
          greatest(v_bucket_start, p_current_from), v_bucket_end, p_branch_id
        );
      end if;
      v_current := v_bucket_payload->'current';
      v_goods_revenue :=
        coalesce((v_current->>'revenue')::numeric, 0)
        - coalesce((v_current->>'delivery_fee')::numeric, 0);
      v_total_expense :=
        coalesce((v_current->>'cogs')::numeric, 0)
        + coalesce((v_current->>'operating_expense')::numeric, 0);
      v_profit := v_goods_revenue - v_total_expense;

      v_trend := v_trend || jsonb_build_array(jsonb_build_object(
        'bucket_start', v_bucket_start,
        'goods_revenue', v_goods_revenue,
        'cogs', coalesce((v_current->>'cogs')::numeric, 0),
        'operating_expense',
          coalesce((v_current->>'operating_expense')::numeric, 0),
        'total_expense', v_total_expense,
        'profit', v_profit
      ));
    end if;

    v_bucket_start := v_bucket_start + v_step;
  end loop;

  with operating_categories as (
    select
      coalesce(nullif(trim(ct.category), ''), 'Khác') as name,
      sum(ct.amount)::numeric as value
    from public.cash_transactions ct
    where ct.tenant_id = v_tenant_id
      and ct.type = 'payment'
      and coalesce(ct.status, 'completed') = 'completed'
      and ct.created_at >= p_current_from
      and ct.created_at < p_current_to
      and (p_branch_id is null or ct.branch_id = p_branch_id)
      and coalesce(ct.category, '') <> all(array[
        'Nhập hàng',
        'Mua hàng nội bộ',
        'Hoàn tiền hủy đơn',
        'Hoàn trả',
        'Trả hàng',
        'Trả nhà cung cấp',
        'supplier_payment'
      ])
    group by 1
  ),
  rows as (
    select
      'Giá vốn hàng bán'::text as name,
      coalesce(((v_summary->'current')->>'cogs')::numeric, 0) as value,
      0 as sort_order
    union all
    select name, value, 1
    from operating_categories
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object('name', name, 'value', value)
      order by sort_order, value desc, name
    ) filter (where value <> 0),
    '[]'::jsonb
  )
  into v_expense_breakdown
  from rows;

  return jsonb_build_object(
    'current', v_summary->'current',
    'previous', v_summary->'previous',
    'granularity', v_granularity,
    'trend', v_trend,
    'expense_breakdown', v_expense_breakdown
  );
end;
$$;

revoke all on function public.get_finance_dashboard_report(
  timestamptz, timestamptz, timestamptz, timestamptz, uuid
) from public, anon;

grant execute on function public.get_finance_dashboard_report(
  timestamptz, timestamptz, timestamptz, timestamptz, uuid
) to authenticated;

comment on function public.get_finance_dashboard_report(
  timestamptz, timestamptz, timestamptz, timestamptz, uuid
) is
  'Read-only finance dashboard using the same return, COGS and operating-expense rules as P&L.';
