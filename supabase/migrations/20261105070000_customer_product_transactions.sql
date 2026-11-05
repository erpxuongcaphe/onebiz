-- Match the issued date, historical line name, unit and amounts of the
-- customer/product summary. Export uses the same query with its own permission.
create or replace function public.get_customer_product_transactions(
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_customer_id uuid,
  p_branch_id uuid default null,
  p_search text default null,
  p_product_id uuid default null,
  p_product_name text default null,
  p_unit text default null,
  p_offset integer default 0,
  p_limit integer default 50,
  p_export boolean default false
) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_search text := nullif(trim(p_search), '');
begin
  if p_date_from is null or p_date_to is null or p_date_from >= p_date_to then
    raise exception using errcode = '22007', message = 'REPORT_DATE_RANGE_INVALID';
  end if;

  perform public.assert_report_access('reports.analytics', p_branch_id);
  perform public.assert_report_access('reports.view_detail', p_branch_id);
  if p_export then
    perform public.assert_report_access('reports.export_detail', p_branch_id);
  end if;

  select tenant_id into v_tenant_id
  from public.profiles where id = auth.uid() and coalesce(is_active, true);
  if not exists (
    select 1 from public.customers where id = p_customer_id and tenant_id = v_tenant_id
  ) then
    raise exception using errcode = '42501', message = 'REPORT_CUSTOMER_DENIED';
  end if;

  return (
    with lines as (
      select ii.id, i.id as invoice_id, i.issued_at as sold_at, i.code as invoice_code,
        so.code as order_code, b.name as branch_name,
        coalesce(nullif(p.code, ''), '—') as product_code,
        coalesce(nullif(ii.product_name, ''), nullif(p.name, ''), 'Không rõ') as product_name,
        coalesce(nullif(cat.name, ''), 'Chưa phân loại') as category_name,
        coalesce(nullif(ii.unit, ''), nullif(p.unit, ''), '—') as unit,
        coalesce(ii.quantity, 0) as quantity, coalesce(ii.unit_price, 0) as unit_price,
        coalesce(ii.discount, 0) as discount, coalesce(ii.total, 0) as total
      from public.invoices i
      join public.invoice_items ii on ii.invoice_id = i.id
      left join public.products p on p.id = ii.product_id and p.tenant_id = v_tenant_id
      left join public.categories cat on cat.id = p.category_id and cat.tenant_id = v_tenant_id
      left join public.sales_orders so on so.id = i.source_order_id and so.tenant_id = v_tenant_id
      left join public.branches b on b.id = i.branch_id and b.tenant_id = v_tenant_id
      where i.tenant_id = v_tenant_id and i.status = 'completed'
        and i.customer_id = p_customer_id
        and i.issued_at >= p_date_from and i.issued_at < p_date_to
        and (p_branch_id is null or i.branch_id = p_branch_id)
        and (p_product_name is null or ii.product_id is not distinct from p_product_id)
    ), filtered as (
      select * from lines
      where (p_product_name is null or (product_name = p_product_name and unit = p_unit))
        and (v_search is null or product_name ilike '%' || v_search || '%'
          or product_code ilike '%' || v_search || '%' or category_name ilike '%' || v_search || '%')
    ), page as (
      select * from filtered order by sold_at, id
      limit greatest(1, least(coalesce(p_limit, 50), case when p_export then 500 else 100 end))
      offset greatest(0, coalesce(p_offset, 0))
    )
    select jsonb_build_object(
      'rows', (select coalesce(jsonb_agg(to_jsonb(page) order by sold_at, id), '[]'::jsonb) from page),
      'total', count(*), 'revenue', coalesce(sum(total), 0)
    ) from filtered
  );
end;
$$;

revoke all on function public.get_customer_product_transactions(
  timestamptz, timestamptz, uuid, uuid, text, uuid, text, text, integer, integer, boolean
) from public, anon;
grant execute on function public.get_customer_product_transactions(
  timestamptz, timestamptz, uuid, uuid, text, uuid, text, text, integer, integer, boolean
) to authenticated;
