// Native PostgreSQL concurrency acceptance for the new cash-posting/close lock.
import {readFileSync} from 'node:fs';
import {spawn,execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
if(process.env.PGDATABASE!=='fnb_shift_totals_race_test')throw new Error('Requires the dedicated disposable race-test database.');
const id=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
const args=['-X','-qAt','-v','ON_ERROR_STOP=1'];
function sql(value){return execFileSync('psql',[...args,'-c',value],{encoding:'utf8',env:{...process.env,PGOPTIONS:'-c statement_timeout=15000 -c lock_timeout=12000'},stdio:['ignore','pipe','pipe']}).trim();}
function extract(file,name){const s=readFileSync('supabase/migrations/'+file,'utf8');const start=s.search(new RegExp('create or replace function public\\.'+name+'\\s*\\(','i'));assert(start>=0,name);const t=s.slice(start);const tag=/\bas\s+(\$[a-z_]*\$)/i.exec(t);const end=t.indexOf(tag[1]+';',tag.index+tag[0].length);return t.slice(0,end+tag[1].length+1);}
const actor=`select set_config('request.jwt.claim.sub','${id(7)}',false);`;
sql(`do $$begin if current_database()<>'fnb_shift_totals_race_test' or to_regclass('public.shifts') is not null then raise exception 'Requires fresh isolated shift DB';end if;end$$;
 do $$begin if not exists(select 1 from pg_roles where rolname='anon')then create role anon;end if;if not exists(select 1 from pg_roles where rolname='authenticated')then create role authenticated;end if;end$$;`+
 readFileSync('scripts/fnb-db-test/schema-shifts.sql','utf8').replace(/^do \$\$ begin[\s\S]*?end \$\$;/,'')+`
 alter table branches add column cascade_mode text default 'outlet';alter table shifts add column reconciled_by uuid,add column reconciled_at timestamptz,add column reconcile_reason text;`+
 extract('00402_fix_fnb_void_shift_reconciliation.sql','_finalize_shift_atomic_00298')+
 extract('00298_fix_shift_open_close_reconcile_flow.sql','close_shift_atomic')+
 extract('00298_fix_shift_open_close_reconcile_flow.sql','reconcile_pending_shift')+
 readFileSync('supabase/migrations/202610220002_fnb_shift_totals_reconciliation.sql','utf8')+`
 insert into branches(id,tenant_id) values('${id(2)}','${id(1)}');
 insert into test_actor_context values('${id(7)}','${id(1)}','${id(2)}',true,false,false,false);
 insert into shifts(id,tenant_id,branch_id,cashier_id,starting_cash) values('${id(10)}','${id(1)}','${id(2)}','${id(7)}',100);
 insert into cash_transactions(tenant_id,branch_id,shift_id,type,amount,payment_method,status,reference_type) values
 ('${id(1)}','${id(2)}','${id(10)}','receipt',200,'cash','completed','invoice'),
 ('${id(1)}','${id(2)}','${id(10)}','receipt',500,'transfer','completed','invoice');`);
function heldTransaction(body,marker){
 const child=spawn('psql',args,{env:process.env,stdio:['pipe','pipe','pipe']});
 let out='',err='';let readyResolve,readyReject;
 const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
 child.stdout.on('data',chunk=>{out+=chunk; if(out.includes(marker))readyResolve();});child.stderr.on('data',chunk=>{err+=chunk;});
 child.on('error',readyReject);
 const done=new Promise((resolve,reject)=>child.on('exit',code=>{if(code===0)resolve();else {const e=new Error(err||out||'psql failed');readyReject(e);reject(e);}}));
 child.stdin.end(`begin;\n${actor}\n${body};\nselect '${marker}';\nselect pg_sleep(2);\ncommit;\n`);
 return {ready,done};
}
function rejects(query,message){try{sql(actor+query);assert.fail('accepted: '+message);}catch(e){assert(String(e.stderr??e.message).includes(message),String(e.stderr??e.message));}}
const receipt=`insert into cash_transactions(tenant_id,branch_id,shift_id,type,amount,payment_method,status,reference_type) values('${id(1)}','${id(2)}','${id(10)}','receipt',1,'transfer','completed','invoice')`;
const first=heldTransaction(receipt,'POSTING_LOCK_HELD');await first.ready;
rejects(`select fnb_reconcile_shift_totals_20261022('${id(10)}',300,500,300,500,'end_of_day')`,'SHIFT_TOTALS_CHANGED');await first.done;
assert.equal(sql(`select status from shifts where id='${id(10)}'`),'open');console.log('PASS close waits for an in-flight receipt and rolls back stale totals');
const second=heldTransaction(`select fnb_reconcile_shift_totals_20261022('${id(10)}',300,501,300,501,'end_of_day')`,'CLOSE_LOCK_HELD');await second.ready;
rejects(receipt,'SHIFT_RECONCILED_CASH_LOCKED');await second.done;
assert.equal(sql(`select status||':'||actual_transfer::text from shifts where id='${id(10)}'`),'closed:501');
assert.equal(sql(`select sum(amount)::text from cash_transactions where shift_id='${id(10)}' and payment_method='transfer'`),'501');
console.log('PASS a late receipt waits for close, then cannot change the reconciled bank total');
