const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'supabase/migrations/00561_operations_recurrence.sql'), 'utf8');
if (!source.trimEnd().endsWith('commit;')) throw Error('Missing transaction boundary');
const preservation = `
create temp table hub_recurrence_before on commit drop as
select 'standards' kind,id,to_jsonb(s) value from public.ops_standards s
union all select 'libraries',id,to_jsonb(l) from public.ops_working_libraries l
union all select 'applications',id,to_jsonb(a) from public.ops_working_library_applications a;
`;
const verify = `
do $preserved$
begin
 if exists (
  select 1 from hub_recurrence_before b left join (
   select 'standards' kind,id,to_jsonb(s)-'month_number'-'effective_until' value from public.ops_standards s
   union all select 'libraries',id,to_jsonb(l) from public.ops_working_libraries l
   union all select 'applications',id,to_jsonb(a) from public.ops_working_library_applications a
  ) a using(kind,id) where a.value is distinct from b.value
 ) then raise exception 'Hub existing data changed; abort release'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='00561') then
  raise exception 'Migration 00561 is already recorded; do not repeat';
 end if;
end $preserved$;
insert into supabase_migrations.schema_migrations(version,name,statements)
values('00561','operations_recurrence',array[$source00561$${source}$source00561$]);
commit;
select version,name from supabase_migrations.schema_migrations where version='00561';
`;
const sql = source.replace("set local statement_timeout='30s';", "set local statement_timeout='30s';" + preservation).replace(/commit;\s*$/, verify);
if (require.main === module) {
 const target = path.resolve(process.argv[2] || '');
 if (!target.startsWith(root + path.sep + '.tmp' + path.sep) && !target.startsWith('C:\\Users\\ADMIN\\Documents\\Codex\\')) throw Error('Use the dedicated release output directory');
 fs.mkdirSync(path.dirname(target), { recursive: true });
 fs.writeFileSync(target, sql);
 console.log('Generated atomic recurrence release with baseline and data preservation guards.');
}
module.exports = { sql };
