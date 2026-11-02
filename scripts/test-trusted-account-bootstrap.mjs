// Disposable Auth-trigger integration; never connects to the production project.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const { PGlite } = await import(pathToFileURL(resolve(process.env.ONEBIZ_PGLITE_MODULE)).href);
const db = new PGlite();
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
let checks=0;
const check=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
try {
 await db.exec(`create schema auth;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}');
 create table tenants(id uuid primary key default gen_random_uuid(),name text,slug text);
 create table branches(id uuid primary key default gen_random_uuid(),tenant_id uuid references tenants(id),name text,is_default boolean);
 create table roles(id uuid primary key,tenant_id uuid references tenants(id));
 create table profiles(id uuid primary key,tenant_id uuid references tenants(id),branch_id uuid,role_id uuid,full_name text,email text,phone text,role text);
 create table code_sequences(tenant_id uuid,entity_type text,prefix text,padding int);
 insert into tenants(id) values('${id(1)}'),('${id(2)}');
 insert into roles values('${id(10)}','${id(1)}'),('${id(11)}','${id(2)}');
 insert into branches(id,tenant_id) values('${id(20)}','${id(1)}'),('${id(21)}','${id(2)}');`);
 await db.exec(await readFile(new URL('../supabase/migrations/00029_invite_staff.sql',import.meta.url),'utf8'));
 await db.exec(`create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user()`);
 await db.exec(await readFile(new URL('../supabase/migrations/20261102180654_trusted_account_bootstrap.sql',import.meta.url),'utf8'));
 const create=(n,user={},app={})=>db.query('insert into auth.users values($1,$2,$3,$4)',[id(n),`fixture-${n}@example.test`,user,app]);
 for(const payload of [{invited_tenant_id:id(1),invited_role:'owner'},{invited_role_id:id(10)},{invited_branch_id:id(20)},{invited_role:'owner'}]) {
  await assert.rejects(create(100,payload),/MANAGED_ACCOUNT_SERVER_CONTEXT_REQUIRED/);checks++;
 }
 check((await db.query('select count(*)::int as n from profiles')).rows[0].n,0,'rejected requests create no profile');
 check((await db.query('select count(*)::int as n from auth.users')).rows[0].n,0,'rejected insert rolls back the Auth record');
 await create(101,{full_name:'Managed fixture',invited_tenant_id:id(2),invited_role_id:id(11),invited_branch_id:id(21),invited_role:'owner'},
  {managed_tenant_id:id(1),managed_role_id:id(10),managed_branch_id:id(20)});
 const profile=(await db.query('select tenant_id,role_id,branch_id,role from profiles where id=$1',[id(101)])).rows[0];
 check(profile,{tenant_id:id(1),role_id:id(10),branch_id:id(20),role:'staff'},'trusted server context wins over all poisoned user fields');
 await assert.rejects(create(102,{}, {managed_tenant_id:id(1),managed_role_id:id(11)}));checks++;
 await assert.rejects(create(102,{}, {managed_tenant_id:id(1),managed_branch_id:id(21)}));checks++;
 await assert.rejects(create(102,{}, {managed_tenant_id:id(999)}));checks++;
 await create(103,{full_name:'Bootstrap fixture'});
 const bootstrap=(await db.query('select tenant_id,role from profiles where id=$1',[id(103)])).rows[0];
 check(bootstrap.role,'owner','independent tenant bootstrap retained');
 check([id(1),id(2)].includes(bootstrap.tenant_id),false,'bootstrap never joins an existing tenant');
 check((await db.query('select count(*)::int as n from code_sequences where tenant_id=$1',[bootstrap.tenant_id])).rows[0].n,15,'new-tenant sequences retained');
 check((await db.query('select count(*)::int as n from profiles where tenant_id=$1',[id(2)])).rows[0].n,0,'untrusted target tenant unchanged');
 console.log(`Trusted account bootstrap: ${checks} PostgreSQL/WASM checks passed. No production contacted.`);
} finally { await db.close(); }
