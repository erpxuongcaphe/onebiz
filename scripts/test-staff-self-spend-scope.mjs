import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { initializeStaffAccessFixture } from './staff-access-tests/fixture.mjs';
import { functionFromMigration } from './staff-access-tests/inventory.mjs';

const { PGlite }=createRequire(process.argv[2]||import.meta.url)('@electric-sql/pglite');
const db=new PGlite();
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
try {
 await initializeStaffAccessFixture(db,id);
 await db.exec(await readFile('supabase/migrations/20261111052704_staff_branch_access.sql','utf8'));
 for(const [file,name] of [
  ['20261111070229_staff_branch_checkout_permissions.sql','_staff_permission_at_scope'],
  ['20261111095224_staff_branch_kitchen_permissions.sql','_staff_permission_any_branch'],
 ]) await db.exec(await functionFromMigration(file,name));
 await db.exec(`
  create schema private;
  create function public.get_user_accessible_branches(uuid) returns table(branch_id uuid)
   language sql stable as $$select id from public.branches where public.user_has_branch_access($1,id)$$;
  insert into user_branches(user_id,branch_id) values ('${id(101)}','${id(11)}');
  insert into role_permissions(role_id,permission_code) values
   ('${id(20)}','finance.view_cash_journal_self_spend'),('${id(20)}','finance.view_branch_self_spend_journal');
  create function private.store_cash_custody_actor(p_branch_id uuid,p_day date,p_company_only boolean)
   returns boolean language plpgsql as $$declare v_actor uuid:=auth.uid();begin return public.user_has_permission(v_actor, 'finance.view_cash_journal_self_spend');end$$;
  create function public.get_store_sales_day_collections(p_branch_id uuid,p_day date)
   returns boolean language plpgsql as $$declare v_actor uuid:=auth.uid();begin return public.user_has_permission(v_actor, 'finance.view_cash_journal_self_spend');end$$;
 `);
 for(const name of ['cash_journal_list_v1','cash_journal_list_v2']) await db.exec(`
  create function public.${name}(p_from date,p_to date,p_branch uuid,p_kind text,p_account text,p_search text,p_sort text,p_desc boolean,p_page integer,p_export boolean,p_category text)
   returns uuid[] language plpgsql as $$declare v_actor uuid:=auth.uid();v_tenant uuid:=public.get_user_tenant_id();v_company boolean:=public.user_has_permission(v_actor,'finance.view_cash_journal_company');v_self boolean;v_branches uuid[];begin
    v_self := coalesce(public.user_has_permission(v_actor, 'finance.view_cash_journal_self_spend'), false) or coalesce(public.user_has_permission(v_actor, 'finance.view_branch_self_spend_journal'), false);
    if not (v_company or v_self) then return '{}'::uuid[];end if;
    select coalesce(array_agg(b.id), '{}'::uuid[]) into v_branches
    from public.branches b where b.tenant_id = v_tenant
    and ((v_company and coalesce(public.user_has_permission(v_actor, 'reports.view_all_branches'), false)) or b.id in (select a.branch_id from public.get_user_accessible_branches(v_actor) a));
    return v_branches;
   end$$;
 `);
 await db.exec(await readFile('supabase/migrations/20261113133613_staff_cash_journal_self_spend_scope.sql','utf8'));
 await db.exec(`select set_config('request.jwt.claim.sub','${id(101)}',false);
  insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
   values ('${id(1)}','${id(101)}','${id(10)}','finance.view_cash_journal_self_spend','revoke','${id(100)}');`);
 const call=async()=> (await db.query(`select cash_journal_list_v2(current_date,current_date,null,null,null,null,'day',true,1,false,null) as result`)).rows[0].result;
 assert.deepEqual(await call(),[id(11)]);
 await db.exec(`insert into role_permissions values ('${id(20)}','finance.view_cash_journal_company')`);
 assert.deepEqual(new Set(await call()),new Set([id(10),id(11)]));
 await db.exec(`delete from role_permissions where permission_code='finance.view_cash_journal_company';
  insert into user_permission_overrides(tenant_id,user_id,permission_code,override_type,created_by)
  values ('${id(1)}','${id(101)}','finance.view_cash_journal_self_spend','revoke','${id(100)}');`);
 assert.deepEqual(await call(),[]);
 console.log('PASS self-spend: branch denial, independent company right and global denial');
} finally { await db.close(); }
