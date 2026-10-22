import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(path.resolve(process.argv[2])).href);
const db=new PGlite();
const id=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
function extract(file,name){const s=fs.readFileSync('supabase/migrations/'+file,'utf8');const start=s.search(new RegExp('create or replace function public\\.'+name+'\\s*\\(','i'));assert(start>=0,name);const t=s.slice(start);const tag=/\bas\s+(\$[a-z_]*\$)/i.exec(t);const end=t.indexOf(tag[1]+';',tag.index+tag[0].length);return t.slice(0,end+tag[1].length+1);}
let assertions=0;
async function eq(sql,expected,label){const value=(await db.query(sql)).rows[0].v;assert.deepEqual(value,expected,label);assertions++;console.log('PASS '+label);}
async function fails(sql,code,label){try{await db.exec(sql);assert.fail('accepted '+label);}catch(e){assert(String(e.message).includes(code),label+': '+e.message);assertions++;console.log('PASS '+label);}}
async function shift(n,status='open',branch=2,cashier=7){await db.exec(`insert into shifts(id,tenant_id,branch_id,cashier_id,starting_cash,status) values('${id(n)}','${id(1)}','${id(branch)}','${id(cashier)}',100,'${status}')`);}
async function call(n,cash=100,transfer=0,expectedCash=100,expectedTransfer=0,kind='end_of_day',note='null',reason='null'){return db.query(`select fnb_reconcile_shift_totals_20261022('${id(n)}',${cash},${transfer},${expectedCash},${expectedTransfer},'${kind}',${note},${reason}) v`);}
try{
 await db.exec('create role anon;create role authenticated;');
 const schema=fs.readFileSync('scripts/fnb-db-test/schema-shifts.sql','utf8').replace(/^do \$\$ begin[\s\S]*?end \$\$;/,'');
 await db.exec(schema);
 await db.exec(`alter table branches add column cascade_mode text default 'outlet';alter table shifts add column reconciled_by uuid,add column reconciled_at timestamptz,add column reconcile_reason text;
 insert into branches(id,tenant_id) values('${id(2)}','${id(1)}'),('${id(3)}','${id(1)}');
 insert into test_actor_context values('${id(7)}','${id(1)}','${id(2)}',true,false,false,false),('${id(8)}','${id(1)}','${id(2)}',false,false,false,true),('${id(9)}','${id(99)}','${id(3)}',true,false,false,false);
 select set_config('request.jwt.claim.sub','${id(7)}',false);`);
 await db.exec(extract('00402_fix_fnb_void_shift_reconciliation.sql','_finalize_shift_atomic_00298'));
 await db.exec(extract('00298_fix_shift_open_close_reconcile_flow.sql','close_shift_atomic'));
 await db.exec(extract('00298_fix_shift_open_close_reconcile_flow.sql','reconcile_pending_shift'));
 await shift(10,'closed');
 const old=(await db.query(`select to_jsonb(s) v from shifts s where id='${id(10)}'`)).rows[0].v;
 await db.exec(fs.readFileSync('supabase/migrations/202610220002_fnb_shift_totals_reconciliation.sql','utf8'));
 await eq(`select close_kind is null and actual_transfer is null v from shifts where id='${id(10)}'`,true,'no historical transfer count is invented');
 for(const [key,value] of Object.entries(old))assert.deepEqual((await db.query(`select to_jsonb(s)->'${key}' v from shifts s where id='${id(10)}'`)).rows[0].v,value,'old '+key);
 await shift(11);
 await db.exec(`insert into invoices(id,tenant_id,shift_id,source,status) values('${id(30)}','${id(1)}','${id(11)}','fnb','cancelled');
 insert into cash_transactions(tenant_id,branch_id,shift_id,type,amount,payment_method,status,reference_type,reference_id) values
 ('${id(1)}','${id(2)}','${id(11)}','receipt',200,'cash','completed','invoice',null),
 ('${id(1)}','${id(2)}','${id(11)}','receipt',500,'transfer','completed','invoice',null),
 ('${id(1)}','${id(2)}','${id(11)}','payment',50,'transfer','completed','invoice_void','${id(30)}'),
 ('${id(1)}','${id(2)}','${id(11)}','receipt',999,'transfer','cancelled','invoice',null);`);
 const before=(await db.query('select count(*) v from cash_transactions')).rows[0].v;
 const result=(await call(11,300,450,300,450)).rows[0].v;
 assert.equal(result.shift.actual_transfer,450);assert.equal(result.shift.close_kind,'end_of_day');assert.equal(result.shift.reconciled_by,id(7));assertions++;
 await eq(`select transfer_difference::float8 v from shifts where id='${id(11)}'`,0,'refund-aware transfer total matches without handover recipient');
 await eq('select count(*) v from cash_transactions',before,'closing does not create a cash expense or a bank handover');
 await shift(12);
 await fails(`select fnb_reconcile_shift_totals_20261022('${id(12)}',100,0,99,0,'end_of_day')`,'SHIFT_TOTALS_CHANGED','changed preview rolls back the entire close');
 await eq(`select status v from shifts where id='${id(12)}'`,'open','stale close stays open');
 await fails(`select fnb_reconcile_shift_totals_20261022('${id(12)}',90,0,100,0,'end_of_day')`,'SHIFT_DIFFERENCE_REASON_REQUIRED','cash shortage needs explanation');
 await eq(`select actual_transfer is null v from shifts where id='${id(12)}'`,true,'failed close does not persist transfer snapshot');
 await call(12,90,1,100,0,'shift_change',"'Đã kiểm tra thiếu tiền'");
 await eq(`select transfer_difference::float8 v from shifts where id='${id(12)}'`,1,'counted transfer difference is saved separately');
 await shift(13);
 await db.exec(`update shifts set starting_cash=0 where id='${id(13)}'`);
 await call(13,0,0,0,0);
 await eq(`select actual_cash::float8 v from shifts where id='${id(13)}'`,0,'explicit zero counted cash can close');
 await shift(14);
 await fails(`select fnb_reconcile_shift_totals_20261022('${id(14)}','NaN',0,100,0,'end_of_day')`,'SHIFT_RECONCILIATION_AMOUNT_INVALID','NaN rejected');
 await fails(`select fnb_reconcile_shift_totals_20261022('${id(14)}',100,'Infinity',100,0,'end_of_day')`,'SHIFT_RECONCILIATION_AMOUNT_INVALID','Infinity rejected');
 await fails(`select fnb_reconcile_shift_totals_20261022('${id(14)}',-1,0,100,0,'end_of_day')`,'SHIFT_RECONCILIATION_AMOUNT_INVALID','negative counted cash rejected');
 await db.exec(`update shifts set cashier_id='${id(8)}' where id='${id(14)}'`);
 await fails(`select fnb_reconcile_shift_totals_20261022('${id(14)}',100,0,100,0,'end_of_day')`,'SHIFT_CLOSE_DENIED','different cashier without manager permission is denied');
 await db.exec(`select set_config('request.jwt.claim.sub','${id(8)}',false)`);
 await call(14);
 await shift(15,'pending_reconcile');
 await call(15,100,0,100,0,'end_of_day','null',"'Quên đóng ca'");
 await eq(`select reconciled_by::text v from shifts where id='${id(15)}'`,id(8),'branch manager can reconcile pending shift with actor audit');
 await db.exec(`select set_config('request.jwt.claim.sub','${id(7)}',false)`);
 await shift(16,'open',3);
 await fails(`select fnb_reconcile_shift_totals_20261022('${id(16)}',100,0,100,0,'end_of_day')`,'SHIFT_BRANCH_DENIED','inaccessible branch is denied');
 await db.exec(`select set_config('request.jwt.claim.sub','${id(9)}',false)`);
 await fails(`select fnb_reconcile_shift_totals_20261022('${id(16)}',100,0,100,0,'end_of_day')`,'SHIFT_NOT_FOUND','other tenant is denied');
 await db.exec(`select set_config('request.jwt.claim.sub','${id(7)}',false);update branches set cascade_mode='production' where id='${id(2)}'`);
 await shift(17);
 await fails(`select fnb_reconcile_shift_totals_20261022('${id(17)}',100,0,100,0,'end_of_day')`,'SHIFT_FNB_BRANCH_REQUIRED','new RPC cannot close a warehouse Retail shift');
 await db.exec(`update branches set cascade_mode='outlet' where id='${id(2)}';delete from shifts where id='${id(17)}'`);
 await fails(`select fnb_reconcile_shift_totals_20261022('${id(10)}',100,0,100,0,'end_of_day')`,'SHIFT_STATE_CHANGED','already closed history cannot be edited');
 await shift(18);
 await db.exec(`insert into invoices(id,tenant_id,shift_id,source,status) values('${id(31)}','${id(1)}','${id(18)}','fnb','cancelled');
 insert into cash_transactions(tenant_id,branch_id,shift_id,type,amount,payment_method,status,reference_type,reference_id) values('${id(1)}','${id(2)}','${id(18)}','payment',50,'transfer','completed','invoice_void','${id(31)}')`);
 await call(18,100,-50,100,-50);
 await eq(`select actual_transfer::float8 v from shifts where id='${id(18)}'`,-50,'refund-only shift can reconcile negative net bank receipts');
 await db.exec(`select set_config('request.jwt.claim.sub','',false)`);
 await fails(`select fnb_reconcile_shift_totals_20261022('${id(18)}',100,-50,100,-50,'end_of_day')`,'SHIFT_AUTH_REQUIRED','anonymous call is denied');
 await eq(`select has_function_privilege('anon','public.fnb_reconcile_shift_totals_20261022(uuid,numeric,numeric,numeric,numeric,text,text,text)','execute') v`,false,'anonymous role has no execution grant');
 await eq(`select has_function_privilege('authenticated','public.fnb_reconcile_shift_totals_20261022(uuid,numeric,numeric,numeric,numeric,text,text,text)','execute') v`,true,'authenticated role can use the guarded RPC');
 await db.exec(`select set_config('request.jwt.claim.sub','${id(7)}',false)`);
 await fails(`insert into cash_transactions(tenant_id,branch_id,shift_id,type,amount,payment_method,status,reference_type) values('${id(1)}','${id(2)}','${id(11)}','receipt',1,'transfer','completed','invoice')`,'SHIFT_RECONCILED_CASH_LOCKED','late receipt cannot enter a newly reconciled shift');
 await fails(`update cash_transactions set amount=amount+1 where shift_id='${id(11)}'`,'SHIFT_RECONCILED_CASH_LOCKED','newly reconciled amounts cannot be silently amended');
 await db.exec(`insert into cash_transactions(tenant_id,branch_id,shift_id,type,amount,payment_method,status,reference_type) values('${id(1)}','${id(2)}','${id(10)}','receipt',1,'cash','completed','invoice')`);
 await eq(`select close_kind is null v from shifts where id='${id(10)}'`,true,'legacy shift posting rules are retained without backfill');
 console.log('All shift totals PostgreSQL cases passed.');
}catch(e){console.error(e);process.exitCode=1;}finally{await db.close();console.log(assertions+' assertions completed');}
