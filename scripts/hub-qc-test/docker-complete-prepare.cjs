// Strictly local fixture upgrade. Never accepts a host, database URL or production project.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const container='supabase_db_onebiz-operations-acceptance-only';
const root=path.resolve(__dirname,'../..');
const metadata=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];
assert.ok(metadata.Name==='/'+container);
const existing=execFileSync('docker',['exec',container,'psql','-X','-U','postgres','-d','postgres','-Atc',"select to_regclass('public.ops_q_periods') is not null"],{encoding:'utf8'}).trim();
assert.equal(existing,'f','Fixture already upgraded; do not replay migrations');
const files=['00532_operations_quality_foundation.sql','00533_operations_quality_reads.sql','00534_operations_quality_evidence.sql','00535_operations_quality_accounting_and_reports.sql','00536_operations_quality_access.sql','00539_operations_quality_acceptance_fixes.sql','00550_operations_complete_foundation.sql','00551_operations_complete_workflows.sql'];
const statements=files.map(name=>fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8').replace(/^begin;\r?$/gmi,'').replace(/^commit;\r?$/gmi,''));
const guard=`begin;
set local lock_timeout='3s';set local statement_timeout='60s';
do $$begin
 if current_database()<>'postgres' or exists(select 1 from public.profiles where coalesce(email,'') not like '%@example.test') then raise exception 'NOT_A_SYNTHETIC_FIXTURE';end if;
 if to_regprocedure('public.ops_standard_proposal(text,jsonb,uuid)') is null or to_regprocedure('public.ops_access_context()') is null then raise exception 'LOCAL_BASELINE_NOT_READY';end if;
end$$;
create or replace function public._can_read_branch_inventory_00476(a uuid,t uuid,b uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.profiles where id=a and tenant_id=t and is_active and (role='owner' or branch_id=b))$$;
`;
const result=execFileSync('docker',['exec','-i',container,'psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input:guard+statements.join('\n')+'\ncommit;',encoding:'utf8',timeout:180000,maxBuffer:4*1024*1024});
assert.ok(result.trim().endsWith('COMMIT'));
console.log('PASS acceptance-only Docker fixture upgraded atomically; no production connection');
