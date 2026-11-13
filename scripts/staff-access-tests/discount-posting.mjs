import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { functionFromMigration } from "./inventory.mjs";

export async function installDiscountScope(db) {
  await db.exec(`alter table profiles add column role text default 'staff';
create table staff_branch_permission_catalog(permission_code text primary key,enforcement_version integer);
create table user_permission_overrides(tenant_id uuid,user_id uuid,permission_code text,override_type text);
create table user_branch_permission_overrides(tenant_id uuid,user_id uuid,branch_id uuid,permission_code text,override_type text);
create function get_user_tenant_id() returns uuid language sql stable as $$select tenant_id from profiles where id=auth.uid()$$;
create function _current_caller_tenant() returns uuid language sql stable as $$select get_user_tenant_id()$$;`);
  for (const [file, name] of [
    ["20261111052704_staff_branch_access.sql", "user_has_permission_at_branch"],
    [
      "20261111070229_staff_branch_checkout_permissions.sql",
      "_staff_permission_at_scope",
    ],
    ["00274_fnb_split_table_payment_guard.sql", "fnb_complete_payment_atomic"],
    ["00086_void_discount_verify_otp.sql", "record_discount_audit"],
  ])
    await db.exec(await functionFromMigration(file, name));
  if (process.env.ONEBIZ_DISCOUNT_AUDIT_FILE) {
    const names = [
      "_fnb_complete_payment_impl_00343",
      "fnb_complete_payment_atomic",
      "record_discount_audit",
    ];
    const definitions = JSON.parse(
      await readFile(process.env.ONEBIZ_DISCOUNT_AUDIT_FILE, "utf8"),
    ).filter((f) => names.includes(f.proname));
    assert.equal(definitions.length, 3);
    for (const definition of definitions)
      await db.exec(definition.definition + ";");
  }
  await db.exec(
    await readFile(
      new URL(
        "../../supabase/migrations/20261111104831_staff_branch_discount_permissions.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(`insert into user_branch_permission_overrides values
('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','pos_fnb.discount','revoke');`);
}

export async function verifyDiscountDenial(db, paymentSql) {
  const before = async () =>
    JSON.stringify(
      (
        await db.query(`select
    (select count(*) from invoices) invoices,(select count(*) from cash_transactions) cash,
    (select count(*) from stock_movements) stock,(select count(*) from audit_log) audit`)
      ).rows[0],
    );
  const unchanged = await before();
  await assert.rejects(
    db.exec(paymentSql),
    /FNB_MANUAL_DISCOUNT_APPROVER_DENIED/,
  );
  await assert.rejects(
    db.query(`select fnb_complete_payment_atomic(
    '00000000-0000-0000-0000-000000000200',null,'Synthetic','cash',null,150000,17500,null,
    '00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000007')`),
    /DISCOUNT_PERMISSION_REQUIRED/,
  );
  assert.equal(
    await before(),
    unchanged,
    "denied discount leaves money, stock and audit untouched",
  );
  await db.exec(`update user_branch_permission_overrides set override_type='grant';
create or replace function user_has_permission(uuid,text) returns boolean language sql as $$select $2<>'pos_fnb.discount'$$;`);
  console.log(
    "PASS: local discount denial blocks actual checkout and legacy checkout without writes; continuing full checkout with local-only discount grant.",
  );
}

export async function verifyDiscountAudit(db, invoiceId) {
  const audit = () =>
    db.query(
      `select record_discount_audit($1,'Synthetic',120000,17500,0,'Approved selected rows','00000000-0000-0000-0000-000000000203',null) as result`,
      [invoiceId],
    );
  assert.equal(
    (await audit()).rows[0].result.audit_recorded,
    true,
    "local-only approver can record the discount audit",
  );
  const count = async () =>
    (await db.query("select count(*) n from audit_log")).rows[0].n;
  const saved = await count();
  await db.exec("begin");
  try {
    await db.exec(`insert into branches(id,tenant_id,name) values('00000000-0000-0000-0000-000000000800','00000000-0000-0000-0000-000000000002','Other branch');
      insert into user_branch_permission_overrides values('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000800','pos_fnb.discount','revoke');`);
    await db.query(
      "update invoices set branch_id='00000000-0000-0000-0000-000000000800' where id=$1",
      [invoiceId],
    );
    await assert.rejects(audit(), /PERMISSION_DENIED/);
  } finally {
    await db.exec("rollback");
  }
  await db.exec(
    `insert into user_permission_overrides values('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','pos_fnb.discount','revoke');`,
  );
  await assert.rejects(audit(), /PERMISSION_DENIED/);
  await db.exec(
    "delete from user_permission_overrides where permission_code='pos_fnb.discount'",
  );
  assert.equal(
    await count(),
    saved,
    "denied approvals cannot add successful audit records",
  );
  console.log(
    "PASS: persisted invoice branch controls discount audit; global denial overrides local grant, other-branch denial is independent.",
  );
}
