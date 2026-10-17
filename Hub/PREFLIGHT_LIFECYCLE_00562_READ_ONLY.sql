-- Read only. Run before release review; never apply the migration from this file.
begin transaction read only;
set local statement_timeout='10s';
select oid::regprocedure::text as function_name,md5(replace(prosrc,chr(13),'')) as checksum
from pg_proc where pronamespace='public'::regnamespace and
 (proname in ('ops_execute','ops_quality_execute','ops_evidence_reserve','ops_generate_internal','ops_history',
  'ops_execute_core','ops_workspace','ops_filtered_page','ops_reward_snapshot','ops_tick','ops_measurements_for')
  or proname like 'ops_quality_read%') order by proname;
select jsonb_build_object(
 'standards',(select count(*) from public.ops_standards),
 'runs',(select count(*) from public.ops_runs),
 'checks',(select count(*) from public.ops_q_checks),
 'todos',(select count(*) from public.ops_todos),
 'score_events',(select count(*) from public.ops_q_events),
 'closed_periods',(select count(*) from public.ops_periods),
 'impact_rpc',to_regprocedure('public.ops_schedule_impact(uuid,date)') is not null,
 'new_columns',(select coalesce(jsonb_agg(attname order by attname),'[]') from pg_attribute
  where attrelid in ('public.ops_standards'::regclass,'public.ops_runs'::regclass) and not attisdropped
   and attname in ('stop_after','current_due_at','schedule_canceled_at','schedule_cancel_reason'))
) as release_baseline;
select version,name from supabase_migrations.schema_migrations where version>='00560' order by version;
commit;
