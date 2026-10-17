const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const source=fs.readFileSync(path.join(root,'supabase/migrations/00562_operations_schedule_lifecycle.sql'),'utf8');
if(!source.trimEnd().endsWith('commit;'))throw Error('Missing transaction boundary');
const snapshot=`
do $$ begin
 if exists(select 1 from supabase_migrations.schema_migrations where version='00562') then
  raise exception 'Migration 00562 already recorded; do not repeat';
 end if;
end $$;
create temp table hub_lifecycle_before on commit drop as
 select 'standards' kind,id,to_jsonb(x) value from public.ops_standards x
 union all select 'runs',id,to_jsonb(x) from public.ops_runs x
 union all select 'todos',id,to_jsonb(x) from public.ops_todos x
 union all select 'checks',id,to_jsonb(x) from public.ops_q_checks x
 union all select 'scores',id,to_jsonb(x) from public.ops_q_events x
 union all select 'libraries',id,to_jsonb(x) from public.ops_working_libraries x;
alter table hub_lifecycle_before enable row level security;
revoke all on hub_lifecycle_before from public,anon,authenticated;
`;
const verify=`
do $preserved$
begin
 if exists(select 1 from hub_lifecycle_before b full join (
  select 'standards' kind,id,to_jsonb(x)-'stop_after' value from public.ops_standards x
  union all select 'runs',id,to_jsonb(x)-'schedule_canceled_at'-'schedule_cancel_reason'-'current_due_at' from public.ops_runs x
  union all select 'todos',id,to_jsonb(x) from public.ops_todos x
  union all select 'checks',id,to_jsonb(x) from public.ops_q_checks x
  union all select 'scores',id,to_jsonb(x) from public.ops_q_events x
  union all select 'libraries',id,to_jsonb(x) from public.ops_working_libraries x
 ) a using(kind,id) where a.value is distinct from b.value) then
  raise exception 'Existing Hub data changed; abort release';
 end if;
end $preserved$;
insert into supabase_migrations.schema_migrations(version,name,statements)
values('00562','operations_schedule_lifecycle',array[$source00562$${source}$source00562$]);
commit;
select version,name from supabase_migrations.schema_migrations where version='00562';
`;
const sql=source.replace("set local statement_timeout='30s';",()=>"set local statement_timeout='30s';"+snapshot).replace(/commit;\s*$/,()=>verify);
if(require.main===module){
 const target=path.resolve(process.argv[2]||'');
 if(!target.startsWith('C:\\Users\\ADMIN\\Documents\\Codex\\')&&!target.startsWith(root+path.sep+'.tmp'+path.sep))throw Error('Use dedicated release output');
 fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,sql);
 console.log('Generated atomic lifecycle release with data preservation checks and migration history. Not applied.');
}
module.exports={sql};
