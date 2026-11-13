import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { functionFromMigration } from "./inventory.mjs";

export async function verifyInventoryFnbInvoiceReads(db, id) {
  await db.exec(`reset role;
    alter table invoices add column source text default 'fnb', add column deleted_at timestamptz;
    alter table kitchen_orders add column invoice_id uuid;
    create table kitchen_order_items(id uuid,kitchen_order_id uuid,product_id uuid,note text,modifier_selections jsonb,variant_label text);
    create table fnb_invoice_kitchen_line_sources(invoice_item_id uuid,kitchen_order_item_id uuid);
    create table fnb_invoice_item_options_20261023(invoice_item_id uuid,tenant_id uuid,branch_id uuid,modifier_selections jsonb,variant_label text);
    create table fnb_invoice_choice_rows_20261023(id uuid,invoice_id uuid,product_id uuid,size text,choices jsonb);
    create function fnb_table_label_20261023(invoices) returns text language sql as $$select ($1).code$$;
    create function fnb_area_label_20261023(invoices) returns text language sql as $$select ($1).code$$;
    update invoices set branch_id='${id(11)}',code='B' where id='${id(811)}';
    update invoices set code='A' where id='${id(810)}';
    insert into invoice_items(id,invoice_id,product_id,product_name,note) values
      ('${id(830)}','${id(810)}','${id(600)}','Coffee A','A note'),
      ('${id(831)}','${id(811)}','${id(601)}','Coffee B','B note');
    insert into fnb_invoice_choice_rows_20261023 values
      ('${id(830)}','${id(810)}','${id(600)}','M','{}'),
      ('${id(831)}','${id(811)}','${id(601)}','L','{}');
    delete from user_branch_permission_overrides where permission_code='inventory.view';
    delete from role_permissions where permission_code in ('inventory.view','invoices.view','pos_fnb.view_orders','orders.view');
    insert into role_permissions values ('${id(20)}','inventory.view');
    grant select on invoices to authenticated;
  `);
  const entries = [
    [
      "202610230008_fnb_invoice_option_filters.sql",
      "fnb_invoice_option_items_20261023",
    ],
    [
      "202610230008_fnb_invoice_option_filters.sql",
      "get_fnb_invoice_choice_catalog_20261023",
    ],
    [
      "202610230005_fnb_invoice_service_filters.sql",
      "get_fnb_invoice_filter_options_20261023",
    ],
    [
      "202610230007_fnb_invoice_option_details.sql",
      "get_fnb_invoice_item_details_20261023",
    ],
    [
      "202610230006_fnb_invoice_item_notes.sql",
      "get_fnb_invoice_item_notes_20261023",
    ],
  ];
  const actual = process.env.ONEBIZ_INVENTORY_LOT_AUDIT_FILE
    ? JSON.parse(
        await readFile(process.env.ONEBIZ_INVENTORY_LOT_AUDIT_FILE, "utf8"),
      )
    : [];
  for (const [file, name] of entries) {
    let source = actual.find((entry) => entry.proname === name)?.definition;
    if (process.env.ONEBIZ_INVENTORY_LOT_AUDIT_FILE) assert.ok(source, name);
    source ??= await functionFromMigration(file, name);
    if (
      !process.env.ONEBIZ_INVENTORY_LOT_AUDIT_FILE &&
      !source.includes("public.user_has_permission(actor,'inventory.view')")
    ) {
      source = source.replace(
        "public.user_has_permission(actor,'pos_fnb.view_orders')",
        "public.user_has_permission(actor,'pos_fnb.view_orders') or public.user_has_permission(actor,'orders.view') or public.user_has_permission(actor,'inventory.view')",
      );
    }
    await db.exec(source);
  }
  await db.exec(
    await readFile(
      new URL(
        "../../supabase/migrations/20261112033521_staff_branch_inventory_fnb_invoice_reads.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      new URL(
        "../../supabase/migrations/20261112062412_staff_branch_fnb_view_invoices.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      new URL(
        "../../supabase/migrations/20261112072555_staff_branch_invoice_order_view_consumers.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const query = async (sql, args = []) => (await db.query(sql, args)).rows;
  const catalog = async () =>
    (await query("select get_fnb_invoice_choice_catalog_20261023() r"))[0].r;
  const filters = async () =>
    (await query("select get_fnb_invoice_filter_options_20261023() r"))[0].r;
  const notes = (invoice) =>
    query("select * from get_fnb_invoice_item_notes_20261023($1)", [
      id(invoice),
    ]);
  const details = (invoices) =>
    query("select * from get_fnb_invoice_item_details_20261023($1)", [
      invoices.map(id),
    ]);
  const options = (invoice) =>
    query(
      "select x.* from invoices i cross join lateral fnb_invoice_option_items_20261023(i) x where i.id=$1",
      [id(invoice)],
    );
  await db.exec("set role authenticated");
  assert.deepEqual((await catalog()).sizes, ["L", "M"]);
  await db.exec(`reset role;
    insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
    values ('${id(1)}','${id(101)}','${id(10)}','inventory.view','revoke','${id(100)}');
    set role authenticated;`);
  assert.deepEqual((await catalog()).sizes, ["L"]);
  assert.deepEqual((await filters()).areas, ["B"]);
  assert.equal((await options(810)).length, 0);
  assert.equal((await options(811)).length, 1);
  await assert.rejects(notes(810), /INVOICE_VIEW_REQUIRED/);
  assert.equal((await notes(811))[0].note, "B note");
  await assert.rejects(details([810, 811]), /INVOICE_ACCESS_DENIED/);
  assert.equal((await details([811]))[0].note, "B note");
  await db.exec(`reset role; delete from role_permissions where permission_code='inventory.view';
    update user_branch_permission_overrides set branch_id='${id(11)}',override_type='grant' where permission_code='inventory.view';
    set role authenticated;`);
  assert.deepEqual((await catalog()).sizes, ["L"]);
  await assert.rejects(notes(810), /INVOICE_VIEW_REQUIRED/);
  assert.equal((await notes(811)).length, 1);
  await db.exec(
    `reset role; insert into role_permissions values ('${id(20)}','invoices.view'); set role authenticated;`,
  );
  assert.deepEqual((await catalog()).sizes, ["L", "M"]);
  assert.equal((await notes(810)).length, 1);
  assert.equal((await details([810, 811])).length, 2);
  await db.exec(`reset role;
    delete from role_permissions where permission_code in ('inventory.view','invoices.view','pos_fnb.view_orders');
    delete from user_branch_permission_overrides where permission_code='inventory.view';
    insert into staff_branch_permission_catalog values('pos_fnb.view_orders',1);
    insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values
      ('${id(1)}','${id(101)}','${id(10)}','pos_fnb.view_orders','grant','${id(100)}'),
      ('${id(1)}','${id(101)}','${id(11)}','pos_fnb.view_orders','revoke','${id(100)}');
    set role authenticated;`);
  assert.deepEqual((await catalog()).sizes, ["M"]);
  assert.deepEqual((await filters()).areas, ["A"]);
  assert.equal((await options(810)).length, 1);
  assert.equal((await options(811)).length, 0);
  assert.equal((await notes(810)).length, 1);
  await assert.rejects(notes(811), /INVOICE_VIEW_REQUIRED/);
  await assert.rejects(details([810, 811]), /INVOICE_ACCESS_DENIED/);
  await db.exec(
    `reset role; insert into role_permissions values ('${id(20)}','invoices.view'); set role authenticated;`,
  );
  assert.deepEqual((await catalog()).sizes, ["L", "M"]);
  assert.equal((await notes(811)).length, 1);
  for (const code of ["orders.view", "invoices.view"]) {
    await db.exec(`reset role;
      delete from role_permissions where permission_code in ('inventory.view','invoices.view','orders.view','pos_fnb.view_orders');
      delete from user_branch_permission_overrides where permission_code in ('inventory.view','invoices.view','orders.view','pos_fnb.view_orders');
      insert into staff_branch_permission_catalog values('${code}',1) on conflict do nothing;
      insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values
       ('${id(1)}','${id(101)}','${id(10)}','${code}','grant','${id(100)}'),
       ('${id(1)}','${id(101)}','${id(11)}','${code}','revoke','${id(100)}');
      set role authenticated;`);
    assert.deepEqual(
      (await catalog()).sizes,
      ["M"],
      `${code} applies to the invoice branch`,
    );
    assert.equal((await options(810)).length, 1);
    assert.equal((await options(811)).length, 0);
    await assert.rejects(notes(811), /INVOICE_VIEW_REQUIRED/);
    await db.exec(`reset role;
      insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values
       ('${id(1)}','${id(101)}','${id(11)}','pos_fnb.view_orders','grant','${id(100)}');
      set role authenticated;`);
    assert.deepEqual(
      (await catalog()).sizes,
      ["L", "M"],
      "the independent F&B branch grant still permits invoice B",
    );
  }
  console.log(
    "PASS F&B invoice reads: inventory scope, mixed invoices and independent invoice permission.",
  );
}
