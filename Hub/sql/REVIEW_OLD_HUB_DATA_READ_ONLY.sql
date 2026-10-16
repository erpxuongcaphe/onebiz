-- READ ONLY. A legacy suggestion ID is NOT proof of disposable test data.
-- Do not turn this report into a bulk DELETE. Review exact IDs and dependencies.
begin read only;
set local statement_timeout='10s';
select s.id,s.tenant_id,b.name as branch,s.title,s.status,s.created_at,
 p.full_name as created_by,s.criteria,
 (select count(*) from public.ops_runs r where r.standard_id=s.id) as scheduled_runs,
 (select count(*) from public.ops_q_checks c where c.standard_snapshot->>'standardId'=s.id::text) as checks,
 (select count(*) from public.ops_q_catalog c where c.standard_id=s.id) as qc_versions,
 (select count(*) from public.ops_q_lines l join public.ops_q_catalog c on c.id=l.item_id where c.standard_id=s.id) as qc_lines,
 exists(select 1 from jsonb_array_elements(s.criteria) c where c->>'id' ~ '^(space-|drinks-|people-|service-|goods-loss|labor-schedule)') as uses_legacy_suggestion
from public.ops_standards s
join public.branches b on b.id=s.branch_id and b.tenant_id=s.tenant_id
left join public.profiles p on p.id=s.created_by and p.tenant_id=s.tenant_id
order by s.created_at,s.id;
commit;
