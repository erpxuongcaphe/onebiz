-- Read-only report corrections. Preserve function signatures, guards and ACLs.
begin;

do $migration$
declare
  v_name text;
  v_oid oid;
  v_definition text;
  v_old text;
  v_new text;
  v_index integer;
  v_anchors text[];
  v_replacements text[];
begin
  foreach v_name in array array[
    'get_rfm_report_unsecured_legacy',
    'get_fnb_serve_time_report_unsecured_legacy',
    'get_finance_dashboard_report'
  ] loop
    if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = v_name) <> 1 then
      raise exception 'Expected exactly one public.% function', v_name;
    end if;
    select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = v_name;
    v_definition := pg_get_functiondef(v_oid);
    if v_name = 'get_rfm_report_unsecured_legacy' then
      v_anchors := array[
        'ntile(5) over (order by recency_days asc) as r_score',
        'ntile(5) over (order by frequency desc) as f_score',
        'ntile(5) over (order by monetary desc) as m_score'
      ];
      v_replacements := array[
        '(5 - least(4, floor(percent_rank() over (order by recency_days asc) * 5)::integer)) as r_score',
        '(5 - least(4, floor(percent_rank() over (order by frequency desc) * 5)::integer)) as f_score',
        '(5 - least(4, floor(percent_rank() over (order by monetary desc) * 5)::integer)) as m_score'
      ];
    elsif v_name = 'get_fnb_serve_time_report_unsecured_legacy' then
      v_anchors := array['extract(hour from ko.created_at)::int as hour_of_day'];
      v_replacements := array['extract(hour from timezone(''Asia/Ho_Chi_Minh'', ko.created_at))::int as hour_of_day'];
    else
      v_anchors := array[
        'v_bucket_start := date_trunc(v_granularity, p_current_from);',
        'v_bucket_end := least(v_bucket_start + v_step, p_current_to);',
        'v_bucket_start := v_bucket_start + v_step;'
      ];
      v_replacements := array[
        'v_bucket_start := date_trunc(v_granularity, timezone(''Asia/Ho_Chi_Minh'', p_current_from)) at time zone ''Asia/Ho_Chi_Minh'';',
        'v_bucket_end := least((timezone(''Asia/Ho_Chi_Minh'', v_bucket_start) + v_step) at time zone ''Asia/Ho_Chi_Minh'', p_current_to);',
        'v_bucket_start := (timezone(''Asia/Ho_Chi_Minh'', v_bucket_start) + v_step) at time zone ''Asia/Ho_Chi_Minh'';'
      ];
    end if;
    for v_index in 1..array_length(v_anchors, 1) loop
      v_old := v_anchors[v_index];
      v_new := v_replacements[v_index];
      if strpos(v_definition, v_new) > 0 and strpos(v_definition, v_old) = 0 then
        continue;
      end if;
      if (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old) <> 1 then
        raise exception 'Unexpected report definition: % anchor %', v_name, v_index;
      end if;
      v_definition := replace(v_definition, v_old, v_new);
    end loop;
    execute v_definition;
  end loop;
end;
$migration$;

commit;
