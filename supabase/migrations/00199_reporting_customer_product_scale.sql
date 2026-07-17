-- ============================================================
-- 00199: Báo cáo Khách hàng - Sản phẩm cho dữ liệu lớn
-- ============================================================
-- Chỉ tạo các hàm đọc và tổng hợp số liệu. Migration này không thêm, sửa,
-- xóa chứng từ hoặc dữ liệu danh mục.

create or replace function public.get_customer_product_report(
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_branch_id uuid default null,
  p_search text default null,
  p_sort text default 'revenue_desc',
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
begin
  if p_date_from is null or p_date_to is null or p_date_from >= p_date_to then
    raise exception using errcode = '22007', message = 'REPORT_DATE_RANGE_INVALID';
  end if;

  perform public.assert_report_access('reports.analytics', p_branch_id);
  perform public.assert_report_access('reports.view_detail', p_branch_id);

  select p.tenant_id into v_tenant_id
  from public.profiles p
  where p.id = auth.uid() and coalesce(p.is_active, true);

  v_limit := greatest(10, least(coalesce(p_limit, 50), 100));

  return (
    with scoped_lines as (
      select
        i.id as invoice_id,
        i.customer_id,
        coalesce(nullif(c.code, ''), '—') as customer_code,
        coalesce(nullif(c.name, ''), nullif(i.customer_name, ''), 'Khách lẻ') as customer_name,
        i.created_at,
        ii.product_id,
        coalesce(nullif(p.code, ''), '—') as product_code,
        coalesce(nullif(ii.product_name, ''), nullif(p.name, ''), 'Không rõ') as product_name,
        coalesce(nullif(ii.unit, ''), nullif(p.unit, ''), '—') as unit,
        p.category_id,
        coalesce(nullif(cat.name, ''), 'Chưa phân loại') as category_name,
        coalesce(ii.quantity, 0) as quantity,
        coalesce(ii.total, 0) as revenue
      from public.invoices i
      join public.invoice_items ii on ii.invoice_id = i.id
      left join public.customers c
        on c.id = i.customer_id and c.tenant_id = v_tenant_id
      left join public.products p
        on p.id = ii.product_id and p.tenant_id = v_tenant_id
      left join public.categories cat
        on cat.id = p.category_id and cat.tenant_id = v_tenant_id
      where i.tenant_id = v_tenant_id
        and i.status = 'completed'
        and i.customer_id is not null
        and i.created_at >= p_date_from
        and i.created_at < p_date_to
        and (p_branch_id is null or i.branch_id = p_branch_id)
    ),
    customer_agg as (
      select
        customer_id,
        max(customer_code) as customer_code,
        max(customer_name) as customer_name,
        count(distinct invoice_id) as order_count,
        count(distinct product_id) as product_count,
        coalesce(sum(quantity), 0) as quantity,
        coalesce(sum(revenue), 0) as revenue,
        max(created_at) as last_purchase_at
      from scoped_lines
      group by customer_id
    ),
    product_agg as (
      select
        customer_id,
        product_id,
        max(product_name) as product_name,
        coalesce(sum(revenue), 0) as revenue
      from scoped_lines
      group by customer_id, product_id
    ),
    ranked_products as (
      select
        pa.*,
        row_number() over (
          partition by pa.customer_id
          order by pa.revenue desc, pa.product_name
        ) as product_rank
      from product_agg pa
    ),
    customer_rows as (
      select
        ca.*,
        rp.product_name as top_product,
        case
          when sum(ca.revenue) over () = 0 then 0
          else ca.revenue * 100.0 / sum(ca.revenue) over ()
        end as revenue_share
      from customer_agg ca
      left join ranked_products rp
        on rp.customer_id = ca.customer_id and rp.product_rank = 1
    ),
    filtered_customers as (
      select *
      from customer_rows cr
      where coalesce(trim(p_search), '') = ''
        or cr.customer_name ilike '%' || trim(p_search) || '%'
        or cr.customer_code ilike '%' || trim(p_search) || '%'
    ),
    ordered_customers as (
      select *
      from filtered_customers fc
      order by
        case when p_sort = 'name_asc' then lower(fc.customer_name) end asc,
        case when p_sort = 'orders_desc' then fc.order_count end desc,
        case when p_sort = 'quantity_desc' then fc.quantity end desc,
        case when p_sort not in ('name_asc', 'orders_desc', 'quantity_desc') then fc.revenue end desc,
        fc.customer_name,
        fc.customer_id
      offset greatest(coalesce(p_offset, 0), 0)
      limit v_limit
    ),
    category_agg as (
      select
        coalesce(category_id::text, 'uncategorized') as category_id,
        max(category_name) as category_name,
        coalesce(sum(revenue), 0) as revenue
      from scoped_lines
      group by category_id
    ),
    top_categories as (
      select *
      from category_agg
      order by revenue desc, category_name
      limit 10
    ),
    top_matrix_customers as (
      select * from customer_agg order by revenue desc, customer_name limit 20
    ),
    matrix_cells as (
      select
        sl.customer_id,
        max(sl.customer_name) as customer_name,
        case
          when tc.category_id is null then 'other'
          else coalesce(sl.category_id::text, 'uncategorized')
        end as category_id,
        case when tc.category_id is null then 'Nhóm khác' else tc.category_name end as category_name,
        coalesce(sum(sl.revenue), 0) as revenue
      from scoped_lines sl
      join top_matrix_customers tmc on tmc.customer_id = sl.customer_id
      left join top_categories tc
        on tc.category_id = coalesce(sl.category_id::text, 'uncategorized')
      group by sl.customer_id,
        case when tc.category_id is null then 'other' else coalesce(sl.category_id::text, 'uncategorized') end,
        case when tc.category_id is null then 'Nhóm khác' else tc.category_name end
    ),
    totals as (
      select
        count(distinct customer_id) as customer_count,
        count(distinct invoice_id) as order_count,
        count(distinct product_id) as product_count,
        coalesce(sum(quantity), 0) as quantity,
        coalesce(sum(revenue), 0) as revenue
      from scoped_lines
    ),
    top_ten as (
      select coalesce(sum(revenue), 0) as revenue
      from (select revenue from customer_agg order by revenue desc limit 10) t
    )
    select jsonb_build_object(
      'summary', (
        select jsonb_build_object(
          'customer_count', t.customer_count,
          'order_count', t.order_count,
          'product_count', t.product_count,
          'quantity', t.quantity,
          'revenue', t.revenue,
          'average_order_value', case when t.order_count = 0 then 0 else t.revenue / t.order_count end,
          'top_ten_share', case when t.revenue = 0 then 0 else tt.revenue * 100.0 / t.revenue end
        )
        from totals t cross join top_ten tt
      ),
      'customers', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'customer_id', oc.customer_id,
          'customer_code', oc.customer_code,
          'customer_name', oc.customer_name,
          'order_count', oc.order_count,
          'product_count', oc.product_count,
          'quantity', oc.quantity,
          'revenue', oc.revenue,
          'revenue_share', oc.revenue_share,
          'top_product', oc.top_product,
          'last_purchase_at', oc.last_purchase_at
        ) order by
          case when p_sort = 'name_asc' then lower(oc.customer_name) end asc,
          case when p_sort = 'orders_desc' then oc.order_count end desc,
          case when p_sort = 'quantity_desc' then oc.quantity end desc,
          case when p_sort not in ('name_asc', 'orders_desc', 'quantity_desc') then oc.revenue end desc,
          oc.customer_name,
          oc.customer_id), '[]'::jsonb)
        from ordered_customers oc
      ),
      'customer_total', (select count(*) from filtered_customers),
      'categories', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'category_id', tc.category_id,
          'category_name', tc.category_name,
          'revenue', tc.revenue
        ) order by tc.revenue desc), '[]'::jsonb)
        from top_categories tc
      ),
      'matrix', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'customer_id', mc.customer_id,
          'customer_name', mc.customer_name,
          'category_id', mc.category_id,
          'category_name', mc.category_name,
          'revenue', mc.revenue
        ) order by mc.revenue desc), '[]'::jsonb)
        from matrix_cells mc
      )
    )
  );
end;
$$;

revoke all on function public.get_customer_product_report(
  timestamptz, timestamptz, uuid, text, text, integer, integer
) from public, anon;
grant execute on function public.get_customer_product_report(
  timestamptz, timestamptz, uuid, text, text, integer, integer
) to authenticated;

create or replace function public.get_customer_product_detail_page(
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_customer_id uuid,
  p_branch_id uuid default null,
  p_search text default null,
  p_sort text default 'revenue_desc',
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
begin
  if p_date_from is null or p_date_to is null or p_date_from >= p_date_to then
    raise exception using errcode = '22007', message = 'REPORT_DATE_RANGE_INVALID';
  end if;
  if p_customer_id is null then
    raise exception using errcode = '22004', message = 'REPORT_CUSTOMER_REQUIRED';
  end if;

  perform public.assert_report_access('reports.analytics', p_branch_id);
  perform public.assert_report_access('reports.view_detail', p_branch_id);

  select p.tenant_id into v_tenant_id
  from public.profiles p
  where p.id = auth.uid() and coalesce(p.is_active, true);

  if not exists (
    select 1 from public.customers c
    where c.id = p_customer_id and c.tenant_id = v_tenant_id
  ) then
    raise exception using errcode = '42501', message = 'REPORT_CUSTOMER_DENIED';
  end if;

  v_limit := greatest(10, least(coalesce(p_limit, 50), 100));

  return (
    with product_rows as (
      select
        ii.product_id,
        coalesce(nullif(p.code, ''), '—') as product_code,
        coalesce(nullif(ii.product_name, ''), nullif(p.name, ''), 'Không rõ') as product_name,
        coalesce(nullif(cat.name, ''), 'Chưa phân loại') as category_name,
        coalesce(nullif(ii.unit, ''), nullif(p.unit, ''), '—') as unit,
        count(distinct i.id) as order_count,
        coalesce(sum(ii.quantity), 0) as quantity,
        coalesce(sum(ii.total), 0) as revenue,
        max(i.created_at) as last_purchase_at
      from public.invoices i
      join public.invoice_items ii on ii.invoice_id = i.id
      left join public.products p
        on p.id = ii.product_id and p.tenant_id = v_tenant_id
      left join public.categories cat
        on cat.id = p.category_id and cat.tenant_id = v_tenant_id
      where i.tenant_id = v_tenant_id
        and i.status = 'completed'
        and i.customer_id = p_customer_id
        and i.created_at >= p_date_from
        and i.created_at < p_date_to
        and (p_branch_id is null or i.branch_id = p_branch_id)
      group by ii.product_id, p.code, ii.product_name, p.name, cat.name, ii.unit, p.unit
    ),
    product_totals as (
      select coalesce(sum(revenue), 0) as revenue from product_rows
    ),
    filtered_rows as (
      select
        pr.*,
        case when pt.revenue = 0 then 0
          else pr.revenue * 100.0 / pt.revenue end as revenue_share
      from product_rows pr
      cross join product_totals pt
      where coalesce(trim(p_search), '') = ''
        or pr.product_name ilike '%' || trim(p_search) || '%'
        or pr.product_code ilike '%' || trim(p_search) || '%'
        or pr.category_name ilike '%' || trim(p_search) || '%'
    ),
    ordered_rows as (
      select * from filtered_rows fr
      order by
        case when p_sort = 'name_asc' then lower(fr.product_name) end asc,
        case when p_sort = 'quantity_desc' then fr.quantity end desc,
        case when p_sort not in ('name_asc', 'quantity_desc') then fr.revenue end desc,
        fr.product_name,
        fr.product_id
      offset greatest(coalesce(p_offset, 0), 0)
      limit v_limit
    )
    select jsonb_build_object(
      'rows', (
        select coalesce(jsonb_agg(to_jsonb(o) order by
          case when p_sort = 'name_asc' then lower(o.product_name) end asc,
          case when p_sort = 'quantity_desc' then o.quantity end desc,
          case when p_sort not in ('name_asc', 'quantity_desc') then o.revenue end desc,
          o.product_name,
          o.product_id), '[]'::jsonb)
        from ordered_rows o
      ),
      'total', (select count(*) from filtered_rows),
      'revenue', (select revenue from product_totals)
    )
  );
end;
$$;

revoke all on function public.get_customer_product_detail_page(
  timestamptz, timestamptz, uuid, uuid, text, text, integer, integer
) from public, anon;
grant execute on function public.get_customer_product_detail_page(
  timestamptz, timestamptz, uuid, uuid, text, text, integer, integer
) to authenticated;

create or replace function public.get_customer_product_export_page(
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

  return (
    with rows as (
      select
        coalesce(nullif(c.code, ''), '—') as customer_code,
        coalesce(nullif(c.name, ''), nullif(i.customer_name, ''), 'Khách lẻ') as customer_name,
        coalesce(nullif(p.code, ''), '—') as product_code,
        coalesce(nullif(ii.product_name, ''), nullif(p.name, ''), 'Không rõ') as product_name,
        coalesce(nullif(cat.name, ''), 'Chưa phân loại') as category_name,
        coalesce(nullif(ii.unit, ''), nullif(p.unit, ''), '—') as unit,
        count(distinct i.id) as order_count,
        coalesce(sum(ii.quantity), 0) as quantity,
        coalesce(sum(ii.total), 0) as revenue,
        max(i.created_at) as last_purchase_at
      from public.invoices i
      join public.invoice_items ii on ii.invoice_id = i.id
      left join public.customers c
        on c.id = i.customer_id and c.tenant_id = v_tenant_id
      left join public.products p
        on p.id = ii.product_id and p.tenant_id = v_tenant_id
      left join public.categories cat
        on cat.id = p.category_id and cat.tenant_id = v_tenant_id
      where i.tenant_id = v_tenant_id
        and i.status = 'completed'
        and i.customer_id is not null
        and i.created_at >= p_date_from
        and i.created_at < p_date_to
        and (p_branch_id is null or i.branch_id = p_branch_id)
      group by i.customer_id, c.code, c.name, i.customer_name,
        ii.product_id, p.code, ii.product_name, p.name, cat.name, ii.unit, p.unit
      order by customer_name, customer_code, revenue desc, product_name, product_code
      offset greatest(coalesce(p_offset, 0), 0)
      limit v_limit
    )
    select jsonb_build_object(
      'rows', (
        select coalesce(jsonb_agg(to_jsonb(r) order by
          r.customer_name, r.customer_code, r.revenue desc, r.product_name, r.product_code), '[]'::jsonb)
        from rows r
      ),
      'has_more', (select count(*) = v_limit from rows)
    )
  );
end;
$$;

revoke all on function public.get_customer_product_export_page(
  timestamptz, timestamptz, uuid, integer, integer
) from public, anon;
grant execute on function public.get_customer_product_export_page(
  timestamptz, timestamptz, uuid, integer, integer
) to authenticated;
