-- ============================================================
-- 00080: Phase B báo cáo BÁN HÀNG chi tiết (CEO 16/05/2026)
--
-- 3 báo cáo:
--   1. Trả hàng chi tiết — theo lý do / SP / NV xử lý
--   2. Doanh thu nhân viên cross-branch — xếp hạng cashier toàn chuỗi
--   3. Net delivery commission — tách phí Grab/Shopee/Now để biết doanh thu thật
-- ============================================================

-- ────────────────────────────────────────────────────────────────
-- 1. RPC: get_sales_return_report
-- ────────────────────────────────────────────────────────────────
create or replace function public.get_sales_return_report(
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_branch_id uuid default null,
  p_tenant_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid;
  v_from timestamptz;
  v_to timestamptz;
begin
  v_tenant_id := coalesce(
    p_tenant_id,
    (select tenant_id from public.profiles where id = auth.uid())
  );

  if v_tenant_id is null then
    raise exception 'TENANT_NOT_FOUND';
  end if;

  v_from := coalesce(p_date_from, now() - interval '30 days');
  v_to := coalesce(p_date_to, now());

  return jsonb_build_object(
    'generated_at', now(),
    'date_from', v_from,
    'date_to', v_to,
    'tenant_id', v_tenant_id,
    'branch_id', p_branch_id,
    'rows', (
      select coalesce(jsonb_agg(row_to_json(t) order by t.return_date desc), '[]'::jsonb)
      from (
        select
          sr.id as return_id,
          sr.code as return_code,
          sr.created_at as return_date,
          sr.branch_id,
          b.name as branch_name,
          sr.invoice_id,
          inv.code as invoice_code,
          sr.customer_name,
          coalesce(sr.reason, 'Không ghi rõ') as reason,
          sr.status,
          sr.created_by,
          p.full_name as created_by_name,
          ri.product_id,
          ri.product_name,
          ri.quantity,
          ri.unit_price,
          ri.total as return_value
        from public.sales_returns sr
        join public.return_items ri on ri.return_id = sr.id
        left join public.invoices inv on inv.id = sr.invoice_id
        left join public.branches b on b.id = sr.branch_id
        left join public.profiles p on p.id = sr.created_by
        where sr.tenant_id = v_tenant_id
          and sr.status in ('completed', 'confirmed')
          and sr.created_at >= v_from
          and sr.created_at <= v_to
          and (p_branch_id is null or sr.branch_id = p_branch_id)
      ) t
    )
  );
end;
$$;

comment on function public.get_sales_return_report is
  'Báo cáo trả hàng chi tiết: từng dòng item trả + lý do + NV xử lý + chi nhánh. CEO 16/05/2026.';

grant execute on function public.get_sales_return_report(timestamptz, timestamptz, uuid, uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────
-- 2. RPC: get_staff_revenue_report
-- ────────────────────────────────────────────────────────────────
create or replace function public.get_staff_revenue_report(
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_source text default null,
  p_tenant_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid;
  v_from timestamptz;
  v_to timestamptz;
begin
  v_tenant_id := coalesce(
    p_tenant_id,
    (select tenant_id from public.profiles where id = auth.uid())
  );

  if v_tenant_id is null then
    raise exception 'TENANT_NOT_FOUND';
  end if;

  v_from := coalesce(p_date_from, now() - interval '30 days');
  v_to := coalesce(p_date_to, now());

  return jsonb_build_object(
    'generated_at', now(),
    'date_from', v_from,
    'date_to', v_to,
    'source', p_source,
    'tenant_id', v_tenant_id,
    'rows', (
      select coalesce(jsonb_agg(row_to_json(t) order by t.total_revenue desc nulls last), '[]'::jsonb)
      from (
        select
          p.id as staff_id,
          p.full_name as staff_name,
          p.role as staff_role,
          i.branch_id,
          b.name as branch_name,
          i.source,
          count(distinct i.id) as invoice_count,
          coalesce(sum(i.total), 0) as total_revenue,
          coalesce(avg(i.total), 0) as avg_order_value,
          count(distinct i.customer_id) filter (where i.customer_id is not null) as customer_count,
          min(i.created_at) as first_order_at,
          max(i.created_at) as last_order_at
        from public.invoices i
        join public.profiles p on p.id = i.created_by
        left join public.branches b on b.id = i.branch_id
        where i.tenant_id = v_tenant_id
          and i.status = 'completed'
          and i.created_at >= v_from
          and i.created_at <= v_to
          and (p_source is null or i.source = p_source)
        group by p.id, p.full_name, p.role, i.branch_id, b.name, i.source
      ) t
    )
  );
end;
$$;

comment on function public.get_staff_revenue_report is
  'Báo cáo doanh thu nhân viên cross-branch: tổng doanh thu, số đơn, AOV, số khách theo NV × chi nhánh × source. CEO 16/05/2026.';

grant execute on function public.get_staff_revenue_report(timestamptz, timestamptz, text, uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────
-- 3. RPC: get_platform_commission_report
-- ────────────────────────────────────────────────────────────────
create or replace function public.get_platform_commission_report(
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_branch_id uuid default null,
  p_tenant_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid;
  v_from timestamptz;
  v_to timestamptz;
begin
  v_tenant_id := coalesce(
    p_tenant_id,
    (select tenant_id from public.profiles where id = auth.uid())
  );

  if v_tenant_id is null then
    raise exception 'TENANT_NOT_FOUND';
  end if;

  v_from := coalesce(p_date_from, now() - interval '30 days');
  v_to := coalesce(p_date_to, now());

  return jsonb_build_object(
    'generated_at', now(),
    'date_from', v_from,
    'date_to', v_to,
    'tenant_id', v_tenant_id,
    'branch_id', p_branch_id,
    -- Group theo platform × chi nhánh
    'rows', (
      select coalesce(jsonb_agg(row_to_json(t) order by t.commission_total desc nulls last), '[]'::jsonb)
      from (
        select
          coalesce(ko.delivery_platform, 'direct') as platform,
          i.branch_id,
          b.name as branch_name,
          count(distinct i.id) as order_count,
          coalesce(sum(i.subtotal), 0) as gross_revenue,
          coalesce(sum(i.platform_commission), 0) as commission_total,
          coalesce(sum(i.total), 0) as net_revenue,
          case
            when sum(i.subtotal) > 0 then
              round((sum(i.platform_commission) / sum(i.subtotal)) * 100, 2)
            else 0
          end as effective_commission_percent,
          coalesce(avg(i.total), 0) as avg_order_value
        from public.invoices i
        left join public.kitchen_orders ko on ko.invoice_id = i.id
        left join public.branches b on b.id = i.branch_id
        where i.tenant_id = v_tenant_id
          and i.status = 'completed'
          and i.source = 'fnb'
          and i.created_at >= v_from
          and i.created_at <= v_to
          and (p_branch_id is null or i.branch_id = p_branch_id)
        group by ko.delivery_platform, i.branch_id, b.name
      ) t
    ),
    -- Tổng kết toàn kỳ (1 dòng tổng)
    'summary', (
      select row_to_json(s) from (
        select
          count(distinct i.id) as total_orders,
          coalesce(sum(i.subtotal), 0) as total_gross,
          coalesce(sum(i.platform_commission), 0) as total_commission,
          coalesce(sum(i.total), 0) as total_net,
          coalesce(sum(i.subtotal) - sum(i.total), 0) as total_lost_to_platform
        from public.invoices i
        left join public.kitchen_orders ko on ko.invoice_id = i.id
        where i.tenant_id = v_tenant_id
          and i.status = 'completed'
          and i.source = 'fnb'
          and i.created_at >= v_from
          and i.created_at <= v_to
          and (p_branch_id is null or i.branch_id = p_branch_id)
      ) s
    )
  );
end;
$$;

comment on function public.get_platform_commission_report is
  'Báo cáo phí platform delivery: gross vs commission vs net theo platform × chi nhánh. CEO 16/05/2026.';

grant execute on function public.get_platform_commission_report(timestamptz, timestamptz, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
