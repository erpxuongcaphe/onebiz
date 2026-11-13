import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,readdir} from 'node:fs/promises';
import {initializeStaffAccessFixture} from './staff-access-tests/fixture.mjs';
const {PGlite}=createRequire(process.argv[2]||import.meta.url)('@electric-sql/pglite');
const db=new PGlite();const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
try {
 await initializeStaffAccessFixture(db,id);
 await db.exec(await readFile('supabase/migrations/20261111052704_staff_branch_access.sql','utf8'));
 const hold=await readFile('supabase/migrations/20261113154135_staff_access_hold_partial_rollout.sql','utf8');
 const release=await readFile('supabase/migrations/20261113154146_staff_access_release_after_full_rollout.sql','utf8');
 const versions=[...release.matchAll(/'(\d{14})'/g)].map(x=>x[1]);
 const files=await readdir('supabase/migrations');
 assert.equal(versions.length,107);assert.equal(new Set(versions).size,107);
 for(const version of versions)assert.equal(files.filter(x=>x.startsWith(version+'_')).length,1,`missing or duplicate migration ${version}`);
 await db.exec(hold);
 const canSave=async()=> (await db.query("select has_function_privilege('authenticated','public.save_staff_profile_access(uuid,text,jsonb)','execute') ok")).rows[0].ok;
 assert.equal(await canSave(),false);
 await db.exec('create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key)');
 await assert.rejects(db.exec(release),/STAFF_ROLLOUT_INCOMPLETE/);await db.exec('rollback');assert.equal(await canSave(),false);
 await db.exec(`insert into supabase_migrations.schema_migrations values ${versions.map(x=>`('${x}')`).join(',')}`);
 await db.exec(`insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values ('${id(1)}','${id(101)}','${id(10)}','pos_fnb.split_bill','revoke','${id(100)}')`);
 await assert.rejects(db.exec(release),/STAFF_ROLLOUT_UNEXPECTED_BRANCH_OVERRIDES/);await db.exec('rollback');assert.equal(await canSave(),false);
 await db.exec('delete from user_branch_permission_overrides');await db.exec(release);assert.equal(await canSave(),true);
 console.log('PASS rollout hold: partial rollout blocked, unknown overrides blocked, complete history unlocks');
} finally {await db.close();}
