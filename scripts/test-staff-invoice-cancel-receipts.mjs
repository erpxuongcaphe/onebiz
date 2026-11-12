import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { initializeStaffAccessFixture } from "./staff-access-tests/fixture.mjs";
import { functionFromMigration } from "./staff-access-tests/inventory.mjs";
const { PGlite } = await import(
  process.env.ONEBIZ_PGLITE_MODULE
    ? pathToFileURL(process.env.ONEBIZ_PGLITE_MODULE).href
    : "@electric-sql/pglite"
);
const db = new PGlite();
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const file = (name) =>
  readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
try {
  await initializeStaffAccessFixture(db, id);
  await db.exec(await file("20261111052704_staff_branch_access.sql"));
  for (const [migration, name] of [
    [
      "20261111070229_staff_branch_checkout_permissions.sql",
      "_staff_permission_at_scope",
    ],
    [
      "20261111102740_staff_branch_paid_void_permissions.sql",
      "_staff_legacy_paid_void_permission",
    ],
  ])
    await db.exec(await functionFromMigration(migration, name));
  await db.exec(`create table invoices(id uuid,tenant_id uuid,branch_id uuid,source text,status text,deleted_at timestamptz);
  create table cash_transactions(id uuid,tenant_id uuid,branch_id uuid,reference_id uuid,reference_type text,type text,status text,amount numeric);
  insert into invoices values ('${id(50)}','${id(1)}','${id(10)}','fnb','completed',null),
   ('${id(51)}','${id(1)}','${id(11)}','pos','completed',null),('${id(52)}','${id(2)}','${id(12)}','fnb','completed',null);
  insert into cash_transactions values
   ('${id(70)}','${id(1)}','${id(10)}','${id(50)}','invoice','receipt','completed',60),
   ('${id(71)}','${id(1)}','${id(10)}','${id(50)}','invoice','receipt','cancelled',500),
   ('${id(72)}','${id(1)}','${id(10)}','${id(50)}','invoice','payment','completed',500),
   ('${id(73)}','${id(1)}','${id(11)}','${id(50)}','invoice','receipt','completed',500),
   ('${id(74)}','${id(1)}','${id(11)}','${id(51)}','invoice','receipt','completed',70);
  insert into user_branches values('${id(101)}','${id(11)}',null);
  insert into role_permissions values('${id(20)}','pos_fnb.void'),('${id(20)}','pos_retail.void');
  insert into staff_branch_permission_catalog values('pos_fnb.void_paid_bill',1),('pos_retail.void',1);
  grant usage on schema public,auth to authenticated;
  select set_config('request.jwt.claim.sub','${id(101)}',false);`);
  await db.exec(
    await file("20261112101436_staff_invoice_cancel_receipts_batch.sql"),
  );
  await db.exec("set role authenticated");
  const read = async (ids) =>
    (
      await db.query(
        "select * from get_invoice_cancel_receipt_totals($1::uuid[]) order by invoice_id",
        [ids.map(id)],
      )
    ).rows;
  assert.deepEqual(await read([50, 51]), [
    { invoice_id: id(50), refund: "60" },
    { invoice_id: id(51), refund: "70" },
  ]);
  await assert.rejects(read([50, 52]), /INVOICE_CANCEL_PREVIEW_DENIED/);
  await assert.rejects(read([50, 50]), /INVOICE_CANCEL_PREVIEW_INVALID/);
  await assert.rejects(
    db.query("select * from cash_transactions"),
    /permission denied/,
  );
  await db.exec(`reset role; insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values
  ('${id(1)}','${id(101)}','${id(11)}','pos_retail.void','revoke','${id(100)}'); set role authenticated;`);
  await assert.rejects(read([50, 51]), /INVOICE_CANCEL_PREVIEW_DENIED/);
  assert.deepEqual(await read([50]), [{ invoice_id: id(50), refund: "60" }]);
  await db.exec(`reset role; insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values
  ('${id(1)}','${id(101)}','${id(10)}','pos_fnb.void_paid_bill','revoke','${id(100)}'); set role authenticated;`);
  await assert.rejects(read([50]), /INVOICE_CANCEL_PREVIEW_DENIED/);
  console.log(
    "PASS invoice cancellation preview: scoped totals, legacy deny precedence, no broad cash access or mixed-branch leakage",
  );
} catch (e) {
  console.error(e.message, e.where ?? "");
  process.exitCode = 1;
} finally {
  await db.close();
}
