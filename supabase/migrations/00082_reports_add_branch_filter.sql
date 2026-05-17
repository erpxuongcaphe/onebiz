-- ============================================================
-- 00082: Thêm branch_id param cho 4 RPC báo cáo Phase B+C (CEO 16/05/2026 sau audit)
--
-- Lý do: 4 báo cáo dưới chưa hỗ trợ filter branch — store manager không xem
-- được dữ liệu riêng chi nhánh mình (sai nguyên tắc multi-tenant).
--
-- Các RPC được update:
--   1. get_staff_revenue_report
--   2. get_receivable_aging_report
--   3. get_vat_report
--   4. get_rfm_report
-- ============================================================

-- ────────────────────────────────────────────────────────────────
-- 1. get_staff_revenue_report — thêm p_branch_id
-- ────────────────────────────────────────────────────────────────
drop function if exists public.get_staff_revenue_report(timestamptz, timestamptz, text, uuid);

create or replace function public.get_staff_revenue_report(
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_source text default null,
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
  v_from := coalesce(p_date_from, now() - interval '30 days');
  v_to := coalesce(p_date_to, now());

  return jsonb_build_object(
    'generated_at', now(),
    'date_from', v_from,
    'date_to', v_to,
    'source', p_source,
    'tenant_id', v_tenant_id,
    'branch_id', p_branch_id,
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
          and (p_branch_id is null or i.branch_id = p_branch_id)
        group by p.id, p.full_name, p.role, i.branch_id, b.name, i.source
      ) t
    )
  );
end;
$$;

grant execute on function public.get_staff_revenue_report(timestamptz, timestamptz, text, uuid, uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────
-- 2. get_receivable_aging_report — thêm p_branch_id + p_as_of_date
-- ────────────────────────────────────────────────────────────────
drop function if exists public.get_receivable_aging_report(uuid);

create or replace function public.get_receivable_aging_report(
  p_branch_id uuid default null,
  p_as_of_date timestamptz default null,
  p_tenant_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid;
  v_as_of timestamptz;
begin
  v_tenant_id := coalesce(
    p_tenant_id,
    (select tenant_id from public.profiles where id = auth.uid())
  );
  if v_tenant_id is null then raise exception 'TENANT_NOT_FOUND'; end if;
  v_as_of := coalesce(p_as_of_date, now());

  return jsonb_build_object(
    'generated_at', now(),
    'as_of_date', v_as_of,
    'tenant_id', v_tenant_id,
    'branch_id', p_branch_id,
    'rows', (
      select coalesce(jsonb_agg(row_to_json(t) order by t.outstanding desc nulls last), '[]'::jsonb)
      from (
        with debt_invoices as (
          select
            i.id, i.code, i.customer_id, i.customer_name, i.branch_id,
            i.total, i.paid,
            (i.total - i.paid) as outstanding,
            i.created_at,
            extract(day from (v_as_of - i.created_at))::int as days_old
          from public.invoices i
          where i.tenant_id = v_tenant_id
            and i.status = 'completed'
            and (i.total - i.paid) > 0
            and i.created_at <= v_as_of
            and (p_branch_id is null or i.branch_id = p_branch_id)
        )
        select
          customer_id, customer_name,
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

grant execute on function public.get_receivable_aging_report(uuid, timestamptz, uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────
-- 3. get_vat_report — thêm p_branch_id
-- ────────────────────────────────────────────────────────────────
drop function if exists public.get_vat_report(timestamptz, timestamptz, uuid);

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
-- 4. get_rfm_report — thêm p_branch_id
-- ────────────────────────────────────────────────────────────────
drop function if exists public.get_rfm_report(timestamptz, timestamptz, uuid);

create or replace function public.get_rfm_report(
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
  v_from := coalesce(p_date_from, now() - interval '180 days');
  v_to := coalesce(p_date_to, now());

  return jsonb_build_object(
    'generated_at', now(),
    'date_from', v_from,
    'date_to', v_to,
    'tenant_id', v_tenant_id,
    'branch_id', p_branch_id,
    'rows', (
      with customer_stats as (
        select
          c.id as customer_id, c.code, c.name, c.phone,
          count(distinct i.id) as frequency,
          coalesce(sum(i.total), 0) as monetary,
          max(i.created_at) as last_order_at,
          min(i.created_at) as first_order_at,
          extract(day from (now() - max(i.created_at)))::int as recency_days
        from public.customers c
        join public.invoices i on i.customer_id = c.id
        where c.tenant_id = v_tenant_id
          and i.status = 'completed'
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
        select
          customer_id, code, name, phone,
          frequency, monetary, last_order_at, first_order_at,
          recency_days, r_score, f_score, m_score,
          (r_score + f_score + m_score) as rfm_total,
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

grant execute on function public.get_rfm_report(timestamptz, timestamptz, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
