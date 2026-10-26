const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../supabase/migrations/20261026110000_operations_library_assignments.sql'),'utf8');
if(!source.includes('begin;')||!source.trimEnd().endsWith('commit;'))throw Error('Migration boundary changed');
const baseline=`
do $guard$ begin
 if exists(select 1 from supabase_migrations.schema_migrations where version='20261026110000')
  or to_regprocedure('public.ops_library_assignments_preview(jsonb)') is not null
  or to_regprocedure('public.ops_library_assignments_execute(jsonb,uuid)') is not null then raise exception 'Hub assignment release already exists; inspect before rerun'; end if;
end $guard$;
create temporary table hub_assignment_release_baseline(name text primary key, fingerprint text) on commit drop;
do $baseline$ declare n text; h text; begin
 foreach n in array array['ops_working_libraries','ops_working_library_applications','ops_standards','ops_runs','ops_todos','ops_q_catalog','ops_q_assignments','ops_q_checks','ops_q_events','ops_audit','ops_requests'] loop
  execute format('select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb)::text) from public.%I t',n) into h;
  insert into hub_assignment_release_baseline values(n,h);
 end loop;
end $baseline$;
`;
const verify=`
do $verify$ declare r record; h text; begin
 for r in select * from hub_assignment_release_baseline loop
  execute format('select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb)::text) from public.%I t',r.name) into h;
  if h is distinct from r.fingerprint then raise exception 'Business data changed during installation: %; rollback',r.name; end if;
 end loop;
 if has_function_privilege('anon','public.ops_library_assignments_preview(jsonb)','execute')
  or has_function_privilege('anon','public.ops_library_assignments_execute(jsonb,uuid)','execute') then raise exception 'Anonymous access must remain blocked'; end if;
end $verify$;
insert into supabase_migrations.schema_migrations(version,name,statements)
values('20261026110000','operations_library_assignments',array['Reviewed Hub atomic assignment release 2026-10-26']::text[]);
notify pgrst,'reload schema';
commit;
select version,name from supabase_migrations.schema_migrations where version='20261026110000';
`;
const sql=source.replace('begin;','begin isolation level repeatable read;').replace("set local statement_timeout='30s';","set local statement_timeout='30s';"+baseline).replace(/commit;\s*$/,verify);
module.exports={sql};
if(require.main===module){const output=process.argv[2];if(!output)throw Error('Output file required');fs.writeFileSync(output,sql);console.log('Prepared reviewed SQL:',output);}
