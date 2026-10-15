// Exact supplied workbook content is read from a local extraction. No network or production credentials.
const fs=require('node:fs');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const path=require('node:path');
const {PGlite}=require(process.env.HUB_PGLITE_DIR||'@electric-sql/pglite');
const {bootstrap}=require('./run.cjs');
const req=createRequire(path.resolve(__dirname,'../../package.json'));
const ts=req('typescript');
function loadTs(file){const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;const m={exports:{}};const requireLocal=id=>id==='./contracts'?loadTs(path.resolve(__dirname,'../../src/lib/operations/contracts.ts')):req(id);new Function('require','module','exports',code)(requireLocal,m,m.exports);return m.exports;}
(async()=>{
 const db=new PGlite();const report={checks:[],items:[],gaps:[]};
 const check=(v,label)=>{assert.ok(v,label);report.checks.push(label);console.log('PASS',label);};
 const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
 const actor=async(id)=>db.query("select set_config('test.actor',$1,false)",[id]);
 const tenant='10000000-0000-4000-8000-000000000001',branch='20000000-0000-4000-8000-000000000001',owner='30000000-0000-4000-8000-000000000001',manager='30000000-0000-4000-8000-000000000002',qc='30000000-0000-4000-8000-000000000004';
 const exec=async(action,payload)=>(await one('select ops_quality_execute($1,$2,$3) value',[action,JSON.stringify({branchId:branch,...payload}),crypto.randomUUID()])).value;
 const legacy=async(action,payload)=>(await one('select ops_execute($1,$2,$3) value',[action,JSON.stringify({branchId:branch,...payload}),crypto.randomUUID()])).value;
 try {
  await bootstrap(db);
  await db.query('insert into tenants values($1)',[tenant]);
  await db.query("insert into branches(id,tenant_id,code,name) values($1,$2,'SOURCE','Chi nhánh giả kiểm thử file gốc')",[branch,tenant]);
  for(const [id,name,role] of [[owner,'CEO giả','owner'],[manager,'Quản lý giả','staff'],[qc,'QC giả','staff']]){
   await db.query('insert into profiles(id,tenant_id,role,full_name,email) values($1,$2,$3,$4,$5)',[id,tenant,role,name,id+'@test.invalid']);
   if(role!=='owner')for(const code of ['ops.view','ops.work','ops.verify'])await db.query('insert into test_permissions values($1,$2)',[id,code]);
  }
  await db.query("insert into ops_members values($1,$2,$3,'manager','{}',true)",[tenant,branch,manager]);
  await db.query("insert into ops_members values($1,$2,$3,'reviewer','{}',true)",[tenant,branch,qc]);
  const date=(await one("select (now() at time zone 'Asia/Ho_Chi_Minh')::date::text as current_day")).current_day;
  const dow=(await one("select extract(isodow from now() at time zone 'Asia/Ho_Chi_Minh')::int dow")).dow;
  const source=Object.values(JSON.parse(fs.readFileSync(process.env.HUB_SOURCE_JSON,'utf8')))[0];
  const rows=source.filter(r=>Number.isInteger(r[1])&&r[1]>=1&&r[1]<=34);
  check(rows.length===34,'SRC01 exactly 34 source rows, including duplicate display titles');
  check(rows.filter(r=>r[6]==='Daily').length===32&&rows.filter(r=>r[6]==='Weekly').length===2,'SRC02 32 daily and 2 weekly, all common scope');
  check(new Set(rows.map(r=>r[2])).size===6,'SRC03 preserve six original group labels in source mapping');
  const {parseQualityCatalog,qualityImportHeaders}=loadTs(path.resolve(__dirname,'../../src/lib/operations/quality-import.ts'));
  check(parseQualityCatalog(source).errors[0]?.column==='Tiêu đề','SRC04 raw source workbook is explicitly rejected, never silently mis-imported');
  await actor(owner); await exec('qc_grant',{userId:qc,canAudit:true,canCorrect:true,active:true});
  const importRows=[];const category={};const qualityGroups={};
  for(const title of new Set(rows.map(row=>row[2]))){const group=await exec('group',{title});category[title]='group:'+group.id;qualityGroups['group:'+group.id]=title;}
  for(const r of rows){
   const [_,index,group,title,description,scope,frequency,rawScore]=r;
   const score=Number(String(rawScore).trim().replace('−','-')); const criteria=[{id:crypto.randomUUID(),title:description.trim(),kind:'boolean',operator:'eq',threshold:1,samples:1,critical:false,evidenceRequired:true,measurementScope:group}];
   if(index===30){criteria[0].title='Mở cửa đúng giờ';criteria.push({...criteria[0],id:crypto.randomUUID(),title:'Đóng cửa đúng giờ'});}
   if(index===32){Object.assign(criteria[0],{kind:'percent',operator:'lt',threshold:0.7,ratioBasis:'Số liệu do kế toán cung cấp; phương pháp thực tế cần cấu hình'});}
   const standard=await legacy('standard',{title,description:`Nhóm gốc: ${group}\n${description}`,scope:'common',assigneeId:manager,frequency:frequency==='Daily'?'daily':'weekly',dayNumber:dow,dueTime:'17:00',effectiveFrom:date,criteria});
   await legacy('approve_standard',{id:standard.id});
   await db.query("update ops_standards set created_at=$2::date::timestamp at time zone 'Asia/Ho_Chi_Minh',approved_at=$2::date::timestamp at time zone 'Asia/Ho_Chi_Minh' where id=$1",[standard.id,date]);
   await exec('assignment',{familyId:standard.family_id,managerIds:[manager]});
   const code='TEST-'+crypto.randomUUID().slice(0,8).toUpperCase();
   importRows.push([code,standard.id,category[group],score<0?'Trừ':'Cộng',String(rawScore).trim(),date,'Không',index===32?'Có':'Không']);
   report.items.push({sourceRow:index+4,index,group,title,description,scope,frequency,rawScore,score,standardId:standard.id,familyId:standard.family_id,code,criteria,notes:index===30?'Hai điều kiện mở/đóng; một trọng số 10':index===32?'Ngưỡng <0.7%; kế toán cung cấp số tử/mẫu, chưa tự suy ra phương pháp':'Giữ nguyên mô tả; các SOP/quan sát thực tế do CEO cấu hình'});
  }
  const parsed=parseQualityCatalog([qualityImportHeaders,...importRows],[],undefined,qualityGroups);
  check(parsed.errors.length===0,'SRC05 mapped 34-row Hub template accepts Unicode minus and numeric scores');
  check(parsed.rows.filter(r=>r.scoreType==='deduct').reduce((n,r)=>n+r.weight,0)===197,'SRC06 total deductions 197, not an automatic negative opening score');
  check(parsed.rows.filter(r=>r.scoreType==='bonus').length===2&&parsed.rows.filter(r=>r.scoreType==='bonus').reduce((n,r)=>n+r.weight,0)===10,'SRC07 only source items 13 and 18 award bonus, total 10');
  await exec('catalog_import',{rows:parsed.rows});
  check((await one('select count(*)::int n from ops_q_catalog')).n===34,'SRC08 real SQL atomic import stores all 34 mapped items');
  const saved=(await db.query('select c.*,c.effective_from::text as effective_from from ops_q_catalog c')).rows;
  check(new Set(saved.map(item=>item.group_title)).size===6&&saved.every(item=>qualityGroups[item.category]===item.group_title),'SRC03 database preserves all six independent QC groups without mapping to To-do categories');
  for(const item of report.items){const value=saved.find(c=>c.standard_id===item.standardId);assert.equal(value.title,item.title);assert.equal(Number(value.weight),Math.abs(item.score));assert.deepEqual(value.criteria,item.criteria);item.storageVerified=true;}
  check(report.items.every(i=>i.storageVerified),'SRC09 all 34 titles, full criteria and weights match stored snapshots');
  await db.query('select ops_generate_internal($1,$2)',[branch,date]);
  await db.query('select ops_generate_internal($1,$2)',[branch,date]);
  check((await one('select count(*)::int n from ops_runs')).n===34,'SRC10 34 due items today with configured weekly day; repeated generation adds none');
  await actor(manager);
  for(const run of (await db.query('select * from ops_runs')).rows){
   const obs=run.criteria.map(c=>({criterionId:c.id,slot:'1',value:c.kind==='percent'?0.6:1,...(c.kind==='percent'?{numerator:6,denominator:1000}:{}),evidence:'Dữ liệu giả nghiệm thu'}));
   await exec('check',{id:run.id,version:run.version,observations:obs});
  }
  check((await one("select count(*)::int n from ops_q_checks where result='met'")).n===34,'SRC11 manager records every source item, opening and closing both required');
  check((await one('select count(*)::int n from ops_q_events')).n===0,'SRC12 passing all manager checks awards zero QC points');
  await actor(owner);
  const config={baseScore:100,minimumScore:70,floorScore:0,capScore:120,bonusCap:10,repeatMode:'each_audit',thresholdBasis:'after_bonus',allowAbove100:true,qcFundCents:200000000,businessFundCents:null,businessThresholdBps:null,businessCapBps:null,blockBusinessOnCritical:null,allocations:[{userId:manager,shareBps:10000}]};
  const policy=await exec('rule',{title:'Chính sách giả để kiểm thử, không phải chốt kinh doanh',effectiveFrom:date,config});await exec('rule_approve',{id:policy.id});
  const period=date.slice(0,7);
  await db.query("insert into ops_q_accounting(tenant_id,branch_id,period,title,numerator,denominator,unit,evidence,created_by,state,approved_by) values($1,$2,$3,'Nguồn kế toán giả',6,1000,'đồng','Căn cứ thử nghiệm',$4,'approved',$4)",[tenant,branch,period,owner]);
  const metric=(await one('select id from ops_q_accounting where period=$1',[period])).id;
  await actor(qc);const audit=await exec('qc_create',{title:'QC giả đủ 34 mục',period});
  const lines=(await db.query('select * from ops_q_lines where audit_id=$1',[audit.id])).rows;
  check(lines.length===34,'SRC13 QC independently snapshots all 34 source criteria');
  for(const line of lines){const obs=line.item_snapshot.criteria.map(c=>({criterionId:c.id,slot:'1',value:c.kind==='percent'?0.6:1,...(c.kind==='percent'?{numerator:6,denominator:1000}:{}),evidence:'Dữ liệu QC giả'}));await exec('qc_line',{id:line.id,version:line.version,observations:obs,accountingId:metric,evidence:'Bằng chứng QC giả'});}
  const version=(await one('select version from ops_q_audits where id=$1',[audit.id])).version;
  await exec('qc_complete',{id:audit.id,version});
  const score=(await one('select ops_q_score($1,$2) value',[branch,period])).value;
  check(Number(score.score)===110&&Number(score.bonus)===10,'SRC14 all mandatory met + two evidenced bonuses =110 only under explicit test policy');
  const failedAudit=await exec('qc_create',{title:'QC giả không đạt đủ 34 mục',period});
  await db.query('update ops_q_accounting set numerator=7 where id=$1',[metric]);
  for(const line of (await db.query('select * from ops_q_lines where audit_id=$1',[failedAudit.id])).rows){
   const observations=line.item_snapshot.criteria.map(c=>({criterionId:c.id,slot:'1',value:c.kind==='percent'?0.7:0,...(c.kind==='percent'?{numerator:7,denominator:1000}:{}),evidence:'Bằng chứng lỗi giả'}));
   await exec('qc_line',{id:line.id,version:line.version,observations,accountingId:metric,evidence:'Bằng chứng lỗi giả',issues:[{title:'Lỗi giả '+line.item_snapshot.title,description:'Tình huống nghiệm thu, không phải dữ liệu thực',category:'goods',priority:'normal',assigneeId:manager,dueAt:date+'T17:00:00+07:00',collaborators:[]}]});
  }
  await exec('qc_complete',{id:failedAudit.id,version:(await one('select version from ops_q_audits where id=$1',[failedAudit.id])).version});
  const totals=await one('select sum(delta)::numeric deductions, count(*)::int entries from ops_q_events where audit_id=$1',[failedAudit.id]);
  check(Number(totals.deductions)===-197&&totals.entries===34,'SRC17 all 34 failed criteria deduct exactly197; two failed bonus items deduct0');
  const combined=(await one('select ops_q_score($1,$2) value',[branch,period])).value;
  check(Number(combined.score)===0&&Number(combined.rawScore)===-87,'SRC18 configured floor0 clips raw minus87 without erasing ledger');
  const first=lines.find(l=>l.item_snapshot.score_type==='deduct'&&l.item_snapshot.criteria.every(c=>c.kind==='boolean'));
  first.version=(await one('select version from ops_q_lines where id=$1',[first.id])).version;
  const issueId=(await one('select issue_id from ops_q_sources where qc_line_id in (select id from ops_q_lines where audit_id=$1) limit 1',[failedAudit.id])).issue_id;
  const observations=v=>first.item_snapshot.criteria.map(c=>({criterionId:c.id,slot:'1',value:v,evidence:'Đính chính giả'}));
  await exec('qc_correct',{id:first.id,version:first.version,observations:observations(0),note:'Đính chính giả lần một',evidence:'Căn cứ giả',issues:[{issueId}]});
  await exec('qc_correct',{id:first.id,version:first.version+1,observations:observations(1),note:'Đính chính giả lần hai',evidence:'Căn cứ giả'});
  const correction=(await one('select before_data,after_data from ops_q_corrections where line_id=$1 order by created_at desc,id desc limit 1',[first.id]));
  check(correction.before_data.result==='unmet'&&correction.after_data.result==='met','REGRESSION correction records effective immediately preceding result');
  await actor(owner);
  let duplicateRejected=false;
  try{await exec('catalog_import',{rows:parsed.rows});}catch(e){if(e.code!=='23505')throw e;duplicateRejected=true;}
  const versions=await one('select count(*)::int n from ops_q_catalog');
  const duplicatePreview=parseQualityCatalog([qualityImportHeaders,...importRows],saved,undefined,qualityGroups);
  check(duplicatePreview.errors.filter(error=>error.column==='Mã tiêu chuẩn').length===34,'REGRESSION preview flags all34 duplicate code/date rows before import');
  check(duplicateRejected&&versions.n===34,'SRC15 same-file reimport with a new request is rejected atomically; 34 records remain');
  const old=(await one("select ((now() at time zone 'Asia/Ho_Chi_Minh')::date-interval '1 month')::date::text as old_day")).old_day;
  await db.query("insert into ops_runs(tenant_id,branch_id,standard_id,family_id,period_key,title,criteria,assignee_id,original_due_at) select tenant_id,branch_id,standard_id,family_id,'diagnostic:all-time','OLD-FILTER-TEST',criteria,assignee_id,$1::date::timestamp at time zone 'Asia/Ho_Chi_Minh' from ops_runs limit 1",[old]);
  const all=(await one('select ops_quality_read($1,$2,$3,$4) value',[branch,period,'work',JSON.stringify({search:'OLD-FILTER-TEST'})])).value;
  const ranged=(await one('select ops_quality_read($1,$2,$3,$4) value',[branch,period,'work',JSON.stringify({search:'OLD-FILTER-TEST',from:old+'T00:00:00+07:00',to:date+'T23:59:59+07:00'})])).value;
  check(all.total===1&&ranged.total===1,'REGRESSION all-time includes previous-month work');
  const pending=(await one("select i.id,t.version,t.assignee_id from ops_q_issues i join ops_todos t on t.id=i.todo_id where i.stage='pending' limit 1"));
  await actor(pending.assignee_id);
  await db.query('update ops_notifications set read_at=now()');
  await exec('issue_assign',{id:pending.id,version:pending.version,assigneeId:manager,dueAt:date+'T18:00:00+07:00',note:'Đổi hạn giả để kiểm tra thông báo'});
  const unread=(await one('select count(*)::int n from ops_notifications where read_at is null')).n;
  check(unread>0,'REGRESSION reassignment creates or refreshes unread notification');
  const src32=report.items.find(i=>i.index===32);
  const imported32=saved.find(i=>i.standard_id===src32.standardId);
  check(imported32.accounting_required===true,'REGRESSION source item32 preserves required accounting confirmation');
  check((await one('select count(*)::int n from stock_movements')).n===0&&(await one('select count(*)::int n from invoices')).n===0&&(await one('select count(*)::int n from cash_book')).n===0,'SRC16 stock, invoices and money tables remain untouched');
 } finally {await db.close();fs.writeFileSync(process.env.HUB_SOURCE_REPORT,JSON.stringify(report,null,2));}
 console.log('SOURCE_ACCEPTANCE',report.checks.length,'checks;',report.items.length,'source items verified;',report.gaps.length,'gaps');
})().catch(e=>{console.error(e);process.exitCode=1;});
