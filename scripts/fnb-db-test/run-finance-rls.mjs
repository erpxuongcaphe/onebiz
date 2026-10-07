import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
if (process.env.FNB_EPHEMERAL_DB !== 'onebiz_fnb_test') throw new Error('Ephemeral service only');
const sql = [readFileSync(new URL('./schema-finance-rls.sql', import.meta.url),'utf8'),
  readFileSync(new URL('../../supabase/migrations/00446_restore_financial_tenant_rls.sql', import.meta.url),'utf8'),
  readFileSync(new URL('./cases-finance-rls.sql', import.meta.url),'utf8')].join('\n');
const result = spawnSync('psql',['-X','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55432','-U','fnb_test','-d','onebiz_fnb_test'],{
  input:sql,encoding:'utf8',env:{PATH:process.env.PATH,PGPASSWORD:'ephemeral-test-only',PGSSLMODE:'disable',PGCONNECT_TIMEOUT:'5'}});
process.stdout.write(result.stdout||''); process.stderr.write(result.stderr||'');
if(result.error) throw result.error; process.exitCode=result.status??1;
