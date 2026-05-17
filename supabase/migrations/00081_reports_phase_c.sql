-- ============================================================
-- 00081: Phase C báo cáo Tài chính + Marketing chi tiết (CEO 16/05/2026)
--
-- 4 báo cáo:
--   1. Công nợ aging buckets (0-30/31-60/61-90/>90) — CFO
--   2. VAT đầu vào / đầu ra theo kỳ — CFO khai thuế tháng
--   3. RFM khách hàng (Recency × Frequency × Monetary) — CMO segment
--   4. Time-to-serve FnB (thời gian pha chế trung bình) — COO
-- ============================================================

-- ────────────────────────────────────────────────────────────────
-- 1. RPC: get_receivable_aging_report (công nợ phải thu)
-- ────────────────────────────────────────────────────────────────
create or replace function public.get_receivable_aging_report(
  p_tenant_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid;
begin
  v_tenant_id := coalesce(
    p_tenant_id,
    (select tenant_id from public.profiles where id = auth.uid())
  );

  if v_tenant_id is null then
    raise exception 'TENANT_NOT_FOUND';
  end if;

  return jsonb_build_object(
    'generated_at', now(),
    'tenant_id', v_tenant_id,
    'rows', (
      select coalesce(jsonb_agg(row_to_json(t) order by t.outstanding desc nulls last), '[]'::jsonb)
      from (
        with debt_invoices as (
          select
            i.id,
            i.code,
            i.customer_id,
            i.customer_name,
            i.total,
            i.paid,
            (i.total - i.paid) as outstanding,
            i.created_at,
            extract(day from (now() - i.created_at))::int as days_old
          from public.invoices i
          where i.tenant_id = v_tenant_id
            and i.status = 'completed'
            and (i.total - i.paid) > 0
        )
        select
          customer_id,
          customer_name,
          count(*) as invoice_count,
          sum(outstanding) as outstanding,
          sum(case when days_old <= 30 then outstanding else 0 end) as bucket_0_30,
          sum(case when days_old between 31 and 60 then outstanding else 0 end) as bucket_31_60,
          sum(case when days_old between 61 and 90 then outstanding else 0 end) as bucket_61_90,
          sum(case when days_old > 90 then outstanding else 0 end) as bucket_91_plus,
          max(days_old) as oldest_days,
          min(created_at) as oldest_invoice_date
        from debt_invoices
        group by customer_id, customer_name
      ) t
    )
  );
end;
$$;

comment on function public.get_receivable_aging_report is
  'Báo cáo aging công nợ phải thu: theo khách hàng + buckets 0-30 / 31-60 / 61-90 / >90 ngày. CFO dùng để gọi đòi. CEO 16/05/2026.';

grant execute on function public.get_receivable_aging_report(uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────
-- 2. RPC: get_vat_report (VAT đầu vào / đầu ra)
-- ────────────────────────────────────────────────────────────────
create or replace function public.get_vat_report(
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
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

  v_from := coalesce(p_date_from, date_trunc('month', now()));
  v_to := coalesce(p_date_to, now());

  return jsonb_build_object(
    'generated_at', now(),
    'date_from', v_from,
    'date_to', v_to,
    'tenant_id', v_tenant_id,
    -- VAT output (bán ra) — từ invoices.tax_amount
    'output', (
      select row_to_json(o) from (
        select
          coalesce(sum(i.tax_amount), 0) as total_tax,
          coalesce(sum(i.subtotal), 0) as total_taxable,
          count(*) as invoice_count
        from public.invoices i
        where i.tenant_id = v_tenant_id
          and i.status = 'completed'
          and i.created_at >= v_from
          and i.created_at <= v_to
      ) o
    ),
    -- VAT input (mua vào) — từ purchase_orders.tax_amount
    'input', (
      select row_to_json(i) from (
        select
          coalesce(sum(po.tax_amount), 0) as total_tax,
          coalesce(sum(po.total - po.tax_amount), 0) as total_taxable,
          count(*) as po_count
        from public.purchase_orders po
        where po.tenant_id = v_tenant_id
          and po.status = 'completed'
          and po.created_at >= v_from
          and po.created_at <= v_to
      ) i
    ),
    -- Chi tiết invoices có VAT (đầu ra)
    'output_detail', (
      select coalesce(jsonb_agg(row_to_json(t) order by t.created_at desc), '[]'::jsonb)
      from (
        select
          i.id,
          i.code,
          i.created_at,
          i.customer_name,
          i.subtotal,
          i.tax_amount,
          i.total
        from public.invoices i
        where i.tenant_id = v_tenant_id
          and i.status = 'completed'
          and i.tax_amount > 0
          and i.created_at >= v_from
          and i.created_at <= v_to
        limit 500
      ) t
    ),
    -- Chi tiết purchase_orders có VAT (đầu vào)
    'input_detail', (
      select coalesce(jsonb_agg(row_to_json(t) order by t.created_at desc), '[]'::jsonb)
      from (
        select
          po.id,
          po.code,
          po.created_at,
          po.supplier_name,
          po.tax_amount,
          po.total
        from public.purchase_orders po
        where po.tenant_id = v_tenant_id
          and po.status = 'completed'
          and po.tax_amount > 0
          and po.created_at >= v_from
          and po.created_at <= v_to
        limit 500
      ) t
    )
  );
end;
$$;

comment on function public.get_vat_report is
  'Báo cáo VAT đầu vào / đầu ra theo kỳ. CFO dùng để khai thuế GTGT hàng tháng. CEO 16/05/2026.';

grant execute on function public.get_vat_report(timestamptz, timestamptz, uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────
-- 3. RPC: get_rfm_report (RFM khách hàng)
-- ────────────────────────────────────────────────────────────────
-- Recency: ngày kể từ đơn cuối (low = good)
-- Frequency: số đơn trong kỳ (high = good)
-- Monetary: tổng tiền đã chi (high = good)
-- Phân khúc: champion / loyal / at-risk / lost (theo ngưỡng %)
create or replace function public.get_rfm_report(
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
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

  -- Default: 180 ngày gần nhất
  v_from := coalesce(p_date_from, now() - interval '180 days');
  v_to := coalesce(p_date_to, now());

  return jsonb_build_object(
    'generated_at', now(),
    'date_from', v_from,
    'date_to', v_to,
    'tenant_id', v_tenant_id,
    'rows', (
      with customer_stats as (
        select
          c.id as customer_id,
          c.code,
          c.name,
          c.phone,
          count(distinct i.id) as frequency,
          coalesce(sum(i.total), 0) as monetary,
          max(i.created_at) as last_order_at,
          min(i.created_at) as first_order_at,
          extract(day from (now() - max(i.created_at)))::int as recency_days
        from public.customers c
        join public.invoices i on i.customer_id = c.id
        where c.tenant_id = v_tenant_id
          and i.status = 'completed'
          and i.created_at >= v_from
          and i.created_at <= v_to
        group by c.id, c.code, c.name, c.phone
      ),
      ranked as (
        select
          *,
          ntile(5) over (order by recency_days asc) as r_score,
          ntile(5) over (order by frequency desc) as f_score,
          ntile(5) over (order by monetary desc) as m_score
        from customer_stats
      )
      select coalesce(jsonb_agg(row_to_json(t) order by t.monetary desc), '[]'::jsonb)
      from (
        select
          customer_id,
          code,
          name,
          phone,
          frequency,
          monetary,
          last_order_at,
          first_order_at,
          recency_days,
          r_score,
          f_score,
          m_score,
          (r_score + f_score + m_score) as rfm_total,
          -- Phân khúc đơn giản theo tổng RFM (max 15)
          case
            when (r_score + f_score + m_score) >= 12 then 'Champion'
            when (r_score + f_score + m_score) >= 9 then 'Loyal'
            when (r_score + f_score + m_score) >= 6 then 'Potential'
            when r_score <= 2 and (f_score + m_score) >= 6 then 'At-risk'
            else 'Lost'
          end as segment
        from ranked
      ) t
    )
  );
end;
$$;

comment on function public.get_rfm_report is
  'Báo cáo RFM khách hàng — Recency × Frequency × Monetary scoring + phân khúc Champion/Loyal/Potential/At-risk/Lost. CMO dùng để target campaign. CEO 16/05/2026.';

grant execute on function public.get_rfm_report(timestamptz, timestamptz, uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────
-- 4. RPC: get_fnb_serve_time_report (Time-to-serve FnB)
-- ────────────────────────────────────────────────────────────────
-- Tính thời gian từ kitchen_order.created_at → max(kitchen_order_items.completed_at)
-- → thời gian phục vụ trung bình theo branch / theo giờ
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

  if v_tenant_id is null then
    raise exception 'TENANT_NOT_FOUND';
  end if;

  v_from := coalesce(p_date_from, now() - interval '7 days');
  v_to := coalesce(p_date_to, now());

  return jsonb_build_object(
    'generated_at', now(),
    'date_from', v_from,
    'date_to', v_to,
    'tenant_id', v_tenant_id,
    'branch_id', p_branch_id,
    -- Tổng quan
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
    -- Theo chi nhánh
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
          branch_id,
          branch_name,
          count(*) as order_count,
          round(avg(minutes_to_serve)::numeric, 2) as avg_minutes,
          round((percentile_cont(0.5) within group (order by minutes_to_serve))::numeric, 2) as median_minutes,
          round((percentile_cont(0.9) within group (order by minutes_to_serve))::numeric, 2) as p90_minutes
        from serve_times
        group by branch_id, branch_name
      ) t
    ),
    -- Theo giờ trong ngày (peak hour)
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

comment on function public.get_fnb_serve_time_report is
  'Báo cáo time-to-serve FnB: thời gian từ tạo đơn → ready (max item.completed_at). Tổng quan + theo CN + theo giờ. COO dùng tối ưu nhân sự. CEO 16/05/2026.';

grant execute on function public.get_fnb_serve_time_report(timestamptz, timestamptz, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
