import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { initializeStaffAccessFixture } from "./staff-access-tests/fixture.mjs";
import { functionFromMigration } from "./staff-access-tests/inventory.mjs";

const { PGlite } = await import(
  process.env.ONEBIZ_PGLITE_MODULE
    ? pathToFileURL(process.env.ONEBIZ_PGLITE_MODULE).href
    : "@electric-sql/pglite"
);
const db = new PGlite();
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
try {
  await initializeStaffAccessFixture(db, id);
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/20261111052704_staff_branch_access.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    await functionFromMigration(
      "20261111070229_staff_branch_checkout_permissions.sql",
      "_staff_permission_at_scope",
    ),
  );
  await db.exec(`
    create table invoices(id uuid primary key,tenant_id uuid,branch_id uuid,code text,status text,paid numeric,debt numeric,client_session_id uuid,updated_at timestamptz,note text,deleted_at timestamptz);
    create table sales_orders(id uuid primary key,tenant_id uuid,branch_id uuid,code text,status text,updated_at timestamptz,note text,created_by uuid);
    create table shipping_orders(id uuid primary key,tenant_id uuid,invoice_id uuid,status text,code text,partner_id uuid,updated_at timestamptz);
    create table stock_movements(tenant_id uuid,reference_id uuid,reference_type text);
    create table cash_transactions(tenant_id uuid,reference_id uuid,reference_type text,status text);
    create table delivery_partners(id uuid,name text);
    insert into user_branches values ('${id(101)}','${id(11)}',null);
    insert into staff_branch_permission_catalog values ('orders.cancel',1);
    insert into role_permissions values ('${id(20)}','orders.cancel'),('${id(20)}','orders.create');
    insert into invoices(id,tenant_id,branch_id,code,status,paid,debt) values
      ('${id(210)}','${id(1)}','${id(10)}','A','draft',0,0),
      ('${id(211)}','${id(1)}','${id(11)}','B','draft',0,0),
      ('${id(213)}','${id(1)}','${id(11)}','B2','draft',0,0);
    insert into sales_orders(id,tenant_id,branch_id,code,status) values
      ('${id(220)}','${id(1)}','${id(10)}','A','new'),
      ('${id(221)}','${id(1)}','${id(11)}','B','new');
    insert into shipping_orders(id,tenant_id,invoice_id,code,status) values
      ('${id(230)}','${id(1)}','${id(210)}','A','pending'),
      ('${id(231)}','${id(1)}','${id(211)}','B','pending'),
      ('${id(233)}','${id(1)}','${id(213)}','B2','pending');
    select set_config('request.jwt.claim.sub','${id(101)}',false);
  `);
  const names = [
    [
      "00271_atomic_draft_invoice_edit_cancel.sql",
      "cancel_draft_invoice_atomic",
    ],
    [
      "00270_atomic_legacy_sales_order_state.sql",
      "cancel_legacy_sales_order_atomic",
    ],
    ["00276_atomic_shipping_status.sql", "update_shipping_order_status_atomic"],
  ];
  const actual = process.env.ONEBIZ_ORDER_CANCEL_AUDIT_FILE
    ? JSON.parse(
        await readFile(process.env.ONEBIZ_ORDER_CANCEL_AUDIT_FILE, "utf8"),
      )
    : [];
  for (const [file, name] of names) {
    let source = actual.find((entry) => entry.proname === name)?.definition;
    if (process.env.ONEBIZ_ORDER_CANCEL_AUDIT_FILE) assert.ok(source, name);
    source ??= await functionFromMigration(file, name);
    await db.exec(source);
  }
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/20261112035507_staff_branch_order_cancel.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const invoice = (n) =>
    db.query("select cancel_draft_invoice_atomic($1,'test reason')", [id(n)]);
  const order = (n) =>
    db.query("select cancel_legacy_sales_order_atomic($1,'test reason')", [
      id(n),
    ]);
  const ship = (n, status) =>
    db.query("select update_shipping_order_status_atomic($1,$2,null)", [
      id(n),
      status,
    ]);
  await db.exec(`insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
    values ('${id(1)}','${id(101)}','${id(10)}','orders.cancel','revoke','${id(100)}');`);
  await assert.rejects(invoice(210), /INVOICE_CANCEL_DENIED/);
  await assert.rejects(order(220), /SALES_ORDER_CANCEL_DENIED/);
  await assert.rejects(
    ship(230, "cancelled"),
    /SHIPPING_STATUS_PERMISSION_REQUIRED/,
  );
  assert.equal(
    (await db.query("select status from invoices where id=$1", [id(210)]))
      .rows[0].status,
    "draft",
  );
  // The separate order-creation right still permits a shipment status update.
  await ship(230, "picked_up");
  await ship(231, "cancelled");
  await invoice(211);
  await order(221);
  await db.exec(`delete from role_permissions where permission_code='orders.cancel';
    update user_branch_permission_overrides set branch_id='${id(11)}',override_type='grant' where permission_code='orders.cancel';`);
  await invoice(213);
  assert.equal(
    (
      await db.query("select status from shipping_orders where id=$1", [
        id(233),
      ])
    ).rows[0].status,
    "cancelled",
  );
  await assert.rejects(invoice(210), /INVOICE_CANCEL_DENIED/);
  await db.exec(
    `insert into user_permission_overrides(tenant_id,user_id,permission_code,override_type) values ('${id(1)}','${id(101)}','orders.cancel','revoke');`,
  );
  await assert.rejects(invoice(213), /INVOICE_CANCEL_DENIED/);
  console.log(
    "PASS order cancellation: persisted branch scope, independent shipping right, local grant and global deny.",
  );
  const { verifyOrderCreate } = await import(
    "./staff-access-tests/order-create.mjs"
  );
  await verifyOrderCreate(db, id);
  const { verifyOrderDirectWrites } = await import(
    "./staff-access-tests/order-direct-writes.mjs"
  );
  await verifyOrderDirectWrites(db, id);
} finally {
  await db.close();
}
