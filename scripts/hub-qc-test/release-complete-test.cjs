const assert=require('node:assert/strict');
const {PGlite}=require(process.env.HUB_PGLITE_DIR||'@electric-sql/pglite');
const {build,baseline}=require('./release-complete.cjs');
(async()=>{
  // A second isolated database is loaded only through the pre-release chain.
  const fs=require('node:fs'),path=require('node:path');const root=path.resolve(__dirname,'../..');
  const clean=new PGlite();
  try {
   await clean.exec(fs.readFileSync(path.join(__dirname,'bootstrap.sql'),'utf8'));
   for(const name of ['00501_operations_hub','00502_operations_evidence','00503_operations_scheduler','00504_operations_period_adjustments','00505_operations_todo_paging','00506_operations_result_adjustments','00507_operations_measurements','00508_operations_mkt_links','00509_operations_filters_access','00514_operations_standard_proposals','00532_operations_quality_foundation','00533_operations_quality_reads','00534_operations_quality_evidence','00535_operations_quality_accounting_and_reports','00536_operations_quality_access','00539_operations_quality_acceptance_fixes']) await clean.exec(fs.readFileSync(path.join(root,'supabase/migrations',name+'.sql'),'utf8'));
   await clean.exec("create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);insert into supabase_migrations.schema_migrations values('00539','operations_quality_acceptance_fixes','{}');");
   const expected={};for(const name of Object.keys(baseline)) expected[name]=(await clean.query('select md5(pg_get_functiondef(to_regprocedure($1))) hash',[name])).rows[0].hash;
   await assert.rejects(clean.exec(build()),/Hub baseline changed/);await clean.exec('rollback');
   assert.equal((await clean.query("select to_regclass('public.ops_q_periods') t")).rows[0].t,null);
   console.log('PASS unexpected baseline aborts without creating tables');
   await clean.exec(build(expected));
   assert.equal((await clean.query("select count(*)::int n from supabase_migrations.schema_migrations where version in ('00550','00551')")).rows[0].n,2);
   console.log('PASS exact release bodies and history apply in one transaction');
   await assert.rejects(clean.exec(build(expected)),/already present/);await clean.exec('rollback');
   console.log('PASS release replay blocked');
   await require('./acceptance.cjs')(clean);await require('./advanced.cjs')(clean);await require('./complete.cjs')(clean);
  } finally {await clean.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
