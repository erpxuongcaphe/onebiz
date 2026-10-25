// Real parallel PostgreSQL clients. Refuse every database except the disposable CI fixture.
import {spawn} from 'node:child_process';import assert from 'node:assert/strict';
if(process.env.PGDATABASE!=='fnb_print_queue_test' || !['localhost','127.0.0.1'].includes(process.env.PGHOST))throw Error('DISPOSABLE_LOCAL_PRINT_DB_REQUIRED');
const branch='20000000-0000-0000-0000-000000000001',actor='30000000-0000-0000-0000-000000000001';
const context=`set test.actor='${actor}';set test.branch='${branch}';set test.permission='manager';`;
function sql(query){return new Promise((resolve,reject)=>{
 const child=spawn('psql',['-X','-q','-At','-v','ON_ERROR_STOP=1','-c',context+query],{stdio:['ignore','pipe','pipe']});let out='',err='';
 const timer=setTimeout(()=>{child.kill();reject(Error('PRINT_FIXTURE_QUERY_TIMEOUT'));},30000);
 child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);
 child.on('error',error=>{clearTimeout(timer);reject(error);});child.on('close',code=>{clearTimeout(timer);if(code)reject(Error('Print fixture psql failed: '+err.slice(0,200)));else resolve(out.trim());});
});}
// Each suite sets its own paper/route; do not depend on the preceding fixture.
await sql(`select public.fnb_print_manage_v1('${branch}','save','{"name":"Concurrency fixture","enabled":true,"routes":[{"key":"kitchen","label":"Bếp","printer":"Fixture only","paper":"80mm"}]}');`);
const credentials=JSON.parse(await sql(`select public.fnb_print_manage_v1('${branch}','rotate','{}');`));
const point=credentials.id,token=credentials.token;
await sql(`update fnb_print_jobs set status='cancelled';do $$begin for i in 1..20 loop perform public.fnb_print_enqueue_v1('${branch}',gen_random_uuid(),'kitchen','Parallel fixture '||i,'80mm',encode(decode('1b401b61011d76300030000100'||repeat('00',48)||'1b64031d5601','hex'),'base64'));end loop;end $$;`);
const received=new Set();
for(let round=0;round<4;round++){
 const data=round>=2?",jsonb_build_object('request_id',gen_random_uuid())":"";
 const results=await Promise.all(Array.from({length:16},()=>sql(`select public.fnb_print_agent_v1('${point}','${token}','claim'${data});`)));
 const owners=results.filter(Boolean).map(s=>JSON.parse(s));assert.equal(owners.length,1,'exactly one of 16 parallel claims owns a physical send');
 const job=owners[0];assert.equal(received.has(job.id),false,'a finished job must never replay');received.add(job.id);
 if(round>=2){
  const recovered=JSON.parse(await sql(`select public.fnb_print_agent_v1('${point}','${token}','claim',jsonb_build_object('request_id','${job.claim_id}'));`));
  assert.deepEqual(recovered,job,'a lost response recovers the same single assignment');
 }
 const finish=`select public.fnb_print_agent_v1('${point}','${token}','finish',jsonb_build_object('id','${job.id}','claim_id','${job.claim_id}','status','handed_off'));`;
 await sql(finish);if(round>=2)await sql(finish);
}
await sql(`do $$declare j jsonb;begin for i in 1..16 loop j:=public.fnb_print_agent_v1('${point}','${token}','claim');if j is null then raise exception 'Burst ticket lost';end if;perform public.fnb_print_agent_v1('${point}','${token}','finish',jsonb_build_object('id',j->>'id','claim_id',j->>'claim_id','status','handed_off'));end loop;if public.fnb_print_agent_v1('${point}','${token}','claim') is not null then raise exception 'Unexpected replay';end if;end $$;`);
assert.equal(Number(await sql("select count(*) from fnb_print_jobs where label like 'Parallel fixture %' and status='handed_off';")),20);
console.log('PASS real PostgreSQL: 2 legacy + 2 recoverable rounds × 16 simultaneous claims, one owner each; lost responses recover the same assignment; 20 burst tickets completed once. No physical printer.');
