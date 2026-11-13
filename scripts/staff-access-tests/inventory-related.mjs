import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { functionFromMigration } from "./inventory.mjs";

const sources = [
  [
    "202610260100_fnb_warehouse_order_changes.sql",
    "get_fnb_purchase_order_links",
  ],
  [
    "202610260100_fnb_warehouse_order_changes.sql",
    "get_fnb_warehouse_order_for_change",
  ],
  [
    "00510_fnb_internal_actual_receiving.sql",
    "get_internal_receiving_workspace",
  ],
  [
    "20261111035000_internal_return_read_permission.sql",
    "get_internal_stock_returns",
  ],
];

export async function verifyRelatedInventoryReads(db, id) {
  await db.exec(`
    reset role;
    create schema private;
    create function private.fnb_order_change_block_reason(uuid) returns text language sql as $$select null::text$$;
    create table invoices(id uuid primary key,tenant_id uuid,branch_id uuid,code text,status text,fulfilled_by_id uuid,note text);
    create table invoice_items(id uuid,invoice_id uuid,product_id uuid,product_name text,unit text,
      transaction_unit text,quantity numeric,transaction_quantity numeric,note text);
    create table fnb_purchase_sales_order_links(tenant_id uuid,purchase_order_id uuid,sales_order_id uuid,revision integer);
    insert into invoices values
      ('${id(810)}','${id(1)}','${id(10)}','X1','draft',null,''),
      ('${id(811)}','${id(1)}','${id(10)}','X2','draft',null,'');
    insert into fnb_purchase_sales_order_links values
      ('${id(1)}','${id(710)}','${id(810)}',1),
      ('${id(1)}','${id(711)}','${id(811)}',1);
  `);
  const auditPath = process.env.ONEBIZ_INVENTORY_LOT_AUDIT_FILE;
  const actual = auditPath ? JSON.parse(await readFile(auditPath, "utf8")) : [];
  for (const [file, name] of sources) {
    const definition = actual.find(
      (entry) => entry.proname === name,
    )?.definition;
    if (auditPath) assert.ok(definition, name);
    await db.exec(definition ?? (await functionFromMigration(file, name)));
  }
  await db.exec(
    await readFile(
      new URL(
        "../../supabase/migrations/20261112012614_staff_branch_inventory_related_read.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec("set role authenticated");
  const result = async (sql, args) =>
    (await db.query(sql, args)).rows[0].result;
  const links = await result("select get_fnb_purchase_order_links($1) result", [
    [id(710), id(711)],
  ]);
  assert.deepEqual(
    links.map((link) => link.purchaseOrderId),
    [id(711)],
  );
  assert.equal(
    (
      await result("select get_fnb_warehouse_order_for_change($1) result", [
        id(711),
      ])
    ).salesOrderCode,
    "X2",
  );
  await assert.rejects(
    result("select get_fnb_warehouse_order_for_change($1) result", [id(710)]),
    { code: "42501" },
  );
  await assert.rejects(
    result("select get_internal_receiving_workspace($1) result", [id(10)]),
    /INTERNAL_RECEIVE_BRANCH_DENIED/,
  );
  await assert.rejects(
    result("select get_internal_stock_returns($1) result", [id(10)]),
    /RETURN_LIST_DENIED/,
  );
  console.log(
    "PASS inventory related reads: branch-only access to linked purchase orders and denial of receiving/return queries in the other branch.",
  );
}
