import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {initializeStaffAccessFixture} from './staff-access-tests/fixture.mjs';
import {functionFromMigration} from './staff-access-tests/inventory.mjs';

const {PGlite}=createRequire(process.argv[2]||import.meta.url)('@electric-sql/pglite');
const db=new PGlite();
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
try {
 await initializeStaffAccessFixture(db,id);
 await db.exec(await readFile('supabase/migrations/20261111052704_staff_branch_access.sql','utf8'));
 await db.exec(`create schema extensions;
  create table public.tenant_settings(tenant_id uuid,key text,value jsonb,description text,updated_by uuid,updated_at timestamptz default now(),unique(tenant_id,key));
  create function public.get_user_effective_permissions_before_account_hierarchy(p_user uuid) returns table(permission_code text) language sql stable as $$
   select rp.permission_code from role_permissions rp join profiles p on p.role_id=rp.role_id where p.id=p_user and not exists(select 1 from user_permission_overrides o where o.user_id=p_user and o.permission_code=rp.permission_code and o.override_type='revoke')
   union select o.permission_code from user_permission_overrides o where o.user_id=p_user and o.override_type='grant'$$;
  create function public._account_position_permission(uuid,text) returns boolean language sql stable as $$select false$$;
  create function public.get_user_effective_permissions(p_user_id uuid) returns table(permission_code text) language plpgsql stable as $$begin
   return query select p.permission_code from public.get_user_effective_permissions_before_account_hierarchy(p_user_id) p
   union select code from unnest(array['system.manage_users','system.reset_user_password','system.create_user']) code where public._account_position_permission(p_user_id,code);
  end$$;
  insert into role_permissions(role_id,permission_code) values ('${id(20)}','inventory.lock');`);
 await db.exec(await functionFromMigration('00095_tenant_settings.sql','set_tenant_setting'));
 const migration=await readFile('supabase/migrations/20261113135408_staff_explicit_inventory_lock.sql','utf8');
 await db.exec(`insert into user_permission_overrides(tenant_id,user_id,permission_code,override_type,created_by)
  values ('${id(1)}','${id(101)}','inventory.lock','grant','${id(100)}')`);
 await assert.rejects(db.exec(migration),/STAFF_INVENTORY_LOCK_EXISTING_GRANT_REQUIRES_REVIEW/);
 await db.exec('rollback');
 await db.exec("delete from user_permission_overrides where permission_code='inventory.lock'");
 await db.exec(migration);
 const q=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
 await q("select set_config('request.jwt.claim.sub',$1,false)",[id(101)]);
 await assert.rejects(q("select set_tenant_setting('inventory_lock','{\"locked\":true}',null)"),/PERMISSION_DENIED/);
 assert.equal(await q("select count(*) from get_user_effective_permissions($1) where permission_code='inventory.lock'",[id(101)]),0);
 await q("select set_config('request.jwt.claim.sub',$1,false)",[id(100)]);
 const snapshot=await q('select get_staff_profile_access($1)',[id(101)]);
 assert.equal(snapshot.user.platformRole,'staff');
 const draft={roleId:snapshot.user.roleId,branchIds:snapshot.user.branchIds,assignments:[],exceptions:[...snapshot.exceptions,{branchId:null,permissionCode:'inventory.lock',choice:'grant'}]};
 await q('select save_staff_profile_access($1,$2,$3)',[id(101),snapshot.fingerprint,draft]);
 await q("select set_config('request.jwt.claim.sub',$1,false)",[id(101)]);
 await q("select set_tenant_setting('inventory_lock','{\"locked\":true}',null)");
 assert.equal(await q("select count(*) from get_user_effective_permissions($1) where permission_code='inventory.lock'",[id(101)]),1);
 await assert.rejects(q("select set_tenant_setting('unrelated_setting','{}',null)"),/PERMISSION_DENIED/);
 await db.exec(`update user_permission_overrides set override_type='revoke' where user_id='${id(101)}' and permission_code='inventory.lock'`);
 await assert.rejects(q("select set_tenant_setting('inventory_lock','{\"locked\":false}',null)"),/PERMISSION_DENIED/);
 console.log('PASS stock lock: inherited rights unchanged, explicit grant, unrelated setting denied, revocation');
} finally {await db.close();}
