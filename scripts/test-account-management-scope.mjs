// Isolated PostgreSQL/WASM checks. Install @electric-sql/pglite@0.5.8 in a separate
// tool folder and set ONEBIZ_PGLITE_MODULE to its dist/index.js. Never uses production.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const modulePath = process.env.ONEBIZ_PGLITE_MODULE;
const { PGlite } = await import(modulePath ? pathToFileURL(resolve(modulePath)).href : '@electric-sql/pglite');
const db = new PGlite();
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
let checks = 0;
const check = (actual, expected, label) => { assert.equal(actual, expected, label); checks++; };
try {
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth; grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table tenants(id uuid primary key);
create table branches(id uuid primary key,tenant_id uuid,is_active boolean default true);
create table profiles(id uuid primary key,tenant_id uuid,role text,role_id uuid,branch_id uuid,is_active boolean default true,full_name text default 'Test employee',email text,phone text,created_at timestamptz default now(),updated_at timestamptz default now());
create table roles(id uuid primary key,tenant_id uuid,name text);
create table role_permissions(role_id uuid,permission_code text);
create table user_permission_overrides(tenant_id uuid,user_id uuid,permission_code text,override_type text);
alter table roles enable row level security; alter table role_permissions enable row level security;
alter table user_permission_overrides enable row level security;
create policy test_role_write on roles for all to authenticated using(true) with check(true);
grant all on roles,role_permissions,user_permission_overrides to authenticated;
create table user_branches(user_id uuid,branch_id uuid,granted_by uuid);
create table test_permissions(user_id uuid,code text);
create table audit_log(id uuid default gen_random_uuid(),tenant_id uuid,user_id uuid,action text,entity_type text,entity_id uuid,old_data jsonb,new_data jsonb);
create function user_has_permission(p_user_id uuid,p_permission_code text) returns boolean language sql stable as $$select exists(select 1 from public.test_permissions where user_id=p_user_id and code=p_permission_code)$$;
create function get_user_effective_permissions(p_user_id uuid) returns table(permission_code text) language sql stable as $$select code from public.test_permissions where user_id=p_user_id$$;
create function get_user_tenant_id() returns uuid language sql stable as $$select tenant_id from public.profiles where id=auth.uid()$$;
create function update_managed_user_atomic(p_target_user_id uuid,p_profile_patch jsonb default '{}',p_branch_ids uuid[] default null) returns jsonb language plpgsql as $$begin return p_profile_patch; end$$;
create function initialize_managed_user_atomic(uuid,text,text,text,uuid,uuid[]) returns jsonb language sql as $$select '{}'::jsonb$$;
create function save_role_atomic(uuid,jsonb,text[]) returns jsonb language plpgsql as $$begin return '{}'::jsonb; end$$;
create function delete_role_atomic(uuid) returns jsonb language plpgsql as $$begin return '{}'::jsonb; end$$;
create function request_pos_pin_reset_00459(uuid) returns jsonb language sql as $$select '{}'::jsonb$$;
create function remove_user_pos_pin(p_target_user_id uuid) returns jsonb language plpgsql as $$begin return '{}'::jsonb; end$$;
insert into tenants values('${id(1)}'),('${id(2)}');
insert into branches(id,tenant_id) values('${id(10)}','${id(1)}'),('${id(11)}','${id(1)}'),('${id(12)}','${id(2)}');
insert into roles(id,tenant_id) values('${id(20)}','${id(1)}'),('${id(21)}','${id(1)}');
insert into role_permissions values('${id(20)}','pos.view'),('${id(21)}','system.manage_roles');
insert into profiles(id,tenant_id,role,branch_id) values
 ('${id(100)}','${id(1)}','owner','${id(10)}'),('${id(101)}','${id(1)}','staff','${id(10)}'),
 ('${id(102)}','${id(1)}','staff','${id(10)}'),('${id(103)}','${id(1)}','staff','${id(11)}'),
 ('${id(104)}','${id(1)}','staff','${id(10)}'),('${id(105)}','${id(2)}','staff','${id(12)}'),
 ('${id(106)}','${id(1)}','staff','${id(10)}'),('${id(107)}','${id(1)}','staff','${id(10)}'),
 ('${id(108)}','${id(1)}','staff','${id(10)}'),('${id(109)}','${id(1)}','staff','${id(10)}');
insert into user_branches(user_id,branch_id) values('${id(104)}','${id(11)}'),('${id(106)}','${id(11)}');
insert into test_permissions values('${id(101)}','pos.view');
`);
// Use the actual legacy initializer, so the new reservation/FK/assignment path
// is exercised with a newly-created Auth user that does not yet have a profile.
await db.exec(await readFile(new URL('../supabase/migrations/00280_atomic_managed_user_initialize.sql',import.meta.url),'utf8'));
// Reproduce PostgreSQL OID dependencies created BEFORE the permission rename.
await db.exec(`
grant usage on schema public to authenticated;
grant select on profiles to authenticated;
create table test_operational_read(id int,tenant_id uuid,branch_id uuid,unit_cost numeric);
insert into test_operational_read values
 (1,'${id(1)}','${id(10)}',125),(2,'${id(1)}','${id(11)}',250),
 (3,'${id(2)}','${id(12)}',999),(4,'${id(1)}','${id(10)}',500);
alter table test_operational_read enable row level security;
grant select,insert,update on test_operational_read to authenticated;
create policy operational_read on test_operational_read for select to authenticated
 using(tenant_id=get_user_tenant_id() and branch_id=(select branch_id from profiles where id=auth.uid())
 and user_has_permission(auth.uid(),'inventory.view'));
create policy operational_restrict on test_operational_read as restrictive for select to authenticated using(id<>4);
create policy operational_insert on test_operational_read for insert to authenticated
 with check(tenant_id=get_user_tenant_id() and user_has_permission(auth.uid(),'inventory.adjust'));
create policy operational_update on test_operational_read for update to authenticated
 using(user_has_permission(auth.uid(),'inventory.adjust'))
 with check(tenant_id=get_user_tenant_id() and user_has_permission(auth.uid(),'inventory.adjust'));
create view test_variants_scoped with(security_barrier=true) as
 select id,case when user_has_permission(auth.uid(),'products.view_cost') then unit_cost else 0 end as cost_price
 from test_operational_read where tenant_id=get_user_tenant_id();
create view test_invoker_scoped with(security_invoker=true,security_barrier=true) as
 select * from test_operational_read where user_has_permission(auth.uid(),'inventory.view');
grant select on test_variants_scoped,test_invoker_scoped to authenticated;
insert into test_permissions values('${id(101)}','inventory.view');
`);
await db.exec(await readFile(new URL('../supabase/migrations/20261102044150_scoped_account_management.sql',import.meta.url),'utf8'));
await db.exec(`select set_config('request.jwt.claim.sub','${id(101)}',false); set role authenticated;`);
await assert.rejects(db.query('select * from test_variants_scoped'),/permission denied/); checks++;
await assert.rejects(db.query('select * from test_operational_read'),/permission denied/); checks++;
await db.exec('reset role');
const viewBefore=(await db.query(`select oid,reloptions,relacl from pg_class where relname='test_variants_scoped'`)).rows[0];
await db.exec(await readFile(new URL('../supabase/migrations/20261102233230_repair_account_permission_dependencies.sql',import.meta.url),'utf8'));
await db.exec(`set role authenticated`);
check((await db.query('select * from test_variants_scoped')).rows.every(r=>Number(r.cost_price)===0),true,'cashier variants load without revealing cost');
check((await db.query('select * from test_operational_read')).rows.length,1,'tenant branch and restrictive policy preserved');
check((await db.query(`select reloptions from pg_class where relname='test_invoker_scoped'`)).rows[0].reloptions.includes('security_invoker=true'),true,'security invoker option is retained');
await assert.rejects(db.query(`insert into test_operational_read values(5,'${id(1)}','${id(10)}',1)`),/row-level security/); checks++;
check((await db.query(`select has_function_privilege('authenticated','user_has_permission_before_account_hierarchy(uuid,text)','execute') as allowed`)).rows[0].allowed,false,'private helper remains private');
await db.exec('reset role');
await db.query(`insert into test_permissions values('${id(101)}','products.view_cost')`);
await db.exec('set role authenticated');
check(Number((await db.query('select cost_price from test_variants_scoped where id=1')).rows[0].cost_price),125,'permitted manager can still read cost');
await db.exec('reset role');
await db.query(`delete from test_permissions where user_id='${id(101)}' and code='products.view_cost'`);
// Repair is repeatable, retains the same view identity/options/grants and no stale dependencies.
await db.exec(await readFile(new URL('../supabase/migrations/20261102233230_repair_account_permission_dependencies.sql',import.meta.url),'utf8'));
check(JSON.stringify((await db.query(`select oid,reloptions,relacl from pg_class where relname='test_variants_scoped'`)).rows[0]),JSON.stringify(viewBefore),'view OID options grants preserved on repeat');
const actor = n => db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[id(n)]);
const allowed = async (target, action='edit', role=null, branches=null, position=null, department=null) =>
 (await db.query('select check_account_management_scope($1,$2,$3,$4,$5,$6) as ok',[target===null?null:id(target),action,role===null?null:id(role),branches?.map(id)??null,position,department])).rows[0].ok;
const reject = async (operation, message) => { await assert.rejects(operation,message); checks++; };
const pos = (key,parentId,scope='branch') => ({id:key,name:key,parentId,scope,depth:'all',permissions:{edit:true,password:true,create:true}});
const assignment = (user,positionId,departmentId=null) => ({userId:id(user),positionId,departmentId,managedBranchIds:[]});
const doc = {positions:[pos('ops',null),pos('store','ops'),pos('shift','store'),pos('staff','shift'),pos('accounting',null)],
 departments:[{id:'kitchen',name:'Kitchen',parentId:null},{id:'bar',name:'Bar',parentId:'kitchen'},{id:'finance',name:'Finance',parentId:null}],
 assignments:[assignment(101,'store','kitchen'),assignment(102,'staff','bar'),assignment(103,'staff','bar'),assignment(104,'staff','bar'),assignment(106,'ops','kitchen'),assignment(107,'store','kitchen')],globalAdminIds:[id(108)]};
await actor(101); check(await allowed(102),false,'permission alone is insufficient');
await actor(100);
const preview = async (document,version) => (await db.query('select preview_account_hierarchy($1,$2) as value',[document,version])).rows[0].value;
const save = async (document,version) => { const p = await preview(document,version); return (await db.query('select save_account_hierarchy($1,$2,$3) as version',[document,version,p.fingerprint])).rows[0].version; };
const bad = structuredClone(doc); bad.assignments.push(assignment(105,'staff'));
await reject(preview(bad,0),'cross-tenant delegation');
const cycle = structuredClone(doc); cycle.positions[0].parentId='staff';
await reject(preview(cycle,0),'cycle rejected');
await save(doc,0);
await reject(save(doc,0),'stale version');
check((await db.query('select get_account_hierarchy_history() as value')).rows[0].value.length,1,'one immutable history version');
check((await db.query('select get_account_hierarchy_version(1) as value')).rows[0].value.after.assignments.length,doc.assignments.length,'history contains exact assignments');
check((await db.query('select get_account_hierarchy_version(1) as value')).rows[0].value.before.positions.length,0,'first history starts with empty default');
const malformed = structuredClone(doc); malformed.positions[0].permissions.password='true';
await reject(preview(malformed,1),'malformed permissions rejected');
await reject(db.query('select save_account_hierarchy($1,1,$2)',[doc,'wrong fingerprint']),'preview fingerprint required');
await actor(101);
check((await db.query('select get_account_management_context() as value')).rows[0].value.canCreate,true,'management context works');
const listed=(await db.query('select get_managed_accounts() as value')).rows[0].value;
check(listed.some(p=>p.id===id(102)),true,'managed account listed');
check(listed.some(p=>p.id===id(103)),false,'outside branch contact omitted');
await reject(db.query('select get_account_hierarchy_history()'),'manager cannot read organization history');
check(await allowed(102),true,'descendant same branch');
check(await allowed(102,'password'),true,'password right');
check(await allowed(103),false,'outside branch');
check(await allowed(104),false,'multi-branch cannot be edited through overlap');
check(await allowed(104,'edit',null,[10]),false,'cannot strip another branch first');
check(await allowed(102,'edit',null,[]),false,'all-branches sentinel rejected');
check(await allowed(105),false,'tenant boundary');
check(await allowed(100),false,'owner protected');
check(await allowed(101),false,'self protected');
check(await allowed(107),false,'peer protected');
check(await allowed(106),false,'supervisor protected');
check(await allowed(108),false,'global administrator protected');
check(await allowed(109),false,'unassigned employee denied');
check(await allowed(102,'edit',21),false,'RBAC role escalation');
check(await allowed(null,'create',20,[10],'staff'),true,'create descendant');
check(await allowed(null,'create',20,[10],'store'),false,'cannot create peer');
check(await allowed(null,'create',20,[10],null),false,'new employee needs position');
check((await db.query('select user_has_permission($1,$2) as ok',[id(101),'system.reset_user_password'])).rows[0].ok,true,'configured position visible in effective permissions');
await reject(db.query(`select update_managed_user_atomic('${id(103)}','{}',null)`),'RPC bypass blocked');
await reject(db.query(`select save_role_atomic('${id(20)}','{}',null)`),'shared-role bypass blocked');
await reject(db.query(`select initialize_managed_user_atomic('${id(107)}','x',null,null,'${id(20)}',array['${id(10)}']::uuid[])`),'initializer cannot overwrite existing manager');
await reject(db.query(`select remove_user_pos_pin('${id(103)}')`),'direct PIN removal bypass blocked');
await db.exec('set role authenticated');
await reject(db.query(`select reserve_account_creation('${id(102)}','${id(101)}','staff',null)`),'creation reservation is server-only');
await reject(db.query(`select begin_managed_password_reset('${id(100)}','${id(102)}')`),'password reset audit cannot spoof owner');
await reject(db.query(`select update_managed_user_before_scope('${id(103)}','{}',null)`),'renamed legacy mutator is private');
await reject(db.query(`select _account_decision('${id(100)}','${id(102)}','edit')`),'internal decision cannot spoof owner');
await reject(db.query(`insert into roles(id,tenant_id) values('${id(22)}','${id(1)}')`),'direct RLS write blocked');
await db.exec('reset role');
await actor(106); check(await allowed(101,'password'),true,'higher configured supervisor may manage lower manager');
await actor(100);
const dept = structuredClone(doc); dept.positions.find(p=>p.id==='store').scope='department';
await save(dept,1);
await actor(101); check(await allowed(103),true,'department scope across branches explicitly granted');
await actor(100);
const parallel = structuredClone(dept); parallel.assignments.find(a=>a.userId===id(103)).departmentId='finance';
await save(parallel,2);
await actor(101); check(await allowed(103),false,'parallel department denied');
await db.query(`insert into user_permission_overrides values('${id(1)}','${id(101)}','system.reset_user_password','revoke')`);
check(await allowed(102,'password'),false,'explicit revoke wins over position');
await db.query(`insert into user_permission_overrides values('${id(1)}','${id(101)}','system.create_user','revoke')`);
check(await allowed(null,'create',20,[10],'staff'),false,'create revoke blocks direct RPC');
check((await db.query('select get_account_management_context() as value')).rows[0].value.canCreate,false,'create revoke reflected in UI');
await actor(108); check(await allowed(103),true,'explicit global delegation'); check(await allowed(100),false,'global is not owner');
await actor(100); check(await allowed(103),true,'owner retains existing access');
await db.query(`insert into auth.users(id) values('${id(110)}')`);
await db.query(`select reserve_account_creation('${id(110)}','${id(100)}','staff','bar')`);
await db.query(`select initialize_managed_user_atomic('${id(110)}','New employee',null,'0900000000','${id(20)}',array['${id(11)}']::uuid[])`);
check((await db.query(`select branch_id from profiles where id='${id(110)}'`)).rows[0].branch_id,id(11),'new profile created with requested branch');
check((await db.query(`select document->'assignments' as value from account_hierarchy_config where tenant_id='${id(1)}'`)).rows[0].value.some(a=>a.userId===id(110)),true,'new employee assigned atomically');
await reject(db.query(`select initialize_managed_user_atomic('${id(110)}','Replay',null,null,'${id(20)}',array['${id(10)}']::uuid[])`),'creation reservation cannot replay');
const auditId=(await db.query(`select begin_managed_password_reset('${id(100)}','${id(110)}') as id`)).rows[0].id;
await db.query('select complete_managed_password_reset($1,true)',[auditId]);
check((await db.query('select action from audit_log where id=$1',[auditId])).rows[0].action,'password_reset_completed','reset audit recorded without credentials');
await db.query(`select save_role_atomic('${id(20)}','{}',null)`);
await db.query(`update profiles set is_active=false where id='${id(101)}'`);
await actor(101); check(await allowed(102),false,'inactive manager denied');
console.log(`Account hierarchy: ${checks} PostgreSQL/WASM checks passed. No production contacted.`);
if (process.argv.includes('--unified-staff')) {
  const { testStaffAccess } = await import('./test-staff-access.mjs');
  await testStaffAccess(db, id);
}
} catch(error) { console.error(error.message, error.code, error.where ?? '', 'position', error.position, 'internal', error.internalQuery); if(error.query && error.position) console.error(error.query.slice(Math.max(0, Number(error.position)-220), Number(error.position)+120)); process.exitCode=1; }
finally { await db.close(); }
