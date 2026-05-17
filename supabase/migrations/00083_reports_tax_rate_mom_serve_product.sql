-- ============================================================
-- 00083: Phase audit fix — tax_rate breakdown + MoM + serve by product (CEO 16/05/2026)
--
-- 4 update:
--   1. get_vat_report: thêm breakdown theo tax_rate (0%/5%/8%/10%) cho CFO khai tờ 01/GTGT
--   2. get_disposal_loss_report: thêm so sánh với kỳ trước (MoM)
--   3. get_platform_commission_report: thêm MoM cho commission
--   4. get_fnb_serve_time_report: thêm aggregation theo món (product) — COO biết món nào pha lâu nhất
-- ============================================================

-- ────────────────────────────────────────────────────────────────
-- 1. get_vat_report — thêm output_by_rate + input_by_rate
-- ────────────────────────────────────────────────────────────────
drop function if exists public.get_vat_report(timestamptz, timestamptz, uuid, uuid);

create or replace function public.get_vat_report(
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
  if v_tenant_id is null then raise exception 'TENANT_NOT_FOUND'; end if;
  v_from := coalesce(p_date_from, date_trunc('month', now()));
  v_to := coalesce(p_date_to, now());

  return jsonb_build_object(
    'generated_at', now(),
    'date_from', v_from,
    'date_to', v_to,
    'tenant_id', v_tenant_id,
    'branch_id', p_branch_id,
    'output', (
      select row_to_json(o) from (
        select
          coalesce(sum(i.tax_amount), 0) as total_tax,
          coalesce(sum(i.subtotal), 0) as total_taxable,
          count(*) as invoice_count
        from public.invoices i
        where i.tenant_id = v_tenant_id
          and i.status = 'completed'
          and i.created_at >= v_from and i.created_at <= v_to
          and (p_branch_id is null or i.branch_id = p_branch_id)
      ) o
    ),
    'input', (
      select row_to_json(i) from (
        select
          coalesce(sum(po.tax_amount), 0) as total_tax,
          coalesce(sum(po.total - po.tax_amount), 0) as total_taxable,
          count(*) as po_count
        from public.purchase_orders po
        where po.tenant_id = v_tenant_id
          and po.status = 'completed'
          and po.created_at >= v_from and po.created_at <= v_to
          and (p_branch_id is null or po.branch_id = p_branch_id)
      ) i
    ),
    -- VAT đầu ra theo từng thuế suất — CFO khai tờ 01/GTGT
    'output_by_rate', (
      select coalesce(jsonb_agg(row_to_json(t) order by t.tax_rate), '[]'::jsonb)
      from (
        select
          ii.vat_rate as tax_rate,
          count(distinct ii.invoice_id) as invoice_count,
          coalesce(sum(ii.total - ii.vat_amount), 0) as taxable_amount,
          coalesce(sum(ii.vat_amount), 0) as tax_amount
        from public.invoice_items ii
        join public.invoices i on i.id = ii.invoice_id
        where i.tenant_id = v_tenant_id
          and i.status = 'completed'
          and i.created_at >= v_from and i.created_at <= v_to
          and (p_branch_id is null or i.branch_id = p_branch_id)
        group by ii.vat_rate
      ) t
    ),
    -- VAT đầu vào theo từng thuế suất
    'input_by_rate', (
      select coalesce(jsonb_agg(row_to_json(t) order by t.tax_rate), '[]'::jsonb)
      from (
        select
          poi.vat_rate as tax_rate,
          count(distinct poi.order_id) as po_count,
          coalesce(sum(poi.total - poi.vat_amount), 0) as taxable_amount,
          coalesce(sum(poi.vat_amount), 0) as tax_amount
        from public.purchase_order_items poi
        join public.purchase_orders po on po.id = poi.order_id
        where po.tenant_id = v_tenant_id
          and po.status = 'completed'
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
        where i.tenant_id = v_tenant_id
          and i.status = 'completed'
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
        where po.tenant_id = v_tenant_id
          and po.status = 'completed'
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
-- 2. get_disposal_loss_report — thêm previous_period_total
-- ────────────────────────────────────────────────────────────────
drop function if exists public.get_disposal_loss_report(timestamptz, timestamptz, uuid, uuid);

create or replace function public.get_disposal_loss_report(
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
  v_period_len interval;
  v_prev_from timestamptz;
  v_prev_to timestamptz;
begin
  v_tenant_id := coalesce(
    p_tenant_id,
    (select tenant_id from public.profiles where id = auth.uid())
  );
  if v_tenant_id is null then raise exception 'TENANT_NOT_FOUND'; end if;
  v_from := coalesce(p_date_from, now() - interval '30 days');
  v_to := coalesce(p_date_to, now());
  v_period_len := v_to - v_from;
  v_prev_from := v_from - v_period_len;
  v_prev_to := v_from;

  return jsonb_build_object(
    'generated_at', now(),
    'date_from', v_from,
    'date_to', v_to,
    'tenant_id', v_tenant_id,
    'branch_id', p_branch_id,
    -- MoM: tổng tổn thất kỳ trước cùng độ dài
    'previous_period', (
      select row_to_json(p) from (
        select
          coalesce(sum(dei.quantity * coalesce(dei.unit_cost, prod.cost_price, 0)), 0) as total_loss,
          count(distinct de.id) as disposal_count
        from public.disposal_exports de
        join public.disposal_export_items dei on dei.disposal_id = de.id
        left join public.products prod on prod.id = dei.product_id
        where de.tenant_id = v_tenant_id
          and de.status = 'completed'
          and de.created_at >= v_prev_from and de.created_at < v_prev_to
          and (p_branch_id is null or de.branch_id = p_branch_id)
      ) p
    ),
    'rows', (
      select coalesce(jsonb_agg(row_to_json(t) order by t.loss_value desc nulls last), '[]'::jsonb)
      from (
        select
          de.id as disposal_id,
          de.code as disposal_code,
          de.created_at as disposal_date,
          de.branch_id,
          b.name as branch_name,
          coalesce(de.reason, 'Không ghi rõ') as reason,
          dei.product_id,
          dei.product_name,
          dei.quantity,
          coalesce(dei.unit_cost, p.cost_price, 0) as unit_cost,
          (dei.quantity * coalesce(dei.unit_cost, p.cost_price, 0)) as loss_value,
          de.created_by
        from public.disposal_exports de
        join public.disposal_export_items dei on dei.disposal_id = de.id
        left join public.products p on p.id = dei.product_id
        left join public.branches b on b.id = de.branch_id
        where de.tenant_id = v_tenant_id
          and de.status = 'completed'
          and de.created_at >= v_from
          and de.created_at <= v_to
          and (p_branch_id is null or de.branch_id = p_branch_id)
      ) t
    )
  );
end;
$$;

grant execute on function public.get_disposal_loss_report(timestamptz, timestamptz, uuid, uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────
-- 3. get_platform_commission_report — thêm previous_period
-- ────────────────────────────────────────────────────────────────
drop function if exists public.get_platform_commission_report(timestamptz, timestamptz, uuid, uuid);

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
  v_period_len interval;
  v_prev_from timestamptz;
  v_prev_to timestamptz;
begin
  v_tenant_id := coalesce(
    p_tenant_id,
    (select tenant_id from public.profiles where id = auth.uid())
  );
  if v_tenant_id is null then raise exception 'TENANT_NOT_FOUND'; end if;
  v_from := coalesce(p_date_from, now() - interval '30 days');
  v_to := coalesce(p_date_to, now());
  v_period_len := v_to - v_from;
  v_prev_from := v_from - v_period_len;
  v_prev_to := v_from;

  return jsonb_build_object(
    'generated_at', now(),
    'date_from', v_from,
    'date_to', v_to,
    'tenant_id', v_tenant_id,
    'branch_id', p_branch_id,
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
    ),
    -- MoM: commission kỳ trước
    'previous_period', (
      select row_to_json(p) from (
        select
          count(distinct i.id) as total_orders,
          coalesce(sum(i.subtotal), 0) as total_gross,
          coalesce(sum(i.platform_commission), 0) as total_commission,
          coalesce(sum(i.total), 0) as total_net
        from public.invoices i
        where i.tenant_id = v_tenant_id
          and i.status = 'completed'
          and i.source = 'fnb'
          and i.created_at >= v_prev_from
          and i.created_at < v_prev_to
          and (p_branch_id is null or i.branch_id = p_branch_id)
      ) p
    )
  );
end;
$$;

grant execute on function public.get_platform_commission_report(timestamptz, timestamptz, uuid, uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────
-- 4. get_fnb_serve_time_report — thêm by_product
-- ────────────────────────────────────────────────────────────────
drop function if exists public.get_fnb_serve_time_report(timestamptz, timestamptz, uuid, uuid);

create or replace function public.get_fnb_serve_time_report(
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
  if v_tenant_id is null then raise exception 'TENANT_NOT_FOUND'; end if;
  v_from := coalesce(p_date_from, now() - interval '7 days');
  v_to := coalesce(p_date_to, now());

  return jsonb_build_object(
    'generated_at', now(),
    'date_from', v_from,
    'date_to', v_to,
    'tenant_id', v_tenant_id,
    'branch_id', p_branch_id,
    'summary', (
      select row_to_json(s) from (
        with serve_times as (
          select
            ko.id,
            ko.created_at as ordered_at,
            max(koi.completed_at) as ready_at,
            extract(epoch from (max(koi.completed_at) - ko.created_at)) / 60 as minutes_to_serve
          from public.kitchen_orders ko
          join public.kitchen_order_items koi on koi.kitchen_order_id = ko.id
          where ko.tenant_id = v_tenant_id
            and ko.status = 'completed'
            and ko.created_at >= v_from
            and ko.created_at <= v_to
            and (p_branch_id is null or ko.branch_id = p_branch_id)
            and koi.completed_at is not null
          group by ko.id, ko.created_at
        )
        select
          count(*) as order_count,
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
          select
            ko.branch_id,
            b.name as branch_name,
            extract(epoch from (max(koi.completed_at) - ko.created_at)) / 60 as minutes_to_serve
          from public.kitchen_orders ko
          join public.kitchen_order_items koi on koi.kitchen_order_id = ko.id
          left join public.branches b on b.id = ko.branch_id
          where ko.tenant_id = v_tenant_id
            and ko.status = 'completed'
            and ko.created_at >= v_from
            and ko.created_at <= v_to
            and (p_branch_id is null or ko.branch_id = p_branch_id)
            and koi.completed_at is not null
          group by ko.id, ko.created_at, ko.branch_id, b.name
        )
        select
          branch_id, branch_name,
          count(*) as order_count,
          round(avg(minutes_to_serve)::numeric, 2) as avg_minutes,
          round((percentile_cont(0.5) within group (order by minutes_to_serve))::numeric, 2) as median_minutes,
          round((percentile_cont(0.9) within group (order by minutes_to_serve))::numeric, 2) as p90_minutes
        from serve_times
        group by branch_id, branch_name
      ) t
    ),
    -- COO 16/05: thêm by_product — món nào pha lâu nhất
    'by_product', (
      select coalesce(jsonb_agg(row_to_json(t) order by t.avg_minutes desc), '[]'::jsonb)
      from (
        with item_times as (
          select
            koi.product_id,
            koi.product_name,
            extract(epoch from (koi.completed_at - coalesce(koi.started_at, ko.created_at))) / 60 as minutes_to_prep
          from public.kitchen_order_items koi
          join public.kitchen_orders ko on ko.id = koi.kitchen_order_id
          where ko.tenant_id = v_tenant_id
            and ko.created_at >= v_from
            and ko.created_at <= v_to
            and (p_branch_id is null or ko.branch_id = p_branch_id)
            and koi.completed_at is not null
            and koi.status = 'ready'
        )
        select
          product_id,
          product_name,
          count(*) as serve_count,
          round(avg(minutes_to_prep)::numeric, 2) as avg_minutes,
          round((percentile_cont(0.9) within group (order by minutes_to_prep))::numeric, 2) as p90_minutes
        from item_times
        where minutes_to_prep is not null and minutes_to_prep > 0
        group by product_id, product_name
        having count(*) >= 3  -- chỉ tính món được pha >= 3 lần để tránh outlier
      ) t
    ),
    'by_hour', (
      select coalesce(jsonb_agg(row_to_json(t) order by t.hour_of_day), '[]'::jsonb)
      from (
        with serve_times as (
          select
            extract(hour from ko.created_at)::int as hour_of_day,
            extract(epoch from (max(koi.completed_at) - ko.created_at)) / 60 as minutes_to_serve
          from public.kitchen_orders ko
          join public.kitchen_order_items koi on koi.kitchen_order_id = ko.id
          where ko.tenant_id = v_tenant_id
            and ko.status = 'completed'
            and ko.created_at >= v_from
            and ko.created_at <= v_to
            and (p_branch_id is null or ko.branch_id = p_branch_id)
            and koi.completed_at is not null
          group by ko.id, ko.created_at
        )
        select
          hour_of_day,
          count(*) as order_count,
          round(avg(minutes_to_serve)::numeric, 2) as avg_minutes
        from serve_times
        group by hour_of_day
      ) t
    )
  );
end;
$$;

grant execute on function public.get_fnb_serve_time_report(timestamptz, timestamptz, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
