-- ============================================================
-- 00197: Branch-aware customer cohort aggregation
-- ============================================================

create or replace function public.get_customer_cohort_report(
  p_months integer default 6,
  p_branch_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_tenant_id uuid;
  v_months integer := least(24, greatest(1, coalesce(p_months, 6)));
begin
  perform public.assert_report_access('reports.analytics', p_branch_id);
  perform public.assert_report_access('reports.view_detail', p_branch_id);

  select p.tenant_id into v_tenant_id
  from public.profiles p
  where p.id = v_actor_id
    and coalesce(p.is_active, true);

  return (
    with params as (
      select date_trunc(
        'month',
        timezone('Asia/Ho_Chi_Minh', now())
      )::date as current_month
    ),
    invoice_months as (
      select distinct
        i.customer_id,
        date_trunc(
          'month',
          timezone('Asia/Ho_Chi_Minh', i.created_at)
        )::date as activity_month
      from public.invoices i
      where i.tenant_id = v_tenant_id
        and i.status = 'completed'
        and i.customer_id is not null
        and (p_branch_id is null or i.branch_id = p_branch_id)
    ),
    customer_history as (
      select
        customer_id,
        min(activity_month) as first_month,
        array_agg(activity_month order by activity_month) as active_months
      from invoice_months
      group by customer_id
    ),
    cohort_months as (
      select
        series.n,
        (
          params.current_month
          - make_interval(months => v_months - series.n)
        )::date as cohort_month
      from params
      cross join generate_series(1, v_months) as series(n)
    ),
    cohort_rows as (
      select
        cm.n,
        cm.cohort_month,
        count(ch.customer_id)::integer as cohort_size
      from cohort_months cm
      left join customer_history ch on ch.first_month = cm.cohort_month
      group by cm.n, cm.cohort_month
    )
    select jsonb_build_object(
      'generated_at', now(),
      'tenant_id', v_tenant_id,
      'branch_id', p_branch_id,
      'months_tracked', v_months,
      'rows',
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'cohort_month', to_char(cr.cohort_month, 'YYYY-MM'),
            'label', format(
              'T%s/%s',
              extract(month from cr.cohort_month)::integer,
              extract(year from cr.cohort_month)::integer
            ),
            'size', cr.cohort_size,
            'retention',
            coalesce(
              (
                select jsonb_agg(
                  case
                    when cr.cohort_size = 0 then 0
                    else round(
                      (
                        select count(*)::numeric
                        from customer_history member
                        where member.first_month = cr.cohort_month
                          and (
                            cr.cohort_month
                            + make_interval(months => month_offset.n)
                          )::date = any(member.active_months)
                      ) * 100 / cr.cohort_size,
                      1
                    )
                  end
                  order by month_offset.n
                )
                from generate_series(
                  0,
                  v_months - cr.n
                ) as month_offset(n)
              ),
              '[]'::jsonb
            )
          )
          order by cr.cohort_month
        ),
        '[]'::jsonb
      )
    )
    from cohort_rows cr
  );
end;
$$;

revoke all on function public.get_customer_cohort_report(integer, uuid)
  from public, anon;
grant execute on function public.get_customer_cohort_report(integer, uuid)
  to authenticated;

comment on function public.get_customer_cohort_report(integer, uuid) is
  'All-history first-purchase cohort report, aggregated in PostgreSQL and scoped by effective branch access.';
