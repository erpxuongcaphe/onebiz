// Synthetic branch fixtures. Optional audit mode loads captured public function
// definitions from the private .review directory; no production data is used.
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
  await db.exec(
    await functionFromMigration(
      "20261111070229_staff_branch_checkout_permissions.sql",
      "_staff_permission_at_scope",
    ),
  );
  await db.exec(`create schema extensions;
  alter table kitchen_orders add column status text default 'pending',add column invoice_id uuid,add column merged_into_id uuid,add column updated_at timestamptz default now();
  create table kitchen_order_items(id uuid primary key,kitchen_order_id uuid,status text,started_at timestamptz,completed_at timestamptz,quantity numeric,cancelled_qty numeric);
  create table invoices(id uuid primary key,code text,tenant_id uuid,branch_id uuid,customer_id uuid,customer_name text,status text,debt numeric,source text);
  create table invoice_items(id uuid,invoice_id uuid,quantity numeric,returned_qty numeric);
  create table fnb_invoice_kitchen_line_sources(kitchen_order_item_id uuid,invoice_item_id uuid);
  create function public._fnb_kitchen_remaining_00424(uuid) returns numeric language sql stable as $$select 1$$;
  insert into kitchen_order_items(id,kitchen_order_id,status,quantity) values('${id(40)}','${id(30)}','pending',1),('${id(41)}','${id(31)}','pending',1);
  insert into invoices values('${id(50)}','SYNTHETIC','${id(1)}','${id(10)}',null,'Test','draft',0,'retail');
  insert into user_branches(user_id,branch_id) values('${id(101)}','${id(11)}');
  insert into staff_branch_permission_catalog values('pos_fnb.view_orders',1);
  insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values
   ('${id(1)}','${id(101)}','${id(10)}','pos_fnb.view_orders','grant','${id(100)}'),
   ('${id(1)}','${id(101)}','${id(11)}','pos_fnb.view_orders','revoke','${id(100)}');
  select set_config('request.jwt.claim.sub','${id(101)}',false);`);
  const entries = [
    ["00424_fnb_kds_exact_return_quantities.sql", "fnb_kitchen_return_lines"],
    ["00422_fnb_kitchen_return_summary.sql", "fnb_kitchen_return_summary"],
    [
      "00379_allow_paid_kitchen_orders_to_progress.sql",
      "fnb_update_kitchen_item_status_v2",
    ],
    [
      "00379_allow_paid_kitchen_orders_to_progress.sql",
      "fnb_update_kitchen_order_status_v2",
    ],
    ["00455_fnb_cancel_requests.sql", "fnb_request_cancel_00455"],
    [
      "00381_allow_customer_credit_on_sales_return.sql",
      "_create_sales_return_auth_impl_00244",
    ],
    [
      "00244_atomic_sales_return.sql",
      "_create_sales_return_auth_impl_00244_pre_00381",
    ],
  ];
  const captured = process.env.ONEBIZ_FNB_VIEW_AUDIT_FILE
    ? JSON.parse(await readFile(process.env.ONEBIZ_FNB_VIEW_AUDIT_FILE, "utf8"))
    : null;
  for (const [source, name] of entries) {
    let definition;
    if (captured) {
      const actual = captured.find((x) => x.proname === name);
      assert.ok(actual, `${name} must be captured`);
      definition = actual.definition;
    } else {
      const original = name.endsWith("_pre_00381")
        ? "create_sales_return_atomic"
        : name;
      definition = await functionFromMigration(source, original);
      if (original !== name)
        definition = definition.replace(
          `public.${original}(`,
          `public.${name}(`,
        );
    }
    await db.exec(definition);
  }
  await db.exec(
    await file("20261112060149_staff_branch_fnb_view_consumers.sql"),
  );
  for (const name of [
    "fnb_kitchen_return_lines",
    "fnb_kitchen_return_summary",
  ]) {
    assert.equal(
      (await db.query(`select * from ${name}('${id(10)}')`)).rows.length,
      0,
    );
    await assert.rejects(
      db.query(`select * from ${name}('${id(11)}')`),
      /INSUFFICIENT_PERMISSION/,
    );
  }
  await assert.rejects(
    db.query(
      `select fnb_update_kitchen_item_status_v2('${id(41)}','preparing')`,
    ),
    /INSUFFICIENT_PERMISSION/,
  );
  await db.query(
    `select fnb_update_kitchen_item_status_v2('${id(40)}','preparing')`,
  );
  assert.equal(
    (
      await db.query(
        `select status from kitchen_order_items where id='${id(40)}'`,
      )
    ).rows[0].status,
    "preparing",
  );
  await assert.rejects(
    db.query(`select fnb_update_kitchen_order_status_v2('${id(31)}','served')`),
    /INSUFFICIENT_PERMISSION/,
  );
  await assert.rejects(
    db.query(`select fnb_request_cancel_00455('${id(31)}','[]','no',false)`),
    /PERMISSION_DENIED/,
  );
  await assert.rejects(
    db.query(`select fnb_request_cancel_00455('${id(30)}','[]','no',false)`),
    /CANCEL_REASON_REQUIRED/,
  );
  for (const name of [
    "_create_sales_return_auth_impl_00244",
    "_create_sales_return_auth_impl_00244_pre_00381",
  ]) {
    await assert.rejects(
      db.query(`select ${name}('${id(50)}','[]',0)`),
      /INVOICE_NOT_COMPLETED/,
    );
    await db.exec(
      `update user_branch_permission_overrides set override_type='revoke' where branch_id='${id(10)}' and permission_code='pos_fnb.view_orders'`,
    );
    await assert.rejects(
      db.query(`select ${name}('${id(50)}','[]',0)`),
      /INSUFFICIENT_PERMISSION/,
    );
    await db.exec(
      `insert into role_permissions values('${id(20)}','pos_retail.checkout')`,
    );
    await assert.rejects(
      db.query(`select ${name}('${id(50)}','[]',0)`),
      /INVOICE_NOT_COMPLETED/,
    );
    await db.exec(
      `delete from role_permissions where permission_code='pos_retail.checkout'; update user_branch_permission_overrides set override_type='grant' where branch_id='${id(10)}' and permission_code='pos_fnb.view_orders'`,
    );
  }
  await db.exec(`alter table kitchen_orders enable row level security;
    alter table kitchen_order_items enable row level security;
    alter function public.get_user_tenant_id() security definer;
    create policy legacy_orders on kitchen_orders for select to authenticated using (tenant_id=public.get_user_tenant_id());
    create policy legacy_items on kitchen_order_items for select to authenticated using (true);
    grant usage on schema public,auth to authenticated;
    grant select on kitchen_orders,kitchen_order_items to authenticated;
    delete from role_permissions where permission_code='pos_fnb.split_bill';`);
  await db.exec(
    await file("20261112065630_staff_branch_fnb_view_direct_reads.sql"),
  );
  const visible = async (table) =>
    (await db.query(`select id from ${table} order by id`)).rows.map(
      (r) => r.id,
    );
  await db.exec("set role authenticated");
  assert.deepEqual(
    await visible("kitchen_orders"),
    [id(30)],
    "a local view grant does not expose the denied branch",
  );
  assert.deepEqual(
    await visible("kitchen_order_items"),
    [id(40)],
    "child rows follow the protected order",
  );
  await db.exec(
    `reset role; insert into role_permissions values('${id(20)}','pos_fnb.send_kitchen'); set role authenticated;`,
  );
  assert.deepEqual(
    await visible("kitchen_orders"),
    [id(30), id(31)],
    "independent kitchen permission still enables POS order reads",
  );
  assert.deepEqual(await visible("kitchen_order_items"), [id(40), id(41)]);
  await db.exec(
    `reset role; delete from user_branches where user_id='${id(101)}' and branch_id='${id(11)}'; set role authenticated;`,
  );
  assert.deepEqual(
    await visible("kitchen_orders"),
    [id(30)],
    "POS rights do not grant an unassigned branch",
  );
  await db.exec(
    `reset role; insert into role_permissions values('${id(20)}','reports.analytics'),('${id(20)}','reports.view_all_branches'); set role authenticated;`,
  );
  assert.deepEqual(
    await visible("kitchen_orders"),
    [id(30), id(31)],
    "company reporting retains its independent all-branch scope",
  );
  await db.exec("reset role");
  console.log(
    "PASS: F&B order-view branch checks preserve kitchen actions, return reads and independent retail return permission",
  );
} catch (e) {
  console.error(e.message, e.where ?? "");
  process.exitCode = 1;
} finally {
  await db.close();
}
