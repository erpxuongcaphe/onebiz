import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

export async function verifyCashRefundView(db, id) {
  await db.exec(
    await readFile(
      new URL(
        "../../supabase/migrations/20261112033830_staff_branch_cash_advance_refund_view.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(`reset role;
    delete from user_branch_permission_overrides where permission_code in ('finance.view_cash_book','finance.create_transaction','finance.void_transaction');
    delete from user_permission_overrides where permission_code in ('finance.view_cash_book','finance.create_transaction','finance.void_transaction');
    insert into test_staff_permissions values ('finance.create_transaction'),('finance.void_transaction'),('finance.view_cash_book') on conflict do nothing;
    insert into user_branch_permission_overrides values ('${id(2)}','${id(1)}','${id(3)}','finance.view_cash_book','revoke');
  `);
  const refund = (branch) =>
    db.query("select refund_party_advance($1,$2)", [
      id(780),
      { branchId: id(branch), mode: "customer" },
    ]);
  const cancel = () =>
    db.query("select cancel_party_advance_refund($1,'valid reason')", [
      id(703),
    ]);
  const before = (
    await db.query("select status from cash_transactions where id=$1", [
      id(703),
    ])
  ).rows[0].status;
  await assert.rejects(refund(3), /ADVANCE_REFUND_DENIED/);
  await assert.rejects(cancel(), /ADVANCE_REFUND_CANCEL_DENIED/);
  await assert.rejects(refund(4), /ADVANCE_REFUND_INPUT_INVALID/);
  await db.exec(`delete from test_staff_permissions where code='finance.view_cash_book';
    update user_branch_permission_overrides set branch_id='${id(4)}',override_type='grant' where permission_code='finance.view_cash_book';`);
  await assert.rejects(refund(4), /ADVANCE_REFUND_INPUT_INVALID/);
  await assert.rejects(refund(3), /ADVANCE_REFUND_DENIED/);
  await assert.rejects(cancel(), /ADVANCE_REFUND_CANCEL_DENIED/);
  assert.equal(
    (
      await db.query("select status from cash_transactions where id=$1", [
        id(703),
      ])
    ).rows[0].status,
    before,
  );
  console.log(
    "PASS advance refund: branch cash-view prerequisite, independent mutation guards and no changes on denial.",
  );
}
