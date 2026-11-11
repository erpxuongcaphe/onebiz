import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { functionFromMigration } from "./inventory.mjs";

// Checks authorization before the unchanged refund implementation. This does
// not substitute for the existing full refund/cash/lot integration suite.
export async function verifyPaidVoidScope(db, id) {
  const code = "pos_fnb.void_paid_bill";
  let checks = 0;
  await db.exec(`create function _current_caller_tenant() returns uuid language sql as $$select get_user_tenant_id()$$;
 create function can_read_branch_document_00567(uuid,uuid) returns boolean language sql set search_path=public as $$select public.user_has_branch_access(auth.uid(),$2)$$;
 create table invoices(id uuid,tenant_id uuid,branch_id uuid,code text,status text,paid numeric,shift_id uuid,source text,total numeric,debt numeric,customer_id uuid,customer_name text);
 create table purchase_orders(id uuid,tenant_id uuid,branch_id uuid);
 insert into invoices(id,tenant_id,branch_id,code,status,paid,source,total,debt) values
 ('${id(70)}','${id(1)}','${id(10)}','Synthetic Premium','completed',0,'fnb',0,0),
 ('${id(71)}','${id(1)}','${id(11)}','Synthetic Other','cancelled',0,'fnb',0,0);`);
  for (const [file, name, alias] of [
    [
      "00165_fnb_menu_lock_cascade_void_ledger.sql",
      "fnb_void_invoice_atomic",
      "_fnb_void_invoice_impl_00165",
    ],
    [
      "00250_harden_fnb_payment_invoice_void.sql",
      "void_completed_invoice_atomic_v2",
      "_void_completed_invoice_atomic_v2_impl_00250",
    ],
  ])
    await db.exec(
      (await functionFromMigration(file, name)).replace(
        `public.${name}(`,
        `public.${alias}(`,
      ),
    );
  const contracts = await readFile(
    new URL("./checkout-contract-fixtures.sql", import.meta.url),
    "utf8",
  );
  await db.exec(
    contracts.slice(
      0,
      contracts.indexOf("create function get_open_shift_status_scoped"),
    ),
  );
  if (process.env.ONEBIZ_CANCEL_AUDIT_FILE) {
    const names = [
      "_fnb_void_invoice_impl_00165",
      "_void_completed_invoice_atomic_v2_impl_00250",
      "get_document_payment_history_scoped",
    ];
    const defs = JSON.parse(
      await readFile(process.env.ONEBIZ_CANCEL_AUDIT_FILE, "utf8"),
    ).filter((f) => names.includes(f.proname));
    assert.equal(defs.length, 3);
    for (const f of defs) await db.exec(f.definition + ";");
  }
  await db.exec(
    await readFile(
      new URL(
        "../../supabase/migrations/20261111102740_staff_branch_paid_void_permissions.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(`insert into role_permissions values('${id(20)}','${code}');
 insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values
 ('${id(1)}','${id(101)}','${id(10)}','${code}','revoke','${id(100)}'),
 ('${id(1)}','${id(101)}','${id(11)}','${code}','grant','${id(100)}');`);
  const legacy = (invoice, branch, otp = "null") =>
    `select _fnb_void_invoice_impl_00165('${invoice}',null,'Synthetic reason','${id(101)}','${id(1)}','${branch}',null,${otp})`;
  // The allowed branch in the caller payload must not override the invoice.
  for (const sql of [
    legacy(id(70), id(10)),
    legacy(id(70), id(11)),
    legacy(id(70), id(11), `'${id(90)}'`),
  ]) {
    await assert.rejects(db.query(sql), /PERMISSION_DENIED/);
    checks++;
  }
  await assert.rejects(
    db.query(
      `select _void_completed_invoice_atomic_v2_impl_00250('${id(70)}','Synthetic reason')`,
    ),
    /INSUFFICIENT_PERMISSION/,
  );
  checks++;
  await assert.rejects(
    db.query(
      `select get_document_payment_history_scoped('invoice','${id(70)}')`,
    ),
    /PAYMENT_HISTORY_DENIED/,
  );
  checks++;
  await db.exec(
    `delete from role_permissions where permission_code='${code}';`,
  );
  // Valid local grant reaches the unchanged already-voided business guard.
  await assert.rejects(db.query(legacy(id(71), id(11))), /already voided/);
  checks++;
  assert.equal(
    (await db.query(`select status from invoices where id='${id(70)}'`)).rows[0]
      .status,
    "completed",
  );
  checks++;
  await db.exec(
    `insert into user_permission_overrides(tenant_id,user_id,permission_code,override_type) values('${id(1)}','${id(101)}','${code}','revoke')`,
  );
  await assert.rejects(db.query(legacy(id(71), id(11))), /PERMISSION_DENIED/);
  checks++;
  assert.deepEqual(
    (
      await db.query("select get_my_auth_bootstrap() as result")
    ).rows[0].result.legacyPermissionDenials.sort(),
    ["pos_fnb.cancel_unpaid_order", code].sort(),
  );
  checks++;
  return checks;
}
