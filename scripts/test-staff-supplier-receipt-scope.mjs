import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { initializeStaffAccessFixture } from "./staff-access-tests/fixture.mjs";
import { functionFromMigration } from "./staff-access-tests/inventory.mjs";

const db = new PGlite();
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const read = path => readFile(new URL(path, import.meta.url), "utf8");
try {
  await initializeStaffAccessFixture(db, id);
  await db.exec(await read("../supabase/migrations/20261111052704_staff_branch_access.sql"));
  await db.exec(await functionFromMigration("20261111070229_staff_branch_checkout_permissions.sql", "_staff_permission_at_scope"));
  await db.exec(`
    create function public.assert_report_access(p_code text,p_branch uuid) returns void language plpgsql as $$begin
      if not public._staff_permission_at_scope(auth.uid(),p_code,p_branch) then raise exception 'DENIED' using errcode='42501';end if;
    end$$;
    create function public._supplier_receipt_rows_v1(p_tenant uuid,p_branch uuid,p_from timestamptz,p_to timestamptz) returns setof jsonb language sql stable as $$
      select jsonb_build_object('id',p_branch,'branchId',p_branch,'kind','receipt','amount',case when p_branch='${id(10)}' then 70 else 300 end,'status','verified')
    $$;
    insert into user_branches(user_id,branch_id) values('${id(101)}','${id(11)}');
    insert into role_permissions values('${id(20)}','reports.analytics'),('${id(20)}','reports.view_detail'),
      ('${id(20)}','reports.view_all_branches'),('${id(20)}','suppliers.view_purchases');
    insert into staff_branch_permission_catalog(permission_code,enforcement_version) values('suppliers.view_purchases',1) on conflict do nothing;
    select set_config('request.jwt.claim.sub','${id(101)}',false);
  `);
  await db.exec(await read("./staff-access-tests/supplier-receipt-baseline.sql"));
  await db.exec(await read("../supabase/migrations/20261114034400_staff_supplier_receipt_reader_v2.sql"));
  assert.equal((await db.query("select has_function_privilege('anon','public.get_supplier_receipt_workspace_v2(uuid,date,date,integer,integer,uuid,text,text,text,text,boolean)','execute') ok")).rows[0].ok,false);
  const report = async branch => (await db.query("select public.get_supplier_receipt_workspace_v2($1,'2026-01-01','2026-12-31') result", [branch])).rows[0].result;
  let result = await report(null);
  assert.equal(result.summary.netAmount,370);
  assert.deepEqual(result.authorizedBranchIds,[id(10),id(11)]);
  await db.exec(`insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
    values('${id(1)}','${id(101)}','${id(11)}','suppliers.view_purchases','revoke','${id(100)}')`);
  result = await report(null);
  assert.equal(result.summary.netAmount,70);
  assert.deepEqual(result.authorizedBranchIds,[id(10)]);
  await assert.rejects(() => report(id(11)), error => error.code === "42501");
  await assert.rejects(() => report(id(12)), error => error.code === "42501");
  console.log("PASS: supplier receipts use authorized branch intersection and protect revoked branches.");
} finally { await db.close(); }
