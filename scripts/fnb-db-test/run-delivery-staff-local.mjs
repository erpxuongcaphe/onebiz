import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const { PGlite } = await import(process.argv[2] ? pathToFileURL(path.resolve(process.argv[2])).href : '@electric-sql/pglite');
const db = new PGlite();
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
await db.exec(`create role anon; create role authenticated; create schema auth;
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
create function user_has_permission(uuid,text) returns boolean language sql as $$select coalesce(current_setting('test.permission',true),'yes')='yes'$$;
create function user_has_branch_access(uuid,uuid) returns boolean language sql as $$select $2::text<>coalesce(current_setting('test.denied',true),'')$$;
create table roles(id uuid,tenant_id uuid,name text);
create table profiles(id uuid primary key,tenant_id uuid,branch_id uuid,role text,role_id uuid,is_active boolean,full_name text,pos_pin_hash text,pos_pin_locked_until timestamptz);
create table user_branches(user_id uuid,branch_id uuid);
create table branches(id uuid,tenant_id uuid,is_active boolean);
create table kitchen_orders(id uuid primary key,tenant_id uuid,branch_id uuid,delivery_staff_id uuid,note text);
insert into branches values('${id(10)}','${id(1)}',true),('${id(11)}','${id(1)}',true),('${id(12)}','${id(2)}',true);
insert into roles values('${id(20)}','${id(1)}','Admin'),('${id(21)}','${id(1)}','CEO'),('${id(22)}','${id(1)}','Cửa Hàng Trưởng');
insert into profiles(id,tenant_id,branch_id,role,role_id,is_active,full_name) values
('${id(3)}','${id(1)}',null,'owner',null,true,'Actor'),
('${id(4)}','${id(1)}','${id(10)}','staff',null,true,'A no PIN'),
('${id(5)}','${id(1)}','${id(11)}','staff',null,true,'B'),
('${id(6)}','${id(1)}','${id(10)}','staff',null,false,'Inactive'),
('${id(7)}','${id(1)}','${id(10)}','owner',null,true,'Owner'),
('${id(8)}','${id(1)}','${id(10)}','staff','${id(20)}',true,'Admin'),
('${id(9)}','${id(2)}','${id(12)}','staff',null,true,'Other tenant'),
('${id(13)}','${id(1)}','${id(10)}','staff','${id(21)}',true,'CEO'),
('${id(14)}','${id(1)}','${id(10)}','staff','${id(22)}',true,'Manager');
insert into user_branches values('${id(5)}','${id(10)}'),('${id(9)}','${id(10)}');
update profiles set pos_pin_locked_until=now()+interval '1 hour' where id='${id(4)}';
set test.actor='${id(3)}';`);
await db.exec(readFileSync('supabase/migrations/20261027163753_fnb_delivery_staff_branch_scope.sql','utf8'));
const results=[]; const test=async(name,fn)=>{await fn();results.push({name,passed:true});};
const list=async(branch=10)=>(await db.query('select * from list_fnb_delivery_staff_20261027($1)',[id(branch)])).rows.map(r=>r.id);
const insert=(n,staff,branch=10,tenant=1)=>db.query('insert into kitchen_orders values($1,$2,$3,$4,null)',[id(n),id(tenant),id(branch),staff===null?null:id(staff)]);
await test('home and explicit additional assignment included, no PIN and PIN lock ignored',async()=>assert.deepEqual(await list(),[4,5,14].map(id)));
await test('owner admin CEO inactive and other tenant excluded',async()=>{for(const n of [3,6,7,8,9,13])assert(!(await list()).includes(id(n)));});
await test('other branch receives only assigned staff',async()=>assert.deepEqual(await list(11),[id(5)]));
await test('caller branch permission required',async()=>{await db.exec(`set test.denied='${id(10)}'`);await assert.rejects(list(),/BRANCH_ACCESS_DENIED/);await db.exec("set test.denied=''");});
await test('caller send permission required, target does not need it',async()=>{await db.exec("set test.permission='no'");await assert.rejects(list(),/INSUFFICIENT_PERMISSION/);await insert(30,4);await db.exec("set test.permission='yes'");});
await test('inactive or unauthenticated caller rejected',async()=>{await db.exec(`set test.actor=''`);await assert.rejects(list(),/ACTIVE_PROFILE_REQUIRED/);await db.exec(`set test.actor='${id(6)}'`);await assert.rejects(list(),/ACTIVE_PROFILE_REQUIRED/);await db.exec(`set test.actor='${id(3)}'`);});
await test('cross tenant and null branch rejected',async()=>{await assert.rejects(list(12),/BRANCH_ACCESS_DENIED/);await assert.rejects(db.query('select * from list_fnb_delivery_staff_20261027(null)'),/BRANCH_ACCESS_DENIED/);});
await test('insert rejects a person from another branch or tenant and administrator',async()=>{for(const n of [4,8,9])await assert.rejects(insert(31,n,11),/DELIVERY_STAFF_NOT_AVAILABLE_FOR_BRANCH/);});
await test('unassigned orders remain allowed',async()=>insert(32,null));
await test('explicit multi branch employee may be assigned',async()=>insert(33,5));
await test('reassignment is checked and rejected atomically',async()=>{await assert.rejects(db.query('update kitchen_orders set delivery_staff_id=$1 where id=$2',[id(8),id(30)]),/DELIVERY_STAFF_NOT_AVAILABLE_FOR_BRANCH/);assert.equal((await db.query('select delivery_staff_id from kitchen_orders where id=$1',[id(30)])).rows[0].delivery_staff_id,id(4));});
await test('existing historical assignment survives staff deactivation, checkout style update and can be cleared',async()=>{await db.query('update profiles set is_active=false where id=$1',[id(4)]);await db.query("update kitchen_orders set delivery_staff_id=delivery_staff_id,note='unchanged assignment' where id=$1",[id(30)]);await db.query('update kitchen_orders set delivery_staff_id=null where id=$1',[id(30)]);await assert.rejects(insert(34,4),/DELIVERY_STAFF_NOT_AVAILABLE_FOR_BRANCH/);});
await test('branch changes revalidate assignment',async()=>{await db.query('update kitchen_orders set branch_id=$1 where id=$2',[id(11),id(33)]);await db.query('delete from user_branches where user_id=$1',[id(5)]);await assert.rejects(db.query('update kitchen_orders set branch_id=$1 where id=$2',[id(10),id(33)]),/DELIVERY_STAFF_NOT_AVAILABLE_FOR_BRANCH/);});
await test('RPC grant is limited; internal predicate and trigger not callable by clients',async()=>{const row=(await db.query("select has_function_privilege('authenticated','list_fnb_delivery_staff_20261027(uuid)','execute') a,has_function_privilege('anon','list_fnb_delivery_staff_20261027(uuid)','execute') b,has_function_privilege('authenticated','_fnb_delivery_staff_eligible_20261027(uuid,uuid,uuid)','execute') c,has_function_privilege('authenticated','_guard_fnb_delivery_staff_20261027()','execute') d")).rows[0];assert.deepEqual(row,{a:true,b:false,c:false,d:false});});
console.log(JSON.stringify({passed:results.length,results},null,2));
await db.close();
