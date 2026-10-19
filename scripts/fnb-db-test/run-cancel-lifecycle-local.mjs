// Synthetic in-memory PostgreSQL only. No production credentials or connections.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
const {PGlite}=await import(pathToFileURL(path.resolve(process.argv[2])).href);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'onebiz-cancel-lifecycle-'));
const generated=path.join(dir,'chain.sql'),voidCore=path.join(dir,'void.sql');
execFileSync(process.execPath,['scripts/fnb-db-test/extract-void-core.mjs',voidCore]);
execFileSync(process.execPath,['scripts/fnb-db-test/extract-unpaid-cancel.mjs',generated]);
function expand(file){return fs.readFileSync(file,'utf8').replace(/^\\i(r?)\s+(.+)$/gm,(_m,relative,target)=>expand(relative?path.resolve(path.dirname(file),target.trim()):(target.trim()==='/tmp/fnb-void-core.sql'?voidCore:generated))).replace(/^\\set.*$/gm,'');}
function extract(file,name){const source=fs.readFileSync(file,'utf8');const start=source.search(new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${name}\\s*\\(`,'i'));if(start<0)throw Error(name);const rest=source.slice(start),m=/\bas\s+(\$[a-z_]*\$)/i.exec(rest);return rest.slice(0,rest.indexOf(m[1]+';',m.index+m[0].length)+m[1].length+1);}
const db=new PGlite();
try{
 await db.exec(expand(path.resolve('supabase/tests/00472_fnb_cancel_toppings_json_null.integration.sql')));
 await db.exec(`alter table manager_otp_codes add code_hash text,add expires_at timestamptz default now()+interval '2 minutes',add created_at timestamptz default now(),add used_for_target jsonb;
 create function hash_manager_otp(text,uuid,uuid) returns text language sql immutable as $$select md5($1||$2::text||$3::text)$$;
 create table manager_approval_requests(id uuid,tenant_id uuid,requested_by uuid);
 create or replace function issue_manager_otp(text,jsonb,uuid,text,text) returns jsonb language plpgsql as $$
 declare v uuid:=gen_random_uuid(); t uuid; begin
 select tenant_id into t from profiles where id=auth.uid();
 insert into manager_otp_codes(id,tenant_id,branch_id,action_code,target_meta,issued_by,code_hash)
 values(v,t,$3,$1,$2,auth.uid(),hash_manager_otp('123456',t,auth.uid()));
 return jsonb_build_object('success',true,'otp_id',v,'code','123456','expires_at',now()+interval '2 minutes','action_code',$1);
 end $$;`);
 await db.exec(extract('supabase/migrations/00061_manager_otp_codes.sql','verify_and_use_manager_otp'));
 await db.exec('alter function verify_and_use_manager_otp(text,text,jsonb) rename to _verify_and_use_manager_otp_before_00566;');
 await db.exec(extract('supabase/migrations/00566_manager_approval_requests.sql','verify_and_use_manager_otp'));
 const migration=fs.readFileSync('supabase/migrations/202610190001_fnb_cancel_request_lifecycle.sql','utf8');
 await db.exec(migration);await db.exec(migration);
 await db.exec(`
 update kitchen_order_items set quantity=3,cancelled_qty=0,note=null where id=test_id(20);
 update kitchen_orders set status='ready',discount_amount=0 where id=test_id(10);
 do $$ declare r jsonb; reopened jsonb; changed jsonb; issued jsonb; response jsonb; otp uuid; before_events int; begin
 perform set_config('test.actor',test_id(4)::text,false);
 r:=fnb_request_cancel_00455(test_id(10),jsonb_build_array(jsonb_build_object('id',test_id(20),'quantity',1)),'Nhập nhầm',false);
 reopened:=fnb_request_cancel_00455(test_id(10),jsonb_build_array(jsonb_build_object('id',test_id(20),'quantity',1)),'Nhập nhầm',false);
 perform test_assert(r->>'id'=reopened->>'id','reopening identical action reuses request');
 perform set_config('test.actor',test_id(1)::text,false);
 issued:=fnb_issue_cancel_otp_00455((r->>'id')::uuid);otp:=(issued->>'otp_id')::uuid;
 perform set_config('test.actor',test_id(4)::text,false);
 reopened:=fnb_request_cancel_00455(test_id(10),jsonb_build_array(jsonb_build_object('id',test_id(20),'quantity',1)),'Nhập nhầm',false);
 perform test_assert(reopened->>'id'=r->>'id','issued request survives reopen');
 perform test_assert((select otp_id=otp from fnb_cancel_requests where id=(r->>'id')::uuid),'reopen keeps current OTP');
 perform test_reject(format('select fnb_verify_execute_cancel_20261019(%L,%L,%L)',r->>'id','123456',test_id(99)),'FNB_CANCEL_SHIFT_NOT_OPEN_FOR_USER_BRANCH');
 perform test_assert((select used_at is null from manager_otp_codes where id=otp),'business failure rolls back OTP consumption');
 perform test_assert((select cancelled_qty=0 from kitchen_order_items where id=test_id(20)),'business failure cancels nothing');
 response:=fnb_verify_execute_cancel_20261019((r->>'id')::uuid,'123456');
 select count(*) into before_events from pos_exception_events;
 perform test_assert(fnb_verify_execute_cancel_20261019((r->>'id')::uuid,'123456')=response,'lost-response retry returns same result');
 perform test_assert((select count(*)=before_events from pos_exception_events),'retry creates no duplicate event');
 r:=fnb_request_cancel_00455(test_id(10),jsonb_build_array(jsonb_build_object('id',test_id(20),'quantity',1)),'Khách đổi món',false);
 changed:=fnb_request_cancel_00455(test_id(10),jsonb_build_array(jsonb_build_object('id',test_id(20),'quantity',2)),'Khách đổi món',false);
 perform test_assert((changed->>'whole_bill')::boolean,'last remaining items automatically become whole-bill cancellation');
 perform test_assert((select expires_at<=now() from fnb_cancel_requests where id=(r->>'id')::uuid),'changed scope expires previous request');
 perform set_config('test.actor',test_id(1)::text,false);
 perform test_reject(format('select fnb_issue_cancel_otp_00455(%L)',r->>'id'),'FNB_CANCEL_ORDER_CHANGED');
 issued:=fnb_issue_cancel_otp_00455((changed->>'id')::uuid);otp:=(issued->>'otp_id')::uuid;
 perform set_config('test.actor',test_id(4)::text,false);
 perform test_reject(format('select fnb_verify_execute_cancel_20261019(%L,%L)',r->>'id','123456'),'FNB_CANCEL_OTP_INVALID');
 perform test_assert((select used_at is null from manager_otp_codes where id=otp),'wrong request never consumes another request code');
 -- Existing fixture deliberately issues identical digits. Exact token mismatch must roll back.
 response:=fnb_verify_execute_cancel_20261019((changed->>'id')::uuid,'123456');
 perform test_assert((select status='cancelled' from kitchen_orders where id=test_id(10)),'last-item flow closes bill');
 perform test_assert((select current_order_id=test_id(11) and status='occupied' from restaurant_tables where id=test_id(9)),'sibling bill/table preserved');
 perform set_config('test.actor',test_id(5)::text,false);
 perform test_reject(format('select fnb_verify_execute_cancel_20261019(%L,%L)',changed->>'id','123456'),'CANCEL_REQUEST_NOT_FOUND');
 perform test_assert(not has_function_privilege('anon','fnb_verify_execute_cancel_20261019(uuid,text,uuid)','EXECUTE'),'anonymous cannot verify cancellation');
 end $$;`);
 const timingMigration=fs.readFileSync('supabase/migrations/202610190002_fnb_cancel_approval_timing.sql','utf8');
 await db.exec(timingMigration.replace(/\r?\n/g,'\r\n'));await db.exec(timingMigration);
 await db.exec(`
 update kitchen_order_items set quantity=3,cancelled_qty=0,note=null where id=test_id(20);
 update kitchen_orders set status='ready',discount_amount=0 where id=test_id(10);
 do $$ declare r jsonb; renewed jsonb; issued jsonb; otp uuid; old_id uuid; begin
 perform set_config('test.actor',test_id(4)::text,false);
 r:=fnb_request_cancel_20261019(test_id(10),jsonb_build_array(jsonb_build_object('id',test_id(20),'quantity',1)),'Xin duyệt theo thời gian',false);
 perform test_assert(r->>'status'='pending','cashier sees waiting state');
 perform test_assert((r->>'expires_at')::timestamptz-(r->>'created_at')::timestamptz=interval '10 minutes','new request waits exactly ten minutes');
 perform test_assert(fnb_request_cancel_20261019(test_id(10),jsonb_build_array(jsonb_build_object('id',test_id(20),'quantity',1)),'Xin duyệt theo thời gian',false)=r,'reopening does not reset clocks');
 -- Approve at the last second of the waiting window.
 update fnb_cancel_requests set created_at=now()-interval '9 minutes 59 seconds',expires_at=now()+interval '1 second' where id=(r->>'id')::uuid;
 perform set_config('test.actor',test_id(1)::text,false);
 issued:=fnb_issue_cancel_otp_00455((r->>'id')::uuid);otp:=(issued->>'otp_id')::uuid;
 perform test_assert((select expires_at=now()+interval '2 minutes' from fnb_cancel_requests where id=(r->>'id')::uuid),'late manager approval receives full two minutes');
 perform test_reject(format('select fnb_issue_cancel_otp_00455(%L)',r->>'id'),'FNB_CANCEL_OTP_STILL_ACTIVE');
 perform test_assert(jsonb_array_length(fnb_pending_cancel_requests_00455())>0,'manager sees request metadata');
 perform test_assert(exists(select 1 from jsonb_array_elements(fnb_pending_cancel_requests_00455()) e where e->>'id'=r->>'id' and e->'approval'->>'status'='issued'),'manager sees issued state and authoritative expiry');
 perform set_config('test.actor',test_id(4)::text,false);
 perform test_assert(fnb_cancel_status_20261019((r->>'id')::uuid)->>'status'='issued','cashier sees manager issue');
 -- Expiry is simulated by changing timestamps, never waiting or touching live data.
 update fnb_cancel_requests set expires_at=now()-interval '1 second' where id=(r->>'id')::uuid;
 update manager_otp_codes set expires_at=now()-interval '1 second' where id=otp;
 perform test_assert(fnb_cancel_status_20261019((r->>'id')::uuid)->>'status'='otp_expired','expired code is distinct from waiting expiry');
 old_id:=(r->>'id')::uuid;
 renewed:=fnb_renew_cancel_20261019(old_id);
 perform test_assert(renewed->>'id'<>r->>'id' and renewed->>'status'='pending','inline code renewal makes one new waiting request');
 perform test_assert((renewed->>'expires_at')::timestamptz=now()+interval '10 minutes','renewed request gets ten minutes');
 perform test_assert(fnb_renew_cancel_20261019(old_id)=renewed,'retry lost renewal response reuses current request');
 perform test_assert(fnb_cancel_status_20261019(old_id)->>'status'='superseded','old request retained with superseded state');
 perform test_reject(format('select fnb_verify_execute_cancel_20261019(%L,%L)',old_id,'123456'),'FNB_CANCEL_ORDER_CHANGED');
 r:=renewed;
 update fnb_cancel_requests set expires_at=now()-interval '1 second' where id=(r->>'id')::uuid;
 perform test_assert(fnb_cancel_status_20261019((r->>'id')::uuid)->>'status'='request_expired','waiting expiry has its own state');
 renewed:=fnb_renew_cancel_20261019((r->>'id')::uuid);
 perform test_assert(renewed->>'status'='pending','cashier renews waiting request without re-entering items or reason');
 update kitchen_order_items set note='changed after approval request' where id=test_id(20);
 update fnb_cancel_requests set expires_at=now()-interval '1 second' where id=(renewed->>'id')::uuid;
 perform test_assert(fnb_cancel_status_20261019((renewed->>'id')::uuid)->>'status'='changed','changed bill overrides expiry state');
 perform test_reject(format('select fnb_renew_cancel_20261019(%L)',renewed->>'id'),'FNB_CANCEL_ORDER_CHANGED');
 perform set_config('test.actor',test_id(5)::text,false);
 perform test_reject(format('select fnb_cancel_status_20261019(%L)',renewed->>'id'),'CANCEL_REQUEST_NOT_FOUND');
 perform test_reject(format('select fnb_renew_cancel_20261019(%L)',renewed->>'id'),'CANCEL_REQUEST_NOT_FOUND');
 perform test_assert(not has_function_privilege('anon','fnb_cancel_status_20261019(uuid)','EXECUTE'),'anonymous cannot inspect approval');
 perform test_assert(not has_function_privilege('authenticated','_fnb_cancel_status_20261019(uuid)','EXECUTE'),'internal status helper is not publicly callable');
 perform test_assert((select cancelled_qty=0 from kitchen_order_items where id=test_id(20)),'timers and renewal never cancel a bill');
 end $$;`);
 console.log('PASS: cancellation regressions, atomic OTP rollback/replay, ten-minute waiting, full two-minute late issue, no duplicate issue, server status for both actors, inline expired request/code renewal, idempotent renewal retry, supersession history, changed-bill and actor/anonymous boundaries.');
}catch(e){console.error(e.message,e.where??'');process.exitCode=1;}finally{await db.close();}
