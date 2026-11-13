import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { initializeStaffAccessFixture } from "./staff-access-tests/fixture.mjs";
import { functionFromMigration } from "./staff-access-tests/inventory.mjs";

const db=new PGlite();
const id=(n)=>`00000000-0000-0000-0000-${String(n).padStart(12,"0")}`;
const migration=(name)=>readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),"utf8");
try {
  await initializeStaffAccessFixture(db,id);
  await db.exec(await migration("20261111052704_staff_branch_access.sql"));
  await db.exec(await functionFromMigration("20261111070229_staff_branch_checkout_permissions.sql","_staff_permission_at_scope"));
  await db.exec(await readFile(new URL("./staff-access-tests/party-directory-scope-baseline.sql",import.meta.url),"utf8"));
  await db.exec(await migration("20261114034000_staff_party_directory_scope_v2.sql"));
  assert.equal((await db.query("select has_function_privilege('authenticated','public._staff_party_directory_scope_v2_private(text,uuid,boolean)','execute') ok")).rows[0].ok,false);
  await db.exec(`insert into user_branches(user_id,branch_id) values('${id(101)}','${id(11)}');
    insert into role_permissions values('${id(20)}','customers.view'),('${id(20)}','customers.view_sales'),
      ('${id(20)}','suppliers.view'),('${id(20)}','suppliers.view_purchases');
    insert into staff_branch_permission_catalog(permission_code,enforcement_version)
      values('customers.view_sales',1),('customers.view_debt',1),('suppliers.view_purchases',1),('suppliers.view_debt',1) on conflict do nothing;
    select set_config('request.jwt.claim.sub','${id(101)}',false);`);
  const scope=async(mode,branch=null,exporting=false)=>(await db.query(
    'select public._staff_party_directory_scope_v2_private($1,$2,$3) as result',[mode,branch,exporting])).rows[0].result;
  let result=await scope('customer');
  assert.deepEqual(result.branchIds,[id(10),id(11)]);
  assert.deepEqual(result.activityBranchIds,[id(10),id(11)]);
  assert.deepEqual(result.debtBranchIds,[]);
  await db.exec(await migration("20261114034300_staff_party_directory_legacy_guard.sql"));
  assert.equal((await db.query("select public._party_directory_scope_private('customer',null,false) as result")).rows[0].result.canViewActivity,true,
    'legacy readers remain compatible while no party branch exception exists');
  await db.exec(`insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values
    ('${id(1)}','${id(101)}','${id(10)}','customers.view_sales','revoke','${id(100)}'),
    ('${id(1)}','${id(101)}','${id(10)}','customers.view_debt','grant','${id(100)}'),
    ('${id(1)}','${id(101)}','${id(11)}','suppliers.view_purchases','revoke','${id(100)}');`);
  result=await scope('customer');
  assert.deepEqual(result.activityBranchIds,[id(11)]);
  assert.deepEqual(result.debtBranchIds,[id(10)]);
  let legacy=(await db.query("select public._party_directory_scope_private('customer',null,false) as result")).rows[0].result;
  assert.equal(legacy.canViewActivity,false,'old clients mask a metric with branch exceptions');
  assert.equal(legacy.canViewDebt,false,'old clients also mask independently scoped debt');
  legacy=(await db.query("select public._party_directory_scope_private('customer',$1,false) as result",[id(10)])).rows[0].result;
  assert.equal(legacy.canViewActivity,false,'old selected-branch client respects a revoke');
  assert.equal(legacy.canViewDebt,true,'old selected-branch client continues to work with a grant');
  legacy=(await db.query("select public._party_directory_scope_private('customer',$1,false) as result",[id(11)])).rows[0].result;
  assert.equal(legacy.canViewActivity,true,'old selected-branch client keeps unrelated branch access');
  assert.equal(legacy.canViewDebt,false,'old selected-branch client does not inherit another branch grant');
  await db.exec(`delete from user_branch_permission_overrides where user_id='${id(101)}' and permission_code='customers.view_debt';
    insert into role_permissions values('${id(20)}','customers.view_debt');`);
  legacy=(await db.query("select public._party_directory_scope_private('customer',null,false) as result")).rows[0].result;
  assert.equal(legacy.canViewActivity,false);
  assert.equal(legacy.canViewDebt,true,'activity customization does not interrupt an independent legacy debt workflow');
  await db.exec(`delete from role_permissions where role_id='${id(20)}' and permission_code='customers.view_debt';
    insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
      values('${id(1)}','${id(101)}','${id(10)}','customers.view_debt','grant','${id(100)}');`);
  result=await scope('supplier');
  assert.deepEqual(result.activityBranchIds,[id(10)]);
  assert.deepEqual(result.debtBranchIds,[]);
  result=await scope('customer',id(10));
  assert.equal(result.canViewActivity,false);
  assert.equal(result.canViewDebt,true);
  await assert.rejects(scope('customer',id(12)),/PARTY_BRANCH_DENIED/);
  await assert.rejects(scope('customer',null,true),/PARTY_EXPORT_DENIED/);
  await db.exec(`insert into user_permission_overrides(tenant_id,user_id,permission_code,override_type)
    values('${id(1)}','${id(101)}','customers.view_debt','revoke');`);
  result=await scope('customer');
  assert.deepEqual(result.debtBranchIds,[],'global revoke takes precedence over branch grant');
  await db.exec(await readFile(new URL('./staff-access-tests/party-debt-read-baseline.sql',import.meta.url),'utf8'));
  await db.exec(await migration('20261114034500_staff_party_debt_read_guard.sql'));
  await db.exec(`
    create table purchase_orders(id uuid,tenant_id uuid,branch_id uuid);
    create table cash_transactions(id uuid,code text,type text,amount numeric,payment_method text,note text,created_at timestamptz,
      occurred_at timestamptz,transaction_date date,time_source text,time_reason text,status text,tenant_id uuid,branch_id uuid,reference_type text,reference_id uuid);
    create function public._staff_my_cash_book_view(p_branch uuid) returns boolean language sql stable as $$
      select public.user_has_permission(auth.uid(),'finance.view_cash_book') $$;
    create function public.can_read_branch_document_00567(p_tenant uuid,p_branch uuid) returns boolean language sql stable as $$
      select p_tenant=public.get_user_tenant_id() and public.user_has_branch_access(auth.uid(),p_branch) $$;
    insert into purchase_orders values('${id(50)}','${id(1)}','${id(10)}'),('${id(51)}','${id(1)}','${id(11)}');
    insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
      values('${id(1)}','${id(101)}','${id(10)}','suppliers.view_debt','grant','${id(100)}');
  `);
  const payment = async order => db.query("select public.get_document_payment_history_scoped('purchase_order',$1,0,100)",[order]);
  await payment(id(50));
  await assert.rejects(() => payment(id(51)),/PAYMENT_HISTORY_DENIED/);
  await db.exec(`insert into role_permissions values('${id(20)}','finance.view_cash_book')`);
  await payment(id(51)); // Independent cash-book access is intentionally preserved.
  await db.exec(`
    create table customer_advances(tenant_id uuid,branch_id uuid);
    create table customer_advance_allocations(tenant_id uuid,branch_id uuid);
    create table supplier_advances(tenant_id uuid,branch_id uuid);
    create table supplier_advance_allocations(tenant_id uuid,branch_id uuid);
    create table party_advance_refunds(tenant_id uuid,branch_id uuid,mode text);
    create table debt_opening_balances(tenant_id uuid,branch_id uuid,party_type text);
    create policy customer_advances_select on customer_advances for select using
      (tenant_id=get_user_tenant_id() and user_has_branch_access((select auth.uid()),branch_id) and user_has_permission((select auth.uid()),'customers.view_debt'));
    create policy customer_advance_allocations_select on customer_advance_allocations for select using
      (tenant_id=get_user_tenant_id() and user_has_branch_access((select auth.uid()),branch_id) and user_has_permission((select auth.uid()),'customers.view_debt'));
    create policy supplier_advances_select on supplier_advances for select using
      (tenant_id=get_user_tenant_id() and user_has_branch_access((select auth.uid()),branch_id) and user_has_permission((select auth.uid()),'suppliers.view_debt'));
    create policy supplier_advance_allocations_select on supplier_advance_allocations for select using
      (tenant_id=get_user_tenant_id() and user_has_branch_access((select auth.uid()),branch_id) and user_has_permission((select auth.uid()),'suppliers.view_debt'));
    create policy party_advance_refund_read on party_advance_refunds for select to authenticated using
      (tenant_id=get_user_tenant_id() and user_has_branch_access((select auth.uid()),branch_id) and _staff_my_cash_book_view(branch_id)
        and user_has_permission((select auth.uid()),case mode when 'customer' then 'customers.view_debt' else 'suppliers.view_debt' end));
    create policy staff_debt_opening_permission_read on debt_opening_balances as restrictive for select to authenticated using
      (case when branch_id is null then (select user_has_permission((select auth.uid()),'finance.view_reports'))
       when party_type='customer' then (select user_has_permission((select auth.uid()),'customers.view_debt')) or (select user_has_permission((select auth.uid()),'customers.import'))
       when party_type='supplier' then (select user_has_permission((select auth.uid()),'suppliers.view_debt')) or (select user_has_permission((select auth.uid()),'suppliers.import'))
       else false end);
  `);
  await db.exec(await migration('20261114034600_staff_party_debt_direct_read.sql'));
  assert.equal((await db.query("select has_function_privilege('anon','public.staff_my_party_debt_view(uuid,text)','execute') ok")).rows[0].ok,false);
  assert.equal((await db.query('select public.staff_my_party_debt_view($1,$2) ok',[id(10),'supplier'])).rows[0].ok,true);
  assert.equal((await db.query('select public.staff_my_party_debt_view($1,$2) ok',[id(11),'supplier'])).rows[0].ok,false);
  await db.exec(await functionFromMigration('20261111095224_staff_branch_kitchen_permissions.sql','_staff_permission_any_branch'));
  await db.exec('create table public.party_settlement_requests(tenant_id uuid)');
  await db.exec(await readFile(new URL('./staff-access-tests/party-debt-tx-baseline.sql',import.meta.url),'utf8'));
  await db.exec(await migration('20261114034700_staff_party_debt_transactions_scope.sql'));
  await db.exec(`insert into role_permissions values('${id(20)}','finance.create_transaction')`);
  const restricted = { mode: 'supplier', branchId: id(11), partyId: id(60), advanceId: id(61), amount: 1 };
  await assert.rejects(() => db.query('select public.refund_party_advance($1,$2)',[id(70),restricted]),/ADVANCE_REFUND_DENIED/);
  await assert.rejects(() => db.query('select public.settle_party_documents_atomic($1,$2)',[id(71),restricted]),/PARTY_SETTLEMENT_DENIED/);
  await db.exec(await migration('20261114034800_staff_party_debt_rls_performance.sql'));
  assert.equal((await db.query("select has_function_privilege('anon','public.staff_my_party_debt_branches(text)','execute') ok")).rows[0].ok,false);
  assert.deepEqual((await db.query("select public.staff_my_party_debt_branches('supplier') ids")).rows[0].ids,[id(10)]);
  assert.deepEqual((await db.query("select public.staff_my_party_debt_branches('customer') ids")).rows[0].ids,[]);
  console.log('PASS: independent party activity/debt branch scopes, export, tenant and global revoke.');
} finally { await db.close(); }
