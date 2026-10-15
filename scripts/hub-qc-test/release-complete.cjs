// Build one guarded, atomic release from the exact reviewed migration sources.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const baseline = {
  'public.ops_quality_execute(text,jsonb,uuid)': '87bc385ff95b15b8675accd74a0b4786',
  'public.ops_quality_execute_core(text,jsonb,uuid)': '7e1d870c6c476df9fd7780b8b3b7ef48',
  'public.ops_quality_read(uuid,text,text,jsonb)': '4a6ad6d4ff07666c323c94793e5c1658',
  'public.ops_quality_read_core(uuid,text,text,jsonb)': 'f48c9b90cb347e13c1c2ef82dadb15e3',
  'public.ops_q_score(uuid,text)': '655a02abd2e313237a1f4a091d3fa499',
  'public.ops_q_rule_errors(jsonb,boolean)': '636ac8717248dedb3ce6b0d9bf25e292',
  'public.ops_q_reconcile(uuid,text)': '1a549a61d5fb51133d99f68f4d6471be',
  'public.ops_q_business(uuid,text)': '84e1c924a8a5dbd1eb333818c0992b5e',
  'public.ops_execute(text,jsonb,uuid)': '9f6203201e6e66a08f94bbb780479fea',
  'public._can_read_branch_inventory_00476(uuid,uuid,uuid)': '14d273585f00878d2223103dc4e4b304',
};
const names = ['00550_operations_complete_foundation.sql', '00551_operations_complete_workflows.sql'];
function build(expected = baseline) {
  const checks = Object.entries(expected).map(([name, hash]) =>
    `if to_regprocedure('${name}') is null or md5(pg_get_functiondef(to_regprocedure('${name}'))) <> '${hash}' then raise exception 'Hub baseline changed: ${name}'; end if;`).join('\n');
  const guard = `begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $guard$ begin
if exists(select 1 from supabase_migrations.schema_migrations where version in ('00550','00551'))
or to_regclass('public.ops_q_periods') is not null or to_regclass('public.ops_q_groups') is not null
or to_regclass('public.ops_q_references') is not null then raise exception 'Hub release already present; do not replay';end if;
if not exists(select 1 from supabase_migrations.schema_migrations where version='00539' and name='operations_quality_acceptance_fixes') then raise exception 'Hub acceptance baseline missing';end if;
${checks}
end $guard$;\n`;
  const files = names.map(name => ({name, sql:fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8')}));
  const body = files.map(({sql}) => sql.replace(/^begin;\r?$/gmi,'').replace(/^commit;\r?$/gmi,'')).join('\n');
  const history = files.map(({name,sql}) => {
    const version=name.slice(0,5), label=name.slice(6,-4), hash=crypto.createHash('sha256').update(sql).digest('hex');
    return `insert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','${label}',array['Applied atomically in SQL Editor; source sha256=${hash}']);`;
  }).join('\n');
  return guard+body+'\n'+history+`\nnotify pgrst,'reload schema';\ncommit;\nselect version,name from supabase_migrations.schema_migrations where version in ('00550','00551') order by version;\n`;
}
module.exports = {build,baseline};
if(require.main===module) {
  const out=process.argv[2];if(!out) throw new Error('An explicit output filename is required');
  fs.writeFileSync(out,build());console.log(out);
}
