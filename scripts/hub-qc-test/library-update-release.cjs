const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../supabase/migrations/20261022110000_operations_library_updates.sql'),'utf8');
const guard=`
do $release_guard$ begin
 if exists(select 1 from supabase_migrations.schema_migrations where version='20261022110000') then
  raise exception 'Hub library update release already recorded; do not rerun';
 end if;
end $release_guard$;
`;
const registration=`
insert into supabase_migrations.schema_migrations(version,name,statements)
values('20261022110000','operations_library_updates',array['Reviewed Hub library update release 2026-10-22']::text[]);
commit;
select version,name from supabase_migrations.schema_migrations where version='20261022110000';
`;
if(!source.includes("set local statement_timeout = '30s';")||!source.trimEnd().endsWith('commit;'))throw Error('Release source boundary changed');
const sql=source.replace("set local statement_timeout = '30s';","set local statement_timeout = '30s';"+guard).replace(/commit;\s*$/,registration);
module.exports={sql};
if(require.main===module){const target=process.argv[2];if(!target)throw Error('Output file is required');fs.writeFileSync(target,sql);console.log('Prepared atomic release without executing SQL:',target);}
