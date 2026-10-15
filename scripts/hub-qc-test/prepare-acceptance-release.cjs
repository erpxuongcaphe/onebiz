const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const XLSX = require('xlsx');
const output = process.env.HUB_RELEASE_OUTPUT;
if (!output) throw new Error('HUB_RELEASE_OUTPUT is required');
const expected = {
  'ops_quality_execute(text,jsonb,uuid)': '4d1882b1332b484d58a4237027fd9fcf',
  'ops_quality_execute_core(text,jsonb,uuid)': '07bd18c4b2d88608a13b37a141e27f56',
  'ops_quality_read_core(uuid,text,text,jsonb)': '94f9782e82a894f908f1cdf128a3f532',
};
const backup = XLSX.read(fs.readFileSync(path.join(output, 'production-functions-before-00537.csv'), 'utf8'), { type: 'string', raw: true });
const rows = XLSX.utils.sheet_to_json(backup.Sheets[backup.SheetNames[0]]);
if (rows.length !== 3) throw new Error('Expected exactly three function snapshots');
for (const row of rows) {
  const hash = crypto.createHash('md5').update(row.definition.replace(/\r/g, '')).digest('hex');
  if (hash !== expected[row.function_name]) throw new Error('Function backup hash mismatch: ' + row.function_name);
}
let sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/00539_operations_quality_acceptance_fixes.sql'), 'utf8').replace(/\r/g, '');
sql = sql.slice(sql.indexOf('begin;') + 'begin;'.length).replace(/commit;\s*$/, '');
const guards = Object.entries(expected).map(([name, hash]) =>
  `if md5(replace(pg_get_functiondef('public.${name}'::regprocedure),chr(13),'')) <> '${hash}' then raise exception 'Hub baseline changed: ${name}'; end if;`).join('\n');
const bundle = `begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
select pg_advisory_xact_lock(hashtextextended('onebiz-hub-release-00539',0));
do $guard$ begin
if exists(select 1 from supabase_migrations.schema_migrations where version='00539' or name='operations_quality_acceptance_fixes') then raise exception 'Hub acceptance fixes already registered; do not replay'; end if;
${guards}
end $guard$;
do $release$
declare migration_sql text := $migration$${sql}$migration$;
begin
execute migration_sql;
insert into supabase_migrations.schema_migrations(version,name,statements)
values('00539','operations_quality_acceptance_fixes',array[migration_sql]);
end $release$;
commit;
select version,name from supabase_migrations.schema_migrations where version='00539';
`;
fs.writeFileSync(path.join(output,'APPLY_HUB_00539.sql'),bundle);
fs.writeFileSync(path.join(output,'RESTORE_HUB_FUNCTIONS_BEFORE_00537.sql'),
  "begin;\nset local lock_timeout='3s';\n" + rows.map(row => row.definition + ';').join('\n') + "\nnotify pgrst,'reload schema';\ncommit;\n");
console.log('Verified three production backups; generated atomic release and non-destructive function recovery.');
console.log('SHA256',crypto.createHash('sha256').update(bundle).digest('hex'));
