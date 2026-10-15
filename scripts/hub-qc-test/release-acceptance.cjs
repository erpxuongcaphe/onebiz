const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { PGlite } = require(process.env.HUB_PGLITE_DIR || '@electric-sql/pglite');
const { bootstrap } = require('./run.cjs');
(async () => {
  const db = new PGlite();
  const output = process.env.HUB_RELEASE_OUTPUT;
  try {
    await bootstrap(db);
    const recovery = fs.readFileSync(path.join(output,'RESTORE_HUB_FUNCTIONS_BEFORE_00537.sql'),'utf8');
    const release = fs.readFileSync(path.join(output,'APPLY_HUB_00539.sql'),'utf8');
    await db.exec(recovery);
    await db.exec('create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);');
    await db.exec(release);
    assert.equal((await db.query("select count(*)::int n from supabase_migrations.schema_migrations where version='00539'")).rows[0].n,1);
    await db.exec("update supabase_migrations.schema_migrations set version='00537' where version='00539';");
    await db.exec(fs.readFileSync(path.join(__dirname,'reconcile-00539.sql'),'utf8'));
    assert.equal((await db.query("select count(*)::int n from supabase_migrations.schema_migrations where version='00539' and name='operations_quality_acceptance_fixes'")).rows[0].n,1);
    console.log('PASS migration metadata reconciles 00537 to00539 without replaying Hub DDL');
    await require('./acceptance.cjs')(db);
    await require('./advanced.cjs')(db);
    const before=(await db.query('select count(*)::int n from ops_q_events')).rows[0].n;
    await db.exec(recovery);
    assert.equal((await db.query('select count(*)::int n from ops_q_events')).rows[0].n,before);
    assert.equal((await db.query("select has_function_privilege('authenticated','public.ops_quality_execute_core(text,jsonb,uuid)','execute') allowed")).rows[0].allowed,false);
    console.log('PASS exact production bundle, baseline guards, migration registration, behavior and recovery preserving event history/ACLs');
  } finally { await db.close(); }
})().catch(error=>{ console.error(error);process.exitCode=1; });
