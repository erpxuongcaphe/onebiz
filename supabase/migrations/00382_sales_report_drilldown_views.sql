-- ============================================================================
-- 00382 -- Drill-down bao cao ban hang: Theo ngay va Theo hoa don
-- ============================================================================
-- Hai ham nay chi doc. Ngay ban hang luon dung invoices.issued_at; ngay tra
-- hang dung sales_returns.created_at, vi day la thoi diem nghiep vu phat sinh.

begin;

create or replace function public.get_sales_report_daily_rows(
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
begin
  if p_date_from is null or p_date_to is null or p_date_from >= p_date_to then
    raise exception using errcode = '22007', message = 'REPORT_DATE_RANGE_INVALID';
  end if;

  perform public.assert_report_access('reports.analytics', p_branch_id);
  perform public.assert_report_access('reports.view_detail', p_branch_id);

  select p.tenant_id into v_tenant_id
  from public.profiles p
  where p.id = auth.uid() and coalesce(p.is_active, true);

  return (
    with scoped_invoices as (
      select
        i.id,
        timezone('Asia/Ho_Chi_Minh', i.issued_at)::date as day,
        i.total,
        i.paid,
        i.debt
      from public.invoices i
      where i.tenant_id = v_tenant_id
        and i.status = 'completed'
        and i.issued_at >= p_date_from
        and i.issued_at < p_date_to
        and (p_branch_id is null or i.branch_id = p_branch_id)
    ),
    invoice_daily as (
      select
        si.day,
        count(*)::integer as order_count,
        coalesce(sum(si.total), 0) as gross_revenue,
        coalesce(sum(si.paid), 0) as paid,
        coalesce(sum(si.debt), 0) as debt
      from scoped_invoices si
      group by si.day
    ),
    item_daily as (
      select
        si.day,
        coalesce(sum(ii.quantity), 0) as sold_qty
      from scoped_invoices si
      join public.invoice_items ii on ii.invoice_id = si.id
      group by si.day
    ),
    return_daily as (
      select
        timezone('Asia/Ho_Chi_Minh', sr.created_at)::date as day,
        coalesce(sum(sr.total), 0) as return_amount
      from public.sales_returns sr
      where sr.tenant_id = v_tenant_id
        and sr.status in ('confirmed', 'completed')
        and sr.created_at >= p_date_from
        and sr.created_at < p_date_to
        and (p_branch_id is null or sr.branch_id = p_branch_id)
      group by 1
    ),
    days as (
      select d.day::date as day
      from generate_series(
        timezone('Asia/Ho_Chi_Minh', p_date_from)::date,
        timezone('Asia/Ho_Chi_Minh', p_date_to - interval '1 microsecond')::date,
        interval '1 day'
      ) d(day)
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'date', to_char(d.day, 'YYYY-MM-DD'),
      'order_count', coalesce(id.order_count, 0),
      'sold_qty', coalesce(items.sold_qty, 0),
      'gross_revenue', coalesce(id.gross_revenue, 0),
      'return_amount', coalesce(rd.return_amount, 0),
      'net_revenue', coalesce(id.gross_revenue, 0) - coalesce(rd.return_amount, 0),
      'paid', coalesce(id.paid, 0),
      'debt', coalesce(id.debt, 0)
    ) order by d.day), '[]'::jsonb)
    from days d
    left join invoice_daily id on id.day = d.day
    left join item_daily items on items.day = d.day
    left join return_daily rd on rd.day = d.day
  );
end;
$$;

revoke all on function public.get_sales_report_daily_rows(timestamptz, timestamptz, uuid)
  from public, anon;
grant execute on function public.get_sales_report_daily_rows(timestamptz, timestamptz, uuid)
  to authenticated;

create or replace function public.get_sales_report_invoice_detail_page(
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_branch_id uuid default null,
  p_offset integer default 0,
  p_limit integer default 50
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
begin
  if p_date_from is null or p_date_to is null or p_date_from >= p_date_to then
    raise exception using errcode = '22007', message = 'REPORT_DATE_RANGE_INVALID';
  end if;

  perform public.assert_report_access('reports.analytics', p_branch_id);
  perform public.assert_report_access('reports.view_detail', p_branch_id);

  select p.tenant_id into v_tenant_id
  from public.profiles p
  where p.id = auth.uid() and coalesce(p.is_active, true);

  v_limit := greatest(1, least(coalesce(p_limit, 50), 200));

  with scoped_invoices as (
    select
      i.id,
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
      i.issued_at
    from public.invoices i
    where i.tenant_id = v_tenant_id
      and i.status = 'completed'
      and i.issued_at >= p_date_from
      and i.issued_at < p_date_to
      and (p_branch_id is null or i.branch_id = p_branch_id)
  ),
  paged_invoices as (
    select *
    from scoped_invoices
    order by issued_at desc, code
    offset greatest(coalesce(p_offset, 0), 0)
    limit v_limit + 1
  ),
  displayed_invoices as (
    select *
    from paged_invoices
    order by issued_at desc, code
    limit v_limit
  ),
  item_totals as (
    select
      ii.invoice_id,
      count(*)::integer as item_count,
      coalesce(sum(ii.quantity), 0) as sold_qty
    from public.invoice_items ii
    join displayed_invoices pi on pi.id = ii.invoice_id
    group by ii.invoice_id
  ),
  return_totals as (
    select
      sr.invoice_id,
      coalesce(sum(sr.total), 0) as return_amount
    from public.sales_returns sr
    join displayed_invoices pi on pi.id = sr.invoice_id
    where sr.tenant_id = v_tenant_id
      and sr.status in ('confirmed', 'completed')
      and sr.created_at >= p_date_from
      and sr.created_at < p_date_to
      and (p_branch_id is null or sr.branch_id = p_branch_id)
    group by sr.invoice_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', pi.id,
      'code', pi.code,
      'branch_id', pi.branch_id,
      'customer_name', coalesce(nullif(pi.customer_name, ''), 'Khach le'),
      'subtotal', pi.subtotal,
      'discount_amount', pi.discount_amount,
      'delivery_fee', pi.delivery_fee,
      'total', pi.total,
      'paid', pi.paid,
      'debt', pi.debt,
      'payment_method', pi.payment_method,
      'issued_at', pi.issued_at,
      'item_count', coalesce(it.item_count, 0),
      'sold_qty', coalesce(it.sold_qty, 0),
      'return_amount', coalesce(rt.return_amount, 0),
      'net_amount', pi.total - coalesce(rt.return_amount, 0)
    ) order by pi.issued_at desc, pi.code), '[]'::jsonb)
  into v_rows
  from displayed_invoices pi
  left join item_totals it on it.invoice_id = pi.id
  left join return_totals rt on rt.invoice_id = pi.id;

  return jsonb_build_object(
    'rows', v_rows,
    'has_more', (select count(*) from paged_invoices) > v_limit
  );
end;
$$;

revoke all on function public.get_sales_report_invoice_detail_page(
  timestamptz, timestamptz, uuid, integer, integer
) from public, anon;
grant execute on function public.get_sales_report_invoice_detail_page(
  timestamptz, timestamptz, uuid, integer, integer
) to authenticated;

commit;
