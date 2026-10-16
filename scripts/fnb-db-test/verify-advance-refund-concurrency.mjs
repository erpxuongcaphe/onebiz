import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
if(process.env.PGDATABASE!=='party_money_test'||!['localhost','127.0.0.1'].includes(process.env.PGHOST)) throw new Error('Disposable localhost party_money_test database required');
const sql=async text=>(await exec('psql',['-X','-v','ON_ERROR_STOP=1','-At','-c',`set timezone='Asia/Ho_Chi_Minh';select set_config('test.actor',test_id(1)::text,false);${text}`],{env:process.env})).stdout;
await sql(`insert into suppliers(id,tenant_id,name) values(test_id(100),test_id(2),'Concurrent refund fixture');
 select record_supplier_advance(test_id(100),1000,'cash','Concurrent refund source',test_id(3),null);`);
const refund=`select refund_party_advance(gen_random_uuid(),jsonb_build_object('mode','supplier','partyId',test_id(100),'branchId',test_id(3),
 'advanceId',(select id from supplier_advances where supplier_id=test_id(100)), 'amount',700,'paymentMethod','cash',
 'moneyAccountId',(select id from money_accounts where code='CASH-1'),'occurredAt',now(),'transactionDate',current_date,'note','Concurrent unused source refund'));`;
const race=await Promise.allSettled([sql(refund),sql(refund)]);
if(race.filter(r=>r.status==='fulfilled').length!==1||!race.some(r=>r.status==='rejected'&&r.reason.stderr?.includes('ADVANCE_REFUND_EXCEEDS_AVAILABLE'))) throw new Error('Two concurrent refunds did not serialize against the available source');
await sql(`select test_assert((select remaining_amount=300 from supplier_advances where supplier_id=test_id(100)),'concurrent refunds preserve remaining');
 select test_assert((select count(*)=1 and sum(amount)=700 from party_advance_refunds where party_id=test_id(100)),'only one concurrent refund posts cash');`);
const cancel=`select cancel_party_advance_refund((select cash_id from party_advance_refunds where party_id=test_id(100)),'Cancel concurrent fixture refund');`;
await Promise.all([sql(cancel),sql(cancel)]);
await sql(`select test_assert((select remaining_amount=1000 from supplier_advances where supplier_id=test_id(100)),'concurrent cancellation restores source once');`);
console.log('PASS: real parallel PostgreSQL refunds and cancellations never double-consume or double-restore');
