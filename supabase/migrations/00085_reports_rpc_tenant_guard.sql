-- ============================================================
-- 00085: Cross-tenant guard cho 10 RPC reports (CEO 17/05/2026)
--
-- Tiếp 00084 — guard cho 10 RPC báo cáo Phase A/B/C (00079-00083):
--   1. get_inventory_aging_report
--   2. get_disposal_loss_report
--   3. get_inventory_variance_report
--   4. get_sales_return_report
--   5. get_staff_revenue_report
--   6. get_platform_commission_report
--   7. get_receivable_aging_report
--   8. get_vat_report
--   9. get_rfm_report
--   10. get_fnb_serve_time_report
--
-- Pattern: thay `coalesce(p_tenant_id, profiles.tenant_id)` bằng
-- `_resolve_report_tenant(p_tenant_id)` → nếu caller truyền tenant khác
-- → raise TENANT_MISMATCH. Phòng case attacker chỉnh JS bypass.
-- ============================================================

-- ────────────────────────────────────────────────────────────────
-- 1. get_inventory_aging_report
-- ────────────────────────────────────────────────────────────────
create or replace function public.get_inventory_aging_report(
  p_tenant_id uuid default null,
  p_branch_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_tenant_id uuid := public._resolve_report_tenant(p_tenant_id);
begin
  return jsonb_build_object(
    'generated_at', now(),
    'tenant_id', v_tenant_id,
    'branch_id', p_branch_id,
    'rows', (
      with stock_with_branch as (
        select p.id as product_id, p.code, p.name,
          coalesce(p.cost_price, 0) as cost_price,
          case when p_branch_id is null then coalesce(p.stock, 0)
            else coalesce(bs.quantity, 0) end as current_qty
        from public.products p
        left join public.branch_stock bs on bs.product_id = p.id and bs.branch_id = p_branch_id
        where p.tenant_id = v_tenant_id
      ),
      last_in as (
        select sm.product_id, max(sm.created_at) as last_in_date
        from public.stock_movements sm
        where sm.tenant_id = v_tenant_id and sm.type = 'in'
          and (p_branch_id is null or sm.branch_id = p_branch_id)
        group by sm.product_id
      ),
      last_sale as (
        select ii.product_id, max(i.created_at) as last_sale_date
        from public.invoice_items ii
        join public.invoices i on i.id = ii.invoice_id
        where i.tenant_id = v_tenant_id and i.status = 'completed'
          and (p_branch_id is null or i.branch_id = p_branch_id)
        group by ii.product_id
      )
      select coalesce(jsonb_agg(row_to_json(t) order by t.days_in_stock desc nulls last), '[]'::jsonb)
      from (
        select s.product_id, s.code, s.name, s.current_qty, s.cost_price,
          (s.current_qty * s.cost_price) as stock_value,
          li.last_in_date,
          extract(day from (now() - li.last_in_date))::int as days_in_stock,
          ls.last_sale_date,
          case when ls.last_sale_date is null then null
            else extract(day from (now() - ls.last_sale_date))::int end as days_since_last_sale,
          case when li.last_in_date is null then 'unknown'
            when (now() - li.last_in_date) <= interval '30 days' then '0-30'
            when (now() - li.last_in_date) <= interval '60 days' then '31-60'
            when (now() - li.last_in_date) <= interval '90 days' then '61-90'
            else '91+' end as aging_bucket,
          case when s.current_qty > 0
            and (ls.last_sale_date is null or (now() - ls.last_sale_date) > interval '60 days')
            then true else false end as is_dead_stock
        from stock_with_branch s
        left join last_in li on li.product_id = s.product_id
        left join last_sale ls on ls.product_id = s.product_id
        where s.current_qty > 0
      ) t
    )
  );
end;
$$;
grant execute on function public.get_inventory_aging_report(uuid, uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────
-- 2. get_disposal_loss_report (giữ MoM từ 00083)
-- ────────────────────────────────────────────────────────────────
create or replace function public.get_disposal_loss_report(
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_branch_id uuid default null,
  p_tenant_id uuid default null
) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public._resolve_report_tenant(p_tenant_id);
  v_from timestamptz := coalesce(p_date_from, now() - interval '30 days');
  v_to timestamptz := coalesce(p_date_to, now());
  v_period_len interval := v_to - v_from;
  v_prev_from timestamptz := v_from - v_period_len;
  v_prev_to timestamptz := v_from;
begin
  return jsonb_build_object(
    'generated_at', now(),
    'date_from', v_from, 'date_to', v_to,
    'tenant_id', v_tenant_id, 'branch_id', p_branch_id,
    'previous_period', (
      select row_to_json(p) from (
        select
          coalesce(sum(dei.quantity * coalesce(dei.unit_cost, prod.cost_price, 0)), 0) as total_loss,
          count(distinct de.id) as disposal_count
        from public.disposal_exports de
        join public.disposal_export_items dei on dei.disposal_id = de.id
        left join public.products prod on prod.id = dei.product_id
        where de.tenant_id = v_tenant_id and de.status = 'completed'
          and de.created_at >= v_prev_from and de.created_at < v_prev_to
          and (p_branch_id is null or de.branch_id = p_branch_id)
      ) p
    ),
    'rows', (
      select coalesce(jsonb_agg(row_to_json(t) order by t.loss_value desc nulls last), '[]'::jsonb)
      from (
        select de.id as disposal_id, de.code as disposal_code, de.created_at as disposal_date,
          de.branch_id, b.name as branch_name,
          coalesce(de.reason, 'Không ghi rõ') as reason,
          dei.product_id, dei.product_name, dei.quantity,
          coalesce(dei.unit_cost, p.cost_price, 0) as unit_cost,
          (dei.quantity * coalesce(dei.unit_cost, p.cost_price, 0)) as loss_value,
          de.created_by
        from public.disposal_exports de
        join public.disposal_export_items dei on dei.disposal_id = de.id
        left join public.products p on p.id = dei.product_id
        left join public.branches b on b.id = de.branch_id
        where de.tenant_id = v_tenant_id and de.status = 'completed'
          and de.created_at >= v_from and de.created_at <= v_to
          and (p_branch_id is null or de.branch_id = p_branch_id)
      ) t
    )
  );
end;
$$;
grant execute on function public.get_disposal_loss_report(timestamptz, timestamptz, uuid, uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────
-- 3. get_inventory_variance_report
-- ────────────────────────────────────────────────────────────────
create or replace function public.get_inventory_variance_report(
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_branch_id uuid default null,
  p_tenant_id uuid default null
) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public._resolve_report_tenant(p_tenant_id);
  v_from timestamptz := coalesce(p_date_from, now() - interval '90 days');
  v_to timestamptz := coalesce(p_date_to, now());
begin
  return jsonb_build_object(
    'generated_at', now(),
    'date_from', v_from, 'date_to', v_to,
    'tenant_id', v_tenant_id, 'branch_id', p_branch_id,
    'rows', (
      select coalesce(jsonb_agg(row_to_json(t) order by t.variance_value asc nulls last), '[]'::jsonb)
      from (
        select ic.id as check_id, ic.code as check_code, ic.created_at as check_date,
          ic.branch_id, b.name as branch_name,
          ici.product_id, ici.product_name,
          ici.system_stock, ici.actual_stock, ici.difference,
          coalesce(ici.unit_cost, p.cost_price, 0) as unit_cost,
          (ici.difference * coalesce(ici.unit_cost, p.cost_price, 0)) as variance_value,
          case when ici.difference > 0 then 'thừa'
            when ici.difference < 0 then 'thiếu' else 'khớp' end as variance_type,
          ic.status
        from public.inventory_checks ic
        join public.inventory_check_items ici on ici.check_id = ic.id
        left join public.products p on p.id = ici.product_id
        left join public.branches b on b.id = ic.branch_id
        where ic.tenant_id = v_tenant_id and ic.status = 'balanced'
          and ic.created_at >= v_from and ic.created_at <= v_to
          and (p_branch_id is null or ic.branch_id = p_branch_id)
          and ici.difference <> 0
      ) t
    )
  );
end;
$$;
grant execute on function public.get_inventory_variance_report(timestamptz, timestamptz, uuid, uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────
-- 4. get_sales_return_report
-- ────────────────────────────────────────────────────────────────
create or replace function public.get_sales_return_report(
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_branch_id uuid default null,
  p_tenant_id uuid default null
) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public._resolve_report_tenant(p_tenant_id);
  v_from timestamptz := coalesce(p_date_from, now() - interval '30 days');
  v_to timestamptz := coalesce(p_date_to, now());
begin
  return jsonb_build_object(
    'generated_at', now(),
    'date_from', v_from, 'date_to', v_to,
    'tenant_id', v_tenant_id, 'branch_id', p_branch_id,
    'rows', (
      select coalesce(jsonb_agg(row_to_json(t) order by t.return_date desc), '[]'::jsonb)
      from (
        select sr.id as return_id, sr.code as return_code, sr.created_at as return_date,
          sr.branch_id, b.name as branch_name,
          sr.invoice_id, inv.code as invoice_code, sr.customer_name,
          coalesce(sr.reason, 'Không ghi rõ') as reason,
          sr.status, sr.created_by, p.full_name as created_by_name,
          ri.product_id, ri.product_name, ri.quantity, ri.unit_price,
          ri.total as return_value
        from public.sales_returns sr
        join public.return_items ri on ri.return_id = sr.id
        left join public.invoices inv on inv.id = sr.invoice_id
        left join public.branches b on b.id = sr.branch_id
        left join public.profiles p on p.id = sr.created_by
        where sr.tenant_id = v_tenant_id
          and sr.status in ('completed', 'confirmed')
          and sr.created_at >= v_from and sr.created_at <= v_to
          and (p_branch_id is null or sr.branch_id = p_branch_id)
      ) t
    )
  );
end;
$$;
grant execute on function public.get_sales_return_report(timestamptz, timestamptz, uuid, uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────
-- 5. get_staff_revenue_report
-- ────────────────────────────────────────────────────────────────
create or replace function public.get_staff_revenue_report(
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_source text default null,
  p_branch_id uuid default null,
  p_tenant_id uuid default null
) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public._resolve_report_tenant(p_tenant_id);
  v_from timestamptz := coalesce(p_date_from, now() - interval '30 days');
  v_to timestamptz := coalesce(p_date_to, now());
begin
  return jsonb_build_object(
    'generated_at', now(),
    'date_from', v_from, 'date_to', v_to,
    'source', p_source, 'tenant_id', v_tenant_id, 'branch_id', p_branch_id,
    'rows', (
      select coalesce(jsonb_agg(row_to_json(t) order by t.total_revenue desc nulls last), '[]'::jsonb)
      from (
        select p.id as staff_id, p.full_name as staff_name, p.role as staff_role,
          i.branch_id, b.name as branch_name, i.source,
          count(distinct i.id) as invoice_count,
          coalesce(sum(i.total), 0) as total_revenue,
          coalesce(avg(i.total), 0) as avg_order_value,
          count(distinct i.customer_id) filter (where i.customer_id is not null) as customer_count,
          min(i.created_at) as first_order_at,
          max(i.created_at) as last_order_at
        from public.invoices i
        join public.profiles p on p.id = i.created_by
        left join public.branches b on b.id = i.branch_id
        where i.tenant_id = v_tenant_id and i.status = 'completed'
          and i.created_at >= v_from and i.created_at <= v_to
          and (p_source is null or i.source = p_source)
          and (p_branch_id is null or i.branch_id = p_branch_id)
        group by p.id, p.full_name, p.role, i.branch_id, b.name, i.source
      ) t
    )
  );
end;
$$;
grant execute on function public.get_staff_revenue_report(timestamptz, timestamptz, text, uuid, uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────
-- 6. get_platform_commission_report (giữ MoM từ 00083)
-- ────────────────────────────────────────────────────────────────
create or replace function public.get_platform_commission_report(
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_branch_id uuid default null,
  p_tenant_id uuid default null
) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public._resolve_report_tenant(p_tenant_id);
  v_from timestamptz := coalesce(p_date_from, now() - interval '30 days');
  v_to timestamptz := coalesce(p_date_to, now());
  v_period_len interval := v_to - v_from;
  v_prev_from timestamptz := v_from - v_period_len;
  v_prev_to timestamptz := v_from;
begin
  return jsonb_build_object(
    'generated_at', now(),
    'date_from', v_from, 'date_to', v_to,
    'tenant_id', v_tenant_id, 'branch_id', p_branch_id,
    'rows', (
      select coalesce(jsonb_agg(row_to_json(t) order by t.commission_total desc nulls last), '[]'::jsonb)
      from (
        select coalesce(ko.delivery_platform, 'direct') as platform,
          i.branch_id, b.name as branch_name,
          count(distinct i.id) as order_count,
          coalesce(sum(i.subtotal), 0) as gross_revenue,
          coalesce(sum(i.platform_commission), 0) as commission_total,
          coalesce(sum(i.total), 0) as net_revenue,
          case when sum(i.subtotal) > 0 then
            round((sum(i.platform_commission) / sum(i.subtotal)) * 100, 2)
            else 0 end as effective_commission_percent,
          coalesce(avg(i.total), 0) as avg_order_value
        from public.invoices i
        left join public.kitchen_orders ko on ko.invoice_id = i.id
        left join public.branches b on b.id = i.branch_id
        where i.tenant_id = v_tenant_id and i.status = 'completed' and i.source = 'fnb'
          and i.created_at >= v_from and i.created_at <= v_to
          and (p_branch_id is null or i.branch_id = p_branch_id)
        group by ko.delivery_platform, i.branch_id, b.name
      ) t
    ),
    'summary', (
      select row_to_json(s) from (
        select count(distinct i.id) as total_orders,
          coalesce(sum(i.subtotal), 0) as total_gross,
          coalesce(sum(i.platform_commission), 0) as total_commission,
          coalesce(sum(i.total), 0) as total_net,
          coalesce(sum(i.subtotal) - sum(i.total), 0) as total_lost_to_platform
        from public.invoices i
        left join public.kitchen_orders ko on ko.invoice_id = i.id
        where i.tenant_id = v_tenant_id and i.status = 'completed' and i.source = 'fnb'
          and i.created_at >= v_from and i.created_at <= v_to
          and (p_branch_id is null or i.branch_id = p_branch_id)
      ) s
    ),
    'previous_period', (
      select row_to_json(p) from (
        select count(distinct i.id) as total_orders,
          coalesce(sum(i.subtotal), 0) as total_gross,
          coalesce(sum(i.platform_commission), 0) as total_commission,
          coalesce(sum(i.total), 0) as total_net
        from public.invoices i
        where i.tenant_id = v_tenant_id and i.status = 'completed' and i.source = 'fnb'
          and i.created_at >= v_prev_from and i.created_at < v_prev_to
          and (p_branch_id is null or i.branch_id = p_branch_id)
      ) p
    )
  );
end;
$$;
grant execute on function public.get_platform_commission_report(timestamptz, timestamptz, uuid, uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────
-- 7. get_receivable_aging_report
-- ────────────────────────────────────────────────────────────────
create or replace function public.get_receivable_aging_report(
  p_branch_id uuid default null,
  p_as_of_date timestamptz default null,
  p_tenant_id uuid default null
) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public._resolve_report_tenant(p_tenant_id);
  v_as_of timestamptz := coalesce(p_as_of_date, now());
begin
  return jsonb_build_object(
    'generated_at', now(),
    'as_of_date', v_as_of,
    'tenant_id', v_tenant_id, 'branch_id', p_branch_id,
    'rows', (
      select coalesce(jsonb_agg(row_to_json(t) order by t.outstanding desc nulls last), '[]'::jsonb)
      from (
        with debt_invoices as (
          select i.id, i.code, i.customer_id, i.customer_name, i.branch_id,
            i.total, i.paid, (i.total - i.paid) as outstanding, i.created_at,
            extract(day from (v_as_of - i.created_at))::int as days_old
          from public.invoices i
          where i.tenant_id = v_tenant_id and i.status = 'completed'
            and (i.total - i.paid) > 0 and i.created_at <= v_as_of
            and (p_branch_id is null or i.branch_id = p_branch_id)
        )
        select customer_id, customer_name,
          count(*) as invoice_count, sum(outstanding) as outstanding,
          sum(case when days_old <= 30 then outstanding else 0 end) as bucket_0_30,
          sum(case when days_old between 31 and 60 then outstanding else 0 end) as bucket_31_60,
          sum(case when days_old between 61 and 90 then outstanding else 0 end) as bucket_61_90,
          sum(case when days_old > 90 then outstanding else 0 end) as bucket_91_plus,
          max(days_old) as oldest_days,
          min(created_at) as oldest_invoice_date
        from debt_invoices group by customer_id, customer_name
      ) t
    )
  );
end;
$$;
grant execute on function public.get_receivable_aging_report(uuid, timestamptz, uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────
-- 8. get_vat_report (giữ tax_rate breakdown từ 00083)
-- ────────────────────────────────────────────────────────────────
create or replace function public.get_vat_report(
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_branch_id uuid default null,
  p_tenant_id uuid default null
) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public._resolve_report_tenant(p_tenant_id);
  v_from timestamptz := coalesce(p_date_from, date_trunc('month', now()));
  v_to timestamptz := coalesce(p_date_to, now());
begin
  return jsonb_build_object(
    'generated_at', now(),
    'date_from', v_from, 'date_to', v_to,
    'tenant_id', v_tenant_id, 'branch_id', p_branch_id,
    'output', (
      select row_to_json(o) from (
        select coalesce(sum(i.tax_amount), 0) as total_tax,
          coalesce(sum(i.subtotal), 0) as total_taxable,
          count(*) as invoice_count
        from public.invoices i
        where i.tenant_id = v_tenant_id and i.status = 'completed'
          and i.created_at >= v_from and i.created_at <= v_to
          and (p_branch_id is null or i.branch_id = p_branch_id)
      ) o
    ),
    'input', (
      select row_to_json(i) from (
        select coalesce(sum(po.tax_amount), 0) as total_tax,
          coalesce(sum(po.total - po.tax_amount), 0) as total_taxable,
          count(*) as po_count
        from public.purchase_orders po
        where po.tenant_id = v_tenant_id and po.status = 'completed'
          and po.created_at >= v_from and po.created_at <= v_to
          and (p_branch_id is null or po.branch_id = p_branch_id)
      ) i
    ),
    'output_by_rate', (
      select coalesce(jsonb_agg(row_to_json(t) order by t.tax_rate), '[]'::jsonb)
      from (
        select ii.vat_rate as tax_rate,
          count(distinct ii.invoice_id) as invoice_count,
          coalesce(sum(ii.total - ii.vat_amount), 0) as taxable_amount,
          coalesce(sum(ii.vat_amount), 0) as tax_amount
        from public.invoice_items ii
        join public.invoices i on i.id = ii.invoice_id
        where i.tenant_id = v_tenant_id and i.status = 'completed'
          and i.created_at >= v_from and i.created_at <= v_to
          and (p_branch_id is null or i.branch_id = p_branch_id)
        group by ii.vat_rate
      ) t
    ),
    'input_by_rate', (
      select coalesce(jsonb_agg(row_to_json(t) order by t.tax_rate), '[]'::jsonb)
      from (
        select poi.vat_rate as tax_rate,
          count(distinct poi.order_id) as po_count,
          coalesce(sum(poi.total - poi.vat_amount), 0) as taxable_amount,
          coalesce(sum(poi.vat_amount), 0) as tax_amount
        from public.purchase_order_items poi
        join public.purchase_orders po on po.id = poi.order_id
        where po.tenant_id = v_tenant_id and po.status = 'completed'
          and po.created_at >= v_from and po.created_at <= v_to
          and (p_branch_id is null or po.branch_id = p_branch_id)
        group by poi.vat_rate
      ) t
    ),
    'output_detail', (
      select coalesce(jsonb_agg(row_to_json(t) order by t.created_at desc), '[]'::jsonb)
      from (
        select i.id, i.code, i.created_at, i.customer_name,
          i.subtotal, i.tax_amount, i.total
        from public.invoices i
        where i.tenant_id = v_tenant_id and i.status = 'completed'
          and i.tax_amount > 0
          and i.created_at >= v_from and i.created_at <= v_to
          and (p_branch_id is null or i.branch_id = p_branch_id)
        limit 500
      ) t
    ),
    'input_detail', (
      select coalesce(jsonb_agg(row_to_json(t) order by t.created_at desc), '[]'::jsonb)
      from (
        select po.id, po.code, po.created_at, po.supplier_name,
          po.tax_amount, po.total
        from public.purchase_orders po
        where po.tenant_id = v_tenant_id and po.status = 'completed'
          and po.tax_amount > 0
          and po.created_at >= v_from and po.created_at <= v_to
          and (p_branch_id is null or po.branch_id = p_branch_id)
        limit 500
      ) t
    )
  );
end;
$$;
grant execute on function public.get_vat_report(timestamptz, timestamptz, uuid, uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────
-- 9. get_rfm_report
-- ────────────────────────────────────────────────────────────────
create or replace function public.get_rfm_report(
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_branch_id uuid default null,
  p_tenant_id uuid default null
) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public._resolve_report_tenant(p_tenant_id);
  v_from timestamptz := coalesce(p_date_from, now() - interval '180 days');
  v_to timestamptz := coalesce(p_date_to, now());
begin
  return jsonb_build_object(
    'generated_at', now(),
    'date_from', v_from, 'date_to', v_to,
    'tenant_id', v_tenant_id, 'branch_id', p_branch_id,
    'rows', (
      with customer_stats as (
        select c.id as customer_id, c.code, c.name, c.phone,
          count(distinct i.id) as frequency,
          coalesce(sum(i.total), 0) as monetary,
          max(i.created_at) as last_order_at,
          min(i.created_at) as first_order_at,
          extract(day from (now() - max(i.created_at)))::int as recency_days
        from public.customers c
        join public.invoices i on i.customer_id = c.id
        where c.tenant_id = v_tenant_id and i.status = 'completed'
          and i.created_at >= v_from and i.created_at <= v_to
          and (p_branch_id is null or i.branch_id = p_branch_id)
        group by c.id, c.code, c.name, c.phone
      ),
      ranked as (
        select *,
          ntile(5) over (order by recency_days asc) as r_score,
          ntile(5) over (order by frequency desc) as f_score,
          ntile(5) over (order by monetary desc) as m_score
        from customer_stats
      )
      select coalesce(jsonb_agg(row_to_json(t) order by t.monetary desc), '[]'::jsonb)
      from (
        select customer_id, code, name, phone, frequency, monetary,
          last_order_at, first_order_at, recency_days,
          r_score, f_score, m_score,
          (r_score + f_score + m_score) as rfm_total,
          case when (r_score + f_score + m_score) >= 12 then 'Champion'
            when (r_score + f_score + m_score) >= 9 then 'Loyal'
            when (r_score + f_score + m_score) >= 6 then 'Potential'
            when r_score <= 2 and (f_score + m_score) >= 6 then 'At-risk'
            else 'Lost' end as segment
        from ranked
      ) t
    )
  );
end;
$$;
grant execute on function public.get_rfm_report(timestamptz, timestamptz, uuid, uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────
-- 10. get_fnb_serve_time_report (giữ by_product từ 00083)
-- ────────────────────────────────────────────────────────────────
create or replace function public.get_fnb_serve_time_report(
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_branch_id uuid default null,
  p_tenant_id uuid default null
) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public._resolve_report_tenant(p_tenant_id);
  v_from timestamptz := coalesce(p_date_from, now() - interval '7 days');
  v_to timestamptz := coalesce(p_date_to, now());
begin
  return jsonb_build_object(
    'generated_at', now(),
    'date_from', v_from, 'date_to', v_to,
    'tenant_id', v_tenant_id, 'branch_id', p_branch_id,
    'summary', (
      select row_to_json(s) from (
        with serve_times as (
          select ko.id, ko.created_at as ordered_at,
            max(koi.completed_at) as ready_at,
            extract(epoch from (max(koi.completed_at) - ko.created_at)) / 60 as minutes_to_serve
          from public.kitchen_orders ko
          join public.kitchen_order_items koi on koi.kitchen_order_id = ko.id
          where ko.tenant_id = v_tenant_id and ko.status = 'completed'
            and ko.created_at >= v_from and ko.created_at <= v_to
            and (p_branch_id is null or ko.branch_id = p_branch_id)
            and koi.completed_at is not null
          group by ko.id, ko.created_at
        )
        select count(*) as order_count,
          coalesce(round(avg(minutes_to_serve)::numeric, 2), 0) as avg_minutes,
          coalesce(round(min(minutes_to_serve)::numeric, 2), 0) as min_minutes,
          coalesce(round(max(minutes_to_serve)::numeric, 2), 0) as max_minutes,
          coalesce(round((percentile_cont(0.5) within group (order by minutes_to_serve))::numeric, 2), 0) as median_minutes,
          coalesce(round((percentile_cont(0.9) within group (order by minutes_to_serve))::numeric, 2), 0) as p90_minutes
        from serve_times
      ) s
    ),
    'by_branch', (
      select coalesce(jsonb_agg(row_to_json(t) order by t.avg_minutes desc), '[]'::jsonb)
      from (
        with serve_times as (
          select ko.branch_id, b.name as branch_name,
            extract(epoch from (max(koi.completed_at) - ko.created_at)) / 60 as minutes_to_serve
          from public.kitchen_orders ko
          join public.kitchen_order_items koi on koi.kitchen_order_id = ko.id
          left join public.branches b on b.id = ko.branch_id
          where ko.tenant_id = v_tenant_id and ko.status = 'completed'
            and ko.created_at >= v_from and ko.created_at <= v_to
            and (p_branch_id is null or ko.branch_id = p_branch_id)
            and koi.completed_at is not null
          group by ko.id, ko.created_at, ko.branch_id, b.name
        )
        select branch_id, branch_name, count(*) as order_count,
          round(avg(minutes_to_serve)::numeric, 2) as avg_minutes,
          round((percentile_cont(0.5) within group (order by minutes_to_serve))::numeric, 2) as median_minutes,
          round((percentile_cont(0.9) within group (order by minutes_to_serve))::numeric, 2) as p90_minutes
        from serve_times group by branch_id, branch_name
      ) t
    ),
    'by_product', (
      select coalesce(jsonb_agg(row_to_json(t) order by t.avg_minutes desc), '[]'::jsonb)
      from (
        with item_times as (
          select koi.product_id, koi.product_name,
            extract(epoch from (koi.completed_at - coalesce(koi.started_at, ko.created_at))) / 60 as minutes_to_prep
          from public.kitchen_order_items koi
          join public.kitchen_orders ko on ko.id = koi.kitchen_order_id
          where ko.tenant_id = v_tenant_id
            and ko.created_at >= v_from and ko.created_at <= v_to
            and (p_branch_id is null or ko.branch_id = p_branch_id)
            and koi.completed_at is not null
            and koi.status = 'ready'
        )
        select product_id, product_name, count(*) as serve_count,
          round(avg(minutes_to_prep)::numeric, 2) as avg_minutes,
          round((percentile_cont(0.9) within group (order by minutes_to_prep))::numeric, 2) as p90_minutes
        from item_times
        where minutes_to_prep is not null and minutes_to_prep > 0
        group by product_id, product_name having count(*) >= 3
      ) t
    ),
    'by_hour', (
      select coalesce(jsonb_agg(row_to_json(t) order by t.hour_of_day), '[]'::jsonb)
      from (
        with serve_times as (
          select extract(hour from ko.created_at)::int as hour_of_day,
            extract(epoch from (max(koi.completed_at) - ko.created_at)) / 60 as minutes_to_serve
          from public.kitchen_orders ko
          join public.kitchen_order_items koi on koi.kitchen_order_id = ko.id
          where ko.tenant_id = v_tenant_id and ko.status = 'completed'
            and ko.created_at >= v_from and ko.created_at <= v_to
            and (p_branch_id is null or ko.branch_id = p_branch_id)
            and koi.completed_at is not null
          group by ko.id, ko.created_at
        )
        select hour_of_day, count(*) as order_count,
          round(avg(minutes_to_serve)::numeric, 2) as avg_minutes
        from serve_times group by hour_of_day
      ) t
    )
  );
end;
$$;
grant execute on function public.get_fnb_serve_time_report(timestamptz, timestamptz, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
