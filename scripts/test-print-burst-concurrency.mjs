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
const credentials=JSON.parse(await sql(`select public.fnb_print_manage_v1('${branch}','rotate','{}');`));
const point=credentials.id,token=credentials.token;
await sql(`update fnb_print_jobs set status='cancelled';do $$begin for i in 1..20 loop perform public.fnb_print_enqueue_v1('${branch}',gen_random_uuid(),'kitchen','Parallel fixture '||i,'80mm',encode(decode('1b401b61011d76300030000100'||repeat('00',48)||'1b64031d5601','hex'),'base64'));end loop;end $$;`);
const received=new Set();
for(let round=0;round<2;round++){
 const results=await Promise.all(Array.from({length:16},()=>sql(`select public.fnb_print_agent_v1('${point}','${token}','claim');`)));
 const owners=results.filter(Boolean).map(s=>JSON.parse(s));assert.equal(owners.length,1,'exactly one of 16 parallel claims owns a physical send');
 const job=owners[0];assert.equal(received.has(job.id),false,'a finished job must never replay');received.add(job.id);
 await sql(`select public.fnb_print_agent_v1('${point}','${token}','finish',jsonb_build_object('id','${job.id}','claim_id','${job.claim_id}','status','handed_off'));`);
}
await sql(`do $$declare j jsonb;begin for i in 1..18 loop j:=public.fnb_print_agent_v1('${point}','${token}','claim');if j is null then raise exception 'Burst ticket lost';end if;perform public.fnb_print_agent_v1('${point}','${token}','finish',jsonb_build_object('id',j->>'id','claim_id',j->>'claim_id','status','handed_off'));end loop;if public.fnb_print_agent_v1('${point}','${token}','claim') is not null then raise exception 'Unexpected replay';end if;end $$;`);
assert.equal(Number(await sql("select count(*) from fnb_print_jobs where label like 'Parallel fixture %' and status='handed_off';")),20);
console.log('PASS real PostgreSQL: 2 rounds × 16 simultaneous claims, one owner each; 20 burst tickets completed once, zero replay. No physical printer.');
