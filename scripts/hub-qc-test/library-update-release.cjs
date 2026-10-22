const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../supabase/migrations/20261022110000_operations_library_updates.sql'),'utf8');
const guard=`
do $release_guard$ begin
 if exists(select 1 from supabase_migrations.schema_migrations where version='20261022110000') then
  raise exception 'Hub library update release already recorded; do not rerun';
 end if;
end $release_guard$;
create temporary table hub_library_release_baseline(table_name text primary key, fingerprint text) on commit drop;
do $baseline$ declare table_name text; fingerprint text; begin
 foreach table_name in array array['ops_standards','ops_runs','ops_todos','ops_q_catalog','ops_q_rules','ops_working_libraries','ops_working_library_applications','ops_audit'] loop
  execute format('select md5(coalesce(jsonb_agg(to_jsonb(t)-''ends_on'' order by id),''[]''::jsonb)::text) from public.%I t',table_name) into fingerprint;
  insert into hub_library_release_baseline values(table_name,fingerprint);
 end loop;
end $baseline$;
`;
const registration=`
do $verify$ declare baseline record; actual text; begin
 for baseline in select * from hub_library_release_baseline loop
  execute format('select md5(coalesce(jsonb_agg(to_jsonb(t)-''ends_on'' order by id),''[]''::jsonb)::text) from public.%I t',baseline.table_name) into actual;
  if actual is distinct from baseline.fingerprint then raise exception 'Hub data changed during release: %; rollback',baseline.table_name; end if;
 end loop;
end $verify$;
insert into supabase_migrations.schema_migrations(version,name,statements)
values('20261022110000','operations_library_updates',array['Reviewed Hub library update release 2026-10-22']::text[]);
commit;
select version,name from supabase_migrations.schema_migrations where version='20261022110000';
`;
if(!source.includes("set local statement_timeout = '30s';")||!source.trimEnd().endsWith('commit;'))throw Error('Release source boundary changed');
const sql=source.replace("set local statement_timeout = '30s';","set local statement_timeout = '30s';"+guard).replace(/commit;\s*$/,registration);
module.exports={sql};
if(require.main===module){const target=process.argv[2];if(!target)throw Error('Output file is required');fs.writeFileSync(target,sql);console.log('Prepared atomic release without executing SQL:',target);}
