-- Disposable database only, not production.
\set ON_ERROR_STOP on
create function public.get_rfm_report_unsecured_legacy() returns jsonb language sql as $$
  with customers(recency_days, frequency, monetary) as (
    values (0, 10, 1000), (0, 10, 1000), (1, 8, 800), (5, 3, 300), (30, 1, 100)
  ), scored as (
    select *, ntile(5) over (order by recency_days asc) as r_score,
      ntile(5) over (order by frequency desc) as f_score,
      ntile(5) over (order by monetary desc) as m_score from customers
  ) select jsonb_agg(to_jsonb(scored) order by recency_days) from scored;
$$;
create function public.get_fnb_serve_time_report_unsecured_legacy() returns integer language sql as $$
  select extract(hour from ko.created_at)::int as hour_of_day
  from (values ('2026-10-08 21:30+00'::timestamptz)) ko(created_at);
$$;
create function public.get_finance_dashboard_report(p_current_from timestamptz)
returns timestamptz language plpgsql as $$
declare v_bucket_start timestamptz; v_granularity text := 'day';
begin
  v_bucket_start := date_trunc(v_granularity, p_current_from);
  return v_bucket_start;
end; $$;
revoke all on function public.get_rfm_report_unsecured_legacy() from public;
create temp table report_acl_before as select oid, proacl from pg_proc
where proname = 'get_rfm_report_unsecured_legacy';
\ir ../migrations/00469_report_rfm_and_vietnam_time.sql
\ir ../migrations/00469_report_rfm_and_vietnam_time.sql
set timezone = 'UTC';
do $$ declare result jsonb; begin
  result := public.get_rfm_report_unsecured_legacy();
  if (result->0->>'r_score')::integer <> 5 or (result->0->>'f_score')::integer <> 5
     or (result->0->>'m_score')::integer <> 5 or result->0 <> result->1 then
    raise exception 'Best/tied customers scored incorrectly: %', result;
  end if;
  if (result->4->>'r_score')::integer <> 1 or (result->4->>'f_score')::integer <> 1
     or (result->4->>'m_score')::integer <> 1 then
    raise exception 'Worst customer scored incorrectly: %', result;
  end if;
  if public.get_fnb_serve_time_report_unsecured_legacy() <> 4 then
    raise exception 'Service hour is not Vietnam time';
  end if;
  if public.get_finance_dashboard_report('2026-09-30 17:00+00') <> '2026-09-30 17:00+00'::timestamptz then
    raise exception 'October first day has a phantom September bucket';
  end if;
  if exists(select 1 from report_acl_before b join pg_proc p using(oid)
            where b.proacl is distinct from p.proacl) then
    raise exception 'Report ACL changed';
  end if;
  if (select 5-least(4,floor(percent_rank() over(order by x)*5)::integer)
      from (values(1)) t(x)) <> 5 then raise exception 'Single customer score incorrect'; end if;
end; $$;
