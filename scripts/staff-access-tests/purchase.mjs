import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { functionFromMigration } from "./inventory.mjs";

// Actual authorization bodies; ledger delegates inherited from the disposal
// fixture are sentinels. This suite does not claim full purchase accounting.
export async function verifyPurchaseScope(db, { id, migration }) {
  await db.exec(`
    alter table branches add column branch_type text default 'store', add column cascade_mode text default 'outlet';
    delete from user_permission_overrides where permission_code='inventory.adjust';
    delete from user_branch_permission_overrides where permission_code='inventory.adjust';
    insert into role_permissions values('${id(20)}','inventory.adjust');
    alter table purchase_orders add column code text, add column status text default 'draft', add column note text, add column updated_at timestamptz;
    create table purchase_order_items(id uuid primary key,purchase_order_id uuid);
    create table supplier_returns(id uuid primary key,tenant_id uuid,branch_id uuid);
    create table supplier_return_items(id uuid primary key,supplier_return_id uuid);
    insert into purchase_orders(id,tenant_id,branch_id,code) values('${id(270)}','${id(1)}','${id(11)}','PO-B');
  `);
  const definitions = [
    [
      "00346_purchase_order_save_replay_safe.sql",
      "save_purchase_order_with_uom_atomic_v2",
      "_expiry_po_v2_base_00527",
    ],
    [
      "00299_align_purchase_order_vnd_rounding.sql",
      "save_purchase_order_atomic",
    ],
    [
      "202610260100_fnb_warehouse_order_changes.sql",
      "change_fnb_warehouse_order",
    ],
    ["00262_atomic_purchase_order_state.sql", "close_purchase_order_short"],
    ["00247_atomic_supplier_return.sql", "create_supplier_return_atomic"],
    [
      "202610240200_warehouse_catalog_search.sql",
      "get_fnb_warehouse_order_context",
    ],
    ["00245_harden_purchase_order_rpcs.sql", "receive_purchase_items_atomic"],
    [
      "00320_uom_accounting_snapshots.sql",
      "receive_purchase_items_with_uom_atomic",
    ],
    ["00390_fnb_branch_cost_ledger.sql", "set_fnb_branch_opening_cost_00390"],
    [
      "00262_atomic_purchase_order_state.sql",
      "set_purchase_order_state_atomic",
    ],
    ["00245_harden_purchase_order_rpcs.sql", "update_purchase_order_prices"],
    [
      "00320_uom_accounting_snapshots.sql",
      "update_purchase_order_prices_with_uom",
    ],
    [
      "00272_atomic_received_purchase_order_update.sql",
      "update_received_purchase_order_atomic",
    ],
  ];
  for (const [file, name, renamed] of definitions) {
    let sql = await functionFromMigration(file, name);
    if (renamed) sql = sql.replace(`public.${name}(`, `public.${renamed}(`);
    await db.exec(sql);
  }
  if (process.env.ONEBIZ_PURCHASE_AUDIT_FILE) {
    const defs = JSON.parse(
      await readFile(process.env.ONEBIZ_PURCHASE_AUDIT_FILE, "utf8"),
    );
    for (const [, name, renamed] of definitions) {
      const f = defs.find((x) => x.proname === (renamed ?? name));
      assert.ok(f, name);
      await db.exec(f.definition);
    }
  }
  await db.exec(
    await migration("20261111143617_staff_branch_purchase_permissions.sql"),
  );
  await db.exec(`insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
   select '${id(1)}','${id(101)}',b,'inventory.create_po','revoke','${id(100)}' from unnest(array['${id(10)}'::uuid,'${id(11)}'::uuid]) b;`);
  const q =
    (sql, args = []) =>
    () =>
      db.query(sql, args);
  const calls = [
    q(
      "select _expiry_po_v2_base_00527($1,null,$2,null,null,0,0,0,0,'cash',false,false,'[]')",
      [id(251), id(11)],
    ),
    q(
      "select save_purchase_order_atomic($1,null,$2,null,null,0,0,0,0,'cash',false,false,'[]')",
      [id(251), id(11)],
    ),
    q(
      "select change_fnb_warehouse_order($1,0,$2,'cancel',null,null,'test reason')",
      [id(251), id(271)],
    ),
    q("select close_purchase_order_short($1,'test reason',null)", [id(251)]),
    q("select create_supplier_return_atomic($1,'[]')", [id(251)]),
    q("select get_fnb_warehouse_order_context($1,'')", [id(10)]),
    q("select receive_purchase_items_atomic($1,'[]',null)", [id(251)]),
    q("select receive_purchase_items_with_uom_atomic($1,'[]',null)", [id(251)]),
    q("select set_fnb_branch_opening_cost_00390($1,$2,10,'test reason')", [
      id(10),
      id(400),
    ]),
    q("select set_purchase_order_state_atomic($1,'cancelled','test reason')", [
      id(251),
    ]),
    q("select update_purchase_order_prices($1,'[]')", [id(251)]),
    q("select update_purchase_order_prices_with_uom($1,'[]')", [id(251)]),
    q("select update_received_purchase_order_atomic($1,0,'test reason')", [
      id(251),
    ]),
    q("select _revert_received_po_global_wac_impl_00403($1,null,false)", [
      id(251),
    ]),
    q("select receive_internal_sale_actual($1,'[]',$2)", [id(220), id(271)]),
    q("select receive_internal_sale_with_uom($1,'[]',$2)", [id(220), id(271)]),
    q(
      "select reclassify_internal_receipt_to_stock_20261021($1,$2,0,$3,'test reason')",
      [id(253), id(400), id(271)],
    ),
    q(
      `select _apply_manual_stock_movement_auth_impl_00246($1,$2,$3,'[{"reference_type":"supplier_return"}]')`,
      [id(1), id(10), id(101)],
    ),
  ];
  const before = await db.query("select * from test_ledger_calls");
  for (const call of calls)
    await assert.rejects(
      call(),
      /DENIED|INSUFFICIENT_PERMISSION|Không có quyền|không có quyền/,
    );
  assert.deepEqual(await db.query("select * from test_ledger_calls"), before);
  await db.exec(
    `update user_branch_permission_overrides set override_type='grant' where permission_code='inventory.create_po' and branch_id='${id(11)}'; delete from role_permissions where permission_code='inventory.create_po';`,
  );
  // Submitted branch B cannot authorize an existing branch-A purchase order.
  await assert.rejects(calls[0](), /INSUFFICIENT_PERMISSION/);
  await assert.rejects(calls[1](), /INSUFFICIENT_PERMISSION/);
  await assert.rejects(calls[9](), /INSUFFICIENT_PERMISSION/);
  const cancelled = await db.query(
    "select set_purchase_order_state_atomic($1,'cancelled','test reason') result",
    [id(270)],
  );
  assert.equal(cancelled.rows[0].result.status, "cancelled");
  assert.equal(
    (
      await db.query(
        "select set_purchase_order_state_atomic($1,'cancelled','test reason') result",
        [id(270)],
      )
    ).rows[0].result.idempotent,
    true,
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from audit_log where entity_id=$1",
        [id(270)],
      )
    ).rows[0].n,
    1,
  );
  await db.exec(
    `insert into user_permission_overrides(tenant_id,user_id,permission_code,override_type) values('${id(1)}','${id(101)}','inventory.create_po','revoke');`,
  );
  await assert.rejects(
    db.query(
      "select set_purchase_order_state_atomic($1,'cancelled','test reason')",
      [id(270)],
    ),
    /INSUFFICIENT_PERMISSION/,
  );
  // Authenticate direct writes with permissive legacy fixture policies; new
  // restrictive guards must still reject every write and preserve SELECT.
  for (const table of [
    "purchase_orders",
    "purchase_order_items",
    "supplier_returns",
    "supplier_return_items",
  ]) {
    await db.exec(
      `alter table ${table} enable row level security; create policy legacy_test on ${table} to authenticated using(true) with check(true); grant select,insert,update,delete on ${table} to authenticated;`,
    );
    await db.query(`insert into ${table}(id) values($1)`, [id(280)]);
  }
  await db.exec("set role authenticated");
  for (const table of [
    "purchase_orders",
    "purchase_order_items",
    "supplier_returns",
    "supplier_return_items",
  ]) {
    assert.ok((await db.query(`select * from ${table}`)).rows.length > 0);
    await assert.rejects(
      db.query(`insert into ${table}(id) values($1)`, [id(281)]),
      /row-level security/,
    );
    assert.equal(
      (
        await db.query(`update ${table} set id=id where id=$1 returning id`, [
          id(280),
        ])
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query(`delete from ${table} where id=$1 returning id`, [
          id(280),
        ])
      ).rows.length,
      0,
    );
  }
  await db.exec("reset role");
  await db.exec(
    "delete from user_branch_permission_overrides where permission_code='inventory.create_po'; set role authenticated",
  );
  await db.query("insert into purchase_orders(id) values($1)", [id(282)]);
  await db.exec("reset role");
  console.log(
    "Purchase scope: 18 consumers deny, persisted branch wins over submitted branch, local grant performs actual cancel and replay, global deny wins, 12 DML guards and legacy preservation passed.",
  );
}
