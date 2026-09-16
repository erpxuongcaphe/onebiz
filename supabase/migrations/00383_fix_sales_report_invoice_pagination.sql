-- 00383: Fix the invoice drill-down pagination flag.
-- This migration only replaces a read-only reporting RPC.

begin;

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
  v_has_more boolean := false;
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
  select
    coalesce(jsonb_agg(jsonb_build_object(
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
    ) order by pi.issued_at desc, pi.code), '[]'::jsonb),
    (select count(*) from paged_invoices) > v_limit
  into v_rows, v_has_more
  from displayed_invoices pi
  left join item_totals it on it.invoice_id = pi.id
  left join return_totals rt on rt.invoice_id = pi.id;

  return jsonb_build_object(
    'rows', v_rows,
    'has_more', coalesce(v_has_more, false)
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

select
  pg_get_functiondef(
    'public.get_sales_report_invoice_detail_page(timestamptz,timestamptz,uuid,integer,integer)'::regprocedure
  ) like '%v_has_more%' as invoice_report_pagination_fixed,
  not has_function_privilege(
    'anon',
    'public.get_sales_report_invoice_detail_page(timestamptz,timestamptz,uuid,integer,integer)',
    'EXECUTE'
  ) as anon_invoice_report_blocked;
