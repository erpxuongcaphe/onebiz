const fs=require('node:fs');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {PGlite}=require(process.env.HUB_PGLITE_DIR||'@electric-sql/pglite');
const {prepare}=require('./recurrence-acceptance.cjs');
const source=require('../../src/lib/operations/ceo-workbook.json');
(async()=>{
 const db=new PGlite();let checks=0;
 const owner='30000000-0000-4000-8000-000000000001',manager='30000000-0000-4000-8000-000000000002',other='30000000-0000-4000-8000-000000000008',branch='20000000-0000-4000-8000-000000000001';
 const query=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const value=async(sql,args=[])=>(await query(sql,args))[0].value;
 const actor=id=>query("select set_config('test.actor',$1,false)",[id]);
 const check=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);console.log('PASS LIBRARY UPDATE',label);checks++;};
 const denied=async(fn,code)=>{await assert.rejects(fn,error=>error.message.includes(code));console.log('PASS LIBRARY UPDATE rejects',code);checks++;};
 const library=(action,payload,id=randomUUID())=>value('select ops_working_library_execute_v2($1,$2,$3) value',[action,JSON.stringify(payload),id]);
 try{
  await prepare(db);
  for(const file of ['00561_operations_recurrence.sql','00562_operations_schedule_lifecycle.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
  await actor(owner);
  const today=await value("select (now() at time zone 'Asia/Ho_Chi_Minh')::date::text value");
  const day=async(offset)=>value('select ($1::date+$2::integer)::text value',[today,offset]);
  const first=await day(1),after=await day(2);
  const rows=source.rows.slice(0,3).map(row=>({...row,critical:false,accountingRequired:false}));
  const save={id:null,version:null,title:'Synthetic library update acceptance',rows,notes:'',sourceKey:null,reason:'Synthetic acceptance only'};
  const lib=await library('save',save);
  await library('apply',{id:lib.id,version:1,assignments:[{branchId:branch,assigneeIds:[manager],effectiveFrom:today,dueTime:'23:59',weeklyDay:1}]});
  await value('select ops_generate_internal($1,$2) value',[branch,after]);
  const before=await query('select id,state,quality,original_due_at from ops_runs order by id');
  const erp=await query('select * from stock_movements');
  await db.exec('create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations(version text primary key,name text,statements text[])');
  await db.exec(require('./library-update-release.cjs').sql);
  check(await value("select count(*)::int value from supabase_migrations.schema_migrations where version='20261022110000'"),1,'atomic release records its exact migration version once');
  check(await query('select id,state,quality,original_due_at from ops_runs order by id'),before,'installation does not change any existing work/result');
  check(await query('select * from stock_movements'),erp,'installation leaves stock sentinels unchanged');
  const editedRows=[{...rows[0],title:'Synthetic changed title',requirement:'Synthetic changed requirement'},rows[2],{...rows[1],number:35,title:'Synthetic added criterion'}];
  await library('save',{...save,id:lib.id,version:1,rows:editedRows});
  const preview=()=>value('select ops_library_update_preview($1,2,$2,$3) value',[lib.id,[branch],first]);
  const update=(plan,id=randomUUID(),patch={})=>value('select ops_library_update_execute($1,$2) value',[JSON.stringify({id:lib.id,version:2,branchIds:[branch],effectiveFrom:first,token:plan.token,reason:'Synthetic reviewed library update',...patch}),id]);
  const plan=await preview();
  check(plan.branches[0].changes.map(row=>row.kind),['edit','remove','add'],'preview identifies edit, remove and add by stable source number');
  check(plan.branches[0].changes.some(row=>row.conflict),false,'unchanged branch setup is eligible');
  check(await query('select id,state,quality,original_due_at from ops_runs order by id'),before,'preview does not write data');
  await actor(manager);await denied(preview,'OPS_FORBIDDEN');await denied(()=>update(plan),'OPS_FORBIDDEN');
  await actor(other);await denied(preview,'OPS_FORBIDDEN');await actor(owner);
  await denied(()=>value('select ops_library_update_preview($1,2,$2,$3) value',[lib.id,[branch],today]),'OPS_INVALID_SCHEDULE');
  await denied(()=>value('select ops_library_update_preview($1,1,$2,$3) value',[lib.id,[branch],first]),'OPS_LIBRARY_STALE');
  const replaceable=plan.branches[0].changes[0].impact.replaceable[0].id;
  await query('update ops_runs set version=version+1 where id=$1',[replaceable]);
  await denied(()=>update(plan),'OPS_LIBRARY_UPDATE_STALE');
  const standard=plan.branches[0].changes[0].standardId;
  await query("update ops_standards set description='Local branch override' where id=$1",[standard]);
  const conflict=await preview();
  check(conflict.branches[0].changes[0].conflict,true,'branch-specific content is explicitly protected');
  check(conflict.branches[0].changes[0].current.requirement,'Local branch override','preview shows the actual branch override, not just the old library text');
  await denied(()=>update(conflict),'OPS_LIBRARY_BRANCH_OVERRIDE');
  await query('update ops_standards set description=$2 where id=$1',[standard,rows[0].requirement]);
  await query("update ops_runs set state='done',quality='met',met_at=now(),version=version+1 where id=$1",[replaceable]);
  const protectedBefore=await query('select * from ops_runs where id=$1',[replaceable]);
  const final=await preview();
  check(final.branches[0].changes[0].impact.protected.length,1,'preview counts protected future work with results');
  const snapshot=async()=>value(`select jsonb_build_object(
    'standards',(select jsonb_agg(to_jsonb(t) order by id) from ops_standards t),
    'catalog',(select jsonb_agg(to_jsonb(t) order by id) from ops_q_catalog t),
    'runs',(select jsonb_agg(to_jsonb(t) order by id) from ops_runs t),
    'applications',(select jsonb_agg(to_jsonb(t) order by id) from ops_working_library_applications t),
    'audit',(select jsonb_agg(to_jsonb(t) order by id) from ops_audit t)) value`);
  const beforeFailure=await snapshot();
  await db.exec(`create function test_library_update_failure() returns trigger language plpgsql as $$
    begin if new.action='library_update' then raise exception 'SYNTHETIC_LATE_FAILURE'; end if; return new; end $$;
    create trigger test_library_update_failure before insert on ops_audit for each row execute function test_library_update_failure()`);
  await denied(()=>update(final),'SYNTHETIC_LATE_FAILURE');
  check(await snapshot(),beforeFailure,'late write failure rolls back standards, catalog, runs, applications and audit together');
  await db.exec('drop trigger test_library_update_failure on ops_audit; drop function test_library_update_failure()');
  const request=randomUUID();await update(final,request);await update(final,request);
  check(await query('select * from ops_runs where id=$1',[replaceable]),protectedBefore,'updating library preserves completed results byte-for-byte');
  check(await value('select library_version value from ops_working_library_applications where library_id=$1',[lib.id]),2,'application tracks source version 2');
  check(await value("select count(*)::int value from ops_audit where action='library_update' and after_data->>'library_version'='2'"),1,'idempotent retry writes one library-update audit');
  check(await value('select count(*)::int value from ops_standards where family_id=(select family_id from ops_standards where id=$1)',[standard]),2,'one new standard revision per edited criterion');
  check(await value("select count(*)::int value from ops_q_catalog where code=$1 and ends_on=$2",[`WS-${lib.id.replaceAll('-','')}-0002`,today]),1,'removed QC criterion ends on the last old date');
  check(await value("select count(*)::int value from ops_q_catalog where code=$1",[`WS-${lib.id.replaceAll('-','')}-0035`]),1,'new QC criterion created once');
  check(await value("select count(*)::int value from ops_runs where family_id=(select family_id from ops_standards where id=$1) and schedule_canceled_at is not null",[standard]),1,'only empty future work is canceled for replacement');
  await denied(()=>value('select ops_library_update_preview($1,2,$2,$3) value',[lib.id,[branch],first]),'OPS_LIBRARY_UPDATE_NOT_NEEDED');
  await library('save',{...save,id:lib.id,version:2,rows:[{...editedRows[0],title:'Synthetic next future revision'},...editedRows.slice(1)]});
  await denied(()=>value('select ops_library_update_preview($1,3,$2,$3) value',[lib.id,[branch],after]),'OPS_LIBRARY_UPDATE_PENDING');
  check(await query('select * from stock_movements'),erp,'library updates never touch stock sentinels');
  console.log(`LIBRARY_UPDATE_ACCEPTANCE ${checks} checks passed`);
 }finally{await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
