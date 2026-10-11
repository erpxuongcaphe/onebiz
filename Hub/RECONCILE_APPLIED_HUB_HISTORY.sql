-- Approved 11/10/2026: metadata only. Hub SQL was already applied through SQL Editor.
-- Never execute the eight Hub migration bodies again on this database.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
do $$
declare n integer;
begin
  select count(*) into n from pg_class c join pg_namespace ns on ns.oid=c.relnamespace
  where ns.nspname='public' and c.relname in
    ('ops_members','ops_standards','ops_runs','ops_todos','ops_todo_links','ops_revenues',
     'ops_targets','ops_reward_policies','ops_periods','ops_audit','ops_remediations',
     'ops_requests','ops_evidence','ops_notifications','ops_scheduler_state',
     'ops_period_adjustments','ops_measurements','ops_mkt_links') and c.relrowsecurity;
  if n <> 18 then raise exception 'Hub schema/RLS verification failed'; end if;
  if not exists(select 1 from storage.buckets where id='operations-evidence' and not public and file_size_limit=5242880)
    then raise exception 'Hub private bucket verification failed'; end if;
  if exists(select 1 from supabase_migrations.schema_migrations where version in
    ('00501','00502','00503','00504','00505','00506','00507','00508'))
    then raise exception 'Target history exists; inspect before reconciliation'; end if;
end $$;
insert into supabase_migrations.schema_migrations(version,name,statements) values
 ('00501','operations_hub',array['-- Applied via SQL Editor as 00301_operations_hub.sql; history reconciled only.']),
 ('00502','operations_evidence',array['-- Applied via SQL Editor as 00302_operations_evidence.sql; history reconciled only.']),
 ('00503','operations_scheduler',array['-- Applied via SQL Editor as 00303_operations_scheduler.sql; scheduler state RLS verified.']),
 ('00504','operations_period_adjustments',array['-- Applied via SQL Editor as 00304_operations_period_adjustments.sql; history reconciled only.']),
 ('00505','operations_todo_paging',array['-- Applied via SQL Editor as 00305_operations_todo_paging.sql; history reconciled only.']),
 ('00506','operations_result_adjustments',array['-- Applied via SQL Editor as 00306_operations_result_adjustments.sql; history reconciled only.']),
 ('00507','operations_measurements',array['-- Applied via SQL Editor as 00307_operations_measurements.sql; history reconciled only.']),
 ('00508','operations_mkt_links',array['-- Applied via SQL Editor as 00308_operations_mkt_links.sql; history reconciled only.']);
commit;
