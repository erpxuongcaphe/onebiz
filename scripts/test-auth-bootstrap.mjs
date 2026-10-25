import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const {PGlite}=createRequire(process.argv[2] || import.meta.url)('@electric-sql/pglite');
const db=new PGlite();let checks=0;
const check=(condition,message)=>{assert.ok(condition,message);checks++;};
try {
 await db.exec(`create schema auth; create role anon; create role authenticated;
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create table public.profiles(id uuid primary key,tenant_id uuid,branch_id uuid,role_id uuid,full_name text,email text,phone text,role text,is_active boolean,created_at timestamptz,pos_pin_hash text);
 create table public.tenants(id uuid primary key,name text,settings jsonb);
 create table public.branches(id uuid primary key,tenant_id uuid,name text,is_active boolean,is_default boolean);
 create table public.role_permissions(role_id uuid,permission_code text);
 create table public.user_permission_overrides(tenant_id uuid,user_id uuid,permission_code text,override_type text);
 create table public.user_branches(user_id uuid,branch_id uuid);
 `);
 for(const file of ['00050_multi_branch_user_access.sql','00114_fix_effective_permissions_ambiguity.sql']) {
  const sql=readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8');
  const name=file.startsWith('00050')?'get_user_accessible_branches':'get_user_effective_permissions';
  const start=sql.toLowerCase().indexOf('create or replace function public.'+name);
  const tail=sql.slice(start);const end=tail.indexOf('$$;',tail.indexOf('AS $$')+5);
  await db.exec(tail.slice(0,end+3));
 }
 await db.exec(readFileSync(new URL('../supabase/migrations/202610250001_auth_bootstrap_snapshot.sql',import.meta.url),'utf8'));
 const ids={a:'00000000-0000-0000-0000-000000000001',b:'00000000-0000-0000-0000-000000000002',user:'00000000-0000-0000-0000-000000000003',other:'00000000-0000-0000-0000-000000000004',branch:'00000000-0000-0000-0000-000000000005',warehouse:'00000000-0000-0000-0000-000000000006',foreign:'00000000-0000-0000-0000-000000000007',role:'00000000-0000-0000-0000-000000000008'};
 const {a,b,user,other,branch,warehouse,foreign,role}=ids;
 await db.exec(`insert into tenants values('${a}','Tenant A','{}'),('${b}','Tenant B','{}');
 insert into branches values('${branch}','${a}','Assigned',true,false),('${warehouse}','${a}','Warehouse',true,true),('${foreign}','${b}','Foreign',true,true);
 insert into profiles values('${user}','${a}','${branch}','${role}','Fixture','fixture@example.test',null,'staff',true,now(),'SECRET_PIN_HASH'),('${other}','${b}','${foreign}',null,'Other',null,null,'owner',true,now(),'OTHER_SECRET');
 insert into role_permissions values('${role}','pos_fnb.send_kitchen'),('${role}','pos_fnb.checkout');
 insert into user_permission_overrides values('${a}','${user}','pos_fnb.checkout','revoke'),('${a}','${user}','pos_fnb.merge_orders','grant');
 `);
 const snapshot=async(actor=user)=>{await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);return (await db.query('select get_my_auth_bootstrap() value')).rows[0].value;};
 let d=await snapshot();check(d.profile.id===user,'self only');check(!JSON.stringify(d).includes('SECRET'),'no PIN/hash');
 check(d.branches.length===1&&d.branches[0].id===branch,'assigned only');
 check(d.permissions.includes('pos_fnb.merge_orders')&&!d.permissions.includes('pos_fnb.checkout'),'grants/revokes preserved');
 check(d.tenant.id===a&&!JSON.stringify(d).includes('Tenant B'),'tenant scope');
 await db.exec(`insert into user_branches values('${user}','${warehouse}');`);d=await snapshot();check(d.branches.length===2,'multi branch preserved');
 await db.exec(`delete from user_branches; insert into role_permissions values('${role}','system.manage_branches');`);d=await snapshot();check(d.branches.length===1,'management permission does not widen scope');
 await db.exec(`insert into role_permissions values('${role}','reports.view_all_branches');`);d=await snapshot();check(d.branches.length===2,'explicit all-branch grant');check(!d.branches.some(x=>x.id===foreign),'all stays in tenant');
 await db.exec(`update branches set is_active=false where id='${warehouse}';`);d=await snapshot();check(d.branches.length===1,'inactive branches excluded');
 await db.exec(`update profiles set role='owner' where id='${user}';`);d=await snapshot();check(d.permissions.length===1&&d.permissions[0]==='*','owner semantics');
 await db.exec(`update profiles set is_active=false where id='${user}';`);d=await snapshot();check(d.permissions.length===0&&d.branches.length===0&&d.tenant===null,'inactive owner denied');
 d=await snapshot('00000000-0000-0000-0000-000000000099');check(d.profile===null&&d.permissions.length===0,'missing profile denied');
 await assert.rejects(snapshot(''),/AUTH_REQUIRED/);checks++;
 const acl=(await db.query("select has_function_privilege('anon','public.get_my_auth_bootstrap()','execute') anon,has_function_privilege('authenticated','public.get_my_auth_bootstrap()','execute') authenticated")).rows[0];check(!acl.anon&&acl.authenticated,'only authenticated execute');
 check((await db.query("select count(*) n from pg_proc where pronamespace='public'::regnamespace and proname='get_my_auth_bootstrap' and pronargs<>0")).rows[0].n===0,'no impersonation parameter');
 console.log(JSON.stringify({checks,status:'passed',database:'isolated in-memory fixtures only'}));
} finally {await db.close();}
