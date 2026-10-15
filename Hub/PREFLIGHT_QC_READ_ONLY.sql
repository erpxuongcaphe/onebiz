-- OneBiz Hub QC: catalog-only preflight. No business functions or writes.
begin read only;
set local statement_timeout = '10s';
set local lock_timeout = '2s';

select current_setting('server_version') as postgres_version;

with required(name) as (
  values ('profiles'), ('ops_standards'), ('ops_runs'), ('ops_todos'),
    ('ops_evidence'), ('ops_q_catalog'), ('ops_q_rules'), ('ops_q_checks'),
    ('ops_q_issues'), ('ops_q_sources'), ('ops_q_rechecks'), ('ops_q_audits'),
    ('ops_q_lines'), ('ops_q_events'), ('ops_q_corrections'),
    ('ops_q_accounting'), ('ops_q_settlements'), ('ops_q_assignments'),
    ('ops_q_departments'), ('ops_q_grants')
)
select r.name as table_name, c.oid is not null as exists,
  c.relrowsecurity as rls_enabled,
  case when c.oid is not null then
    has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,DELETE')
  end as authenticated_has_direct_write
from required r
left join pg_namespace n on n.nspname = 'public'
left join pg_class c on c.relnamespace = n.oid and c.relname = r.name
  and c.relkind in ('r', 'p')
order by r.name;

select p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  p.prosecdef as security_definer,
  p.proconfig as function_settings,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (p.proname like 'ops_q_%' or p.proname in
    ('ops_execute', 'ops_workspace', 'ops_can', 'ops_evidence_reserve'))
order by p.proname, arguments
limit 100;

select schemaname, tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'public' and tablename like 'ops_q_%'
order by tablename, policyname
limit 100;

-- Empty new tables/policies before activation are expected, not authorization.
-- Compare this output with reviewed migrations before deciding to apply SQL.
rollback;
