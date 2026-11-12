import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { functionFromMigration } from "./inventory.mjs";

const documents = [
  [
    "00315_disposal_export_list_workspace.sql",
    "disposal_export",
    "disposal_exports",
    "disposal_export_items",
    "disposal_id",
  ],
  ["00313_input_invoice_list_workspace.sql", "input_invoice", "input_invoices"],
  [
    "00316_warehouse_list_workspaces_batch.sql",
    "internal_export",
    "internal_exports",
    "internal_export_items",
    "export_id",
  ],
  [
    "00513_inventory_operational_read_projections.sql",
    "inventory_check",
    "inventory_checks",
  ],
  [
    "00312_purchase_order_list_workspace.sql",
    "purchase_order",
    "purchase_orders",
    "purchase_order_items",
    "purchase_order_id",
  ],
  [
    "00314_supplier_return_list_workspace.sql",
    "supplier_return",
    "supplier_returns",
    "supplier_return_items",
    "return_id",
  ],
];

export async function verifyInventoryDocumentReads(db, id) {
  await db.exec(`
    reset role;
    insert into role_permissions values ('${id(20)}','inventory.view');
    update user_branch_permission_overrides set override_type='revoke' where permission_code='inventory.view';
    alter table products add column cost_price numeric, add column unit text;
    create view products_scoped as select * from products;
    grant select on products_scoped to authenticated;
    create table inventory_check_items(
      id uuid, check_id uuid, product_id uuid, product_name text, system_stock numeric,
      actual_stock numeric, difference numeric, unit_cost numeric
    );
  `);
  for (const [file, name, header, child, key] of documents) {
    await db.exec(
      await functionFromMigration(file, `get_${name}_list_workspace`),
    );
    await db.exec(`
      create table ${header}(
        id uuid primary key,tenant_id uuid,branch_id uuid,code text,status text,
        note text,created_at timestamptz default now(),created_by uuid
      );
      insert into ${header}(id,tenant_id,branch_id,code,status,created_by) values
        ('${id(710)}','${id(1)}','${id(10)}','A','balanced','${id(101)}'),
        ('${id(711)}','${id(1)}','${id(11)}','B','balanced','${id(101)}');
      alter table ${header} enable row level security;
      create policy legacy_read on ${header} for select to authenticated using (true);
      grant select on ${header} to authenticated;
    `);
    if (child)
      await db.exec(`
      create table ${child}(id uuid,${key} uuid);
      insert into ${child} values ('${id(720)}','${id(710)}'), ('${id(721)}','${id(711)}');
      alter table ${child} enable row level security;
      create policy legacy_read on ${child} for select to authenticated using (true);
      grant select on ${child} to authenticated;
    `);
  }
  await db.exec(`
    create view inventory_check_items_scoped as select t.* from inventory_check_items t
      where exists(select 1 from inventory_checks o where o.id=t.check_id
        and _can_read_branch_inventory_00476(auth.uid(),o.tenant_id,o.branch_id));
    grant select on inventory_check_items_scoped to authenticated;
    insert into inventory_check_items values
      ('${id(720)}','${id(710)}','${id(600)}','Coffee',0,10,10,10),
      ('${id(721)}','${id(711)}','${id(600)}','Coffee',0,90,90,10);
    insert into role_permissions values ('${id(20)}','inventory.edit_check');
  `);
  const sourceName = "get_inventory_check_change_source";
  const dir = new URL("../../supabase/migrations/", import.meta.url);
  if (process.env.ONEBIZ_INVENTORY_LOT_AUDIT_FILE) {
    const definitions = JSON.parse(
      await readFile(process.env.ONEBIZ_INVENTORY_LOT_AUDIT_FILE, "utf8"),
    );
    for (const name of [
      ...documents.map(([, kind]) => `get_${kind}_list_workspace`),
      sourceName,
    ]) {
      const match = definitions.find((entry) => entry.proname === name);
      assert.ok(match, name);
      await db.exec(match.definition);
    }
  } else {
    await db.exec(
      await functionFromMigration(
        "20261026115757_inventory_check_amendment.sql",
        sourceName,
      ),
    );
  }
  await db.exec(
    await readFile(
      new URL("20261112012240_staff_branch_inventory_document_read.sql", dir),
      "utf8",
    ),
  );
  await db.exec("set role authenticated");
  const ids = async (table) =>
    (await db.query(`select id from ${table} order by id`)).rows.map(
      (row) => row.id,
    );
  for (const [, name, header, child] of documents) {
    assert.deepEqual(await ids(header), [id(710)]);
    if (child) assert.deepEqual(await ids(child), [id(720)]);
    await assert.rejects(
      db.query(`select get_${name}_list_workspace(p_branch_id=>$1)`, [id(11)]),
      /PERMISSION_DENIED/,
    );
  }
  assert.deepEqual(await ids("inventory_check_items_scoped"), [id(720)]);
  const list = async () =>
    (await db.query("select get_inventory_check_list_workspace() result"))
      .rows[0].result;
  assert.equal((await list()).total, 1);
  assert.equal((await list()).summary.netVariance, 100);
  await assert.rejects(
    db.query("select get_inventory_check_change_source($1)", [id(711)]),
    /BRANCH_ACCESS_DENIED/,
  );
  await db.exec(`
    reset role;
    delete from role_permissions where permission_code='inventory.view';
    update user_branch_permission_overrides set override_type='grant' where permission_code='inventory.view';
    set role authenticated;
  `);
  assert.deepEqual(await ids("inventory_check_items_scoped"), [id(721)]);
  assert.equal((await list()).total, 1);
  assert.equal((await list()).summary.netVariance, 900);
  console.log(
    "PASS inventory documents: six workspace entry checks, direct headers and lines, and scoped inventory-check totals and details.",
  );
}
