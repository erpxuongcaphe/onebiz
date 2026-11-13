import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { functionFromMigration } from "./inventory.mjs";
export async function verifyAdjustmentScope(db, { id, migration }) {
  await db.exec(`
 alter table branches add column code text;
 update branches set code=case when id='${id(10)}' then 'PREMIUM' else 'TUBUA' end;
 create table products(id uuid primary key,tenant_id uuid,code text);
 create table stock_movements(id uuid primary key,tenant_id uuid,branch_id uuid);
 create table inventory_opening_batches(id uuid primary key,tenant_id uuid,branch_id uuid);
 create table purchase_orders(id uuid primary key,tenant_id uuid,branch_id uuid);
 create table input_invoices(id uuid primary key,tenant_id uuid,branch_id uuid);
 create table internal_sale_receipts(id uuid primary key,tenant_id uuid,internal_sale_id uuid);
 create table internal_sale_receipt_requests(request_id uuid,tenant_id uuid,payload jsonb,receipt_id uuid);
 alter table internal_sales add column receipt_mode text;
 update internal_sales set status='completed',receipt_mode='actual';
 insert into inventory_opening_batches values('${id(250)}','${id(1)}','${id(10)}');
 insert into purchase_orders values('${id(251)}','${id(1)}','${id(10)}');
 insert into input_invoices values('${id(252)}','${id(1)}','${id(10)}');
 insert into internal_sale_receipts values('${id(253)}','${id(1)}','${id(220)}');
 insert into role_permissions values('${id(20)}','inventory.adjust'),('${id(20)}','inventory.create_po'),('${id(20)}','products.edit');
 `);
  const definitions = [
    [
      "20261029170929_stock_adjustment_target_guard.sql",
      "adjust_stock_to_value_atomic",
    ],
    [
      "20261027154149_fnb_opening_cost_defaults.sql",
      "get_inventory_opening_warehouse_prices",
    ],
    ["00442_safe_opening_stock_batches.sql", "preview_inventory_opening_00442"],
    [
      "00442_safe_opening_stock_batches.sql",
      "commit_inventory_opening_00442",
      "_expiry_opening_base_00527",
    ],
    [
      "00245_harden_purchase_order_rpcs.sql",
      "revert_received_purchase_order_atomic",
      "_revert_received_po_global_wac_impl_00403",
    ],
    ["00510_fnb_internal_actual_receiving.sql", "receive_internal_sale_actual"],
    ["00515_operational_uom_snapshots.sql", "receive_internal_sale_with_uom"],
    [
      "202610210006_internal_receipt_reclassification.sql",
      "reclassify_internal_receipt_to_stock_20261021",
    ],
    [
      "00289_atomic_input_invoice_internal_sale_state.sql",
      "set_input_invoice_state_atomic",
    ],
  ];
  for (const [file, name, renamed] of definitions) {
    let sql = await functionFromMigration(file, name);
    if (renamed) sql = sql.replace(`public.${name}(`, `public.${renamed}(`);
    await db.exec(sql);
  }
  if (process.env.ONEBIZ_ADJUSTMENT_AUDIT_FILE) {
    const defs = JSON.parse(
      await readFile(process.env.ONEBIZ_ADJUSTMENT_AUDIT_FILE, "utf8"),
    );
    for (const [, name, renamed] of definitions) {
      const f = defs.find((x) => x.proname === (renamed ?? name));
      assert.ok(f, name);
      await db.exec(f.definition);
    }
  }
  await db.exec(
    await migration("20261111135753_staff_branch_adjustment_permissions.sql"),
  );
  await db.exec(
    `insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) select '${id(1)}','${id(101)}',b,'inventory.adjust','revoke','${id(100)}' from unnest(array['${id(10)}'::uuid,'${id(11)}'::uuid]) b;`,
  );
  const before = (
    await db.query("select count(*)::int n from test_ledger_calls")
  ).rows[0].n;
  const calls = [
    () =>
      db.query(
        "select adjust_stock_to_value_atomic($1,$2,$3,1,2,'test reason')",
        [id(260), id(10), id(400)],
      ),
    () =>
      db.query(
        'select _apply_manual_stock_movement_auth_impl_00246($1,$2,$3,\'[{"reference_type":"stock_adjustment"}]\')',
        [id(1), id(10), id(101)],
      ),
    () =>
      db.query("select get_inventory_opening_warehouse_prices($1,'{}')", [
        id(10),
      ]),
    () =>
      db.query("select preview_inventory_opening_00442($1)", [
        [{ branchCode: "PREMIUM" }],
      ]),
    () =>
      db.query(
        "select _expiry_opening_base_00527($1,$2,'[]','opening_cost',now(),'test reason',null)",
        [id(250), [{ branchCode: "TUBUA" }]],
      ),
    () =>
      db.query(
        "select _revert_received_po_global_wac_impl_00403($1,null,true)",
        [id(251)],
      ),
    () =>
      db.query(
        "select receive_internal_sale_actual($1,$2,$3,'test reason',$4,0)",
        [id(220), [{ itemId: id(400), quantity: 1 }], id(261), id(253)],
      ),
    () =>
      db.query(
        "select receive_internal_sale_with_uom($1,$2,$3,'test reason',$4,0)",
        [id(220), [{ itemId: id(400), quantity: 1 }], id(261), id(253)],
      ),
    () =>
      db.query(
        "select reclassify_internal_receipt_to_stock_20261021($1,$2,0,$3,'test reason')",
        [id(253), id(400), id(261)],
      ),
    () =>
      db.query(
        "select set_input_invoice_state_atomic($1,'cancel','test reason')",
        [id(252)],
      ),
  ];
  for (const call of calls)
    await assert.rejects(call(), /DENIED|INSUFFICIENT_PERMISSION/);
  assert.equal(
    (await db.query("select count(*)::int n from test_ledger_calls")).rows[0].n,
    before,
  );
  // A grant at the other branch must not authorize replay against a persisted batch.
  await db.exec(
    `update user_branch_permission_overrides set override_type='grant' where permission_code='inventory.adjust' and branch_id='${id(11)}'; delete from role_permissions where permission_code='inventory.adjust';`,
  );
  await assert.rejects(calls[4](), /OPENING_PERMISSION_DENIED/);
  await db.exec(
    `update user_branch_permission_overrides set override_type='grant' where permission_code='inventory.adjust';`,
  );
  await db.query(
    'select _apply_manual_stock_movement_auth_impl_00246($1,$2,$3,\'[{"reference_type":"stock_adjustment"}]\')',
    [id(1), id(10), id(101)],
  );
  assert.equal(
    (await db.query("select count(*)::int n from test_ledger_calls")).rows[0].n,
    before + 1,
  );
  await db.exec(
    `insert into user_permission_overrides(tenant_id,user_id,permission_code,override_type) values('${id(1)}','${id(101)}','inventory.adjust','revoke');`,
  );
  await assert.rejects(calls[1](), /INSUFFICIENT_PERMISSION/);
  console.log(
    "Adjustment scope: 10 consumers deny at the persisted branch, opening replay cannot use another branch grant, local manual grant and global denial verified. Posting checked separately.",
  );
  if (process.env.ONEBIZ_STAFF_PURCHASE_TEST === "1") {
    const { verifyPurchaseScope } = await import("./purchase.mjs");
    await verifyPurchaseScope(db, { id, migration });
  }
}
