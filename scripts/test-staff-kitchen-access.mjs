// Actual public authorization bodies; historical send aliases use the public
// base implementation. An optional local export verifies their current bodies.
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
const sqlFile = (name) =>
  readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
let checks = 0;
try {
  await initializeStaffAccessFixture(db, id);
  await db.exec(await sqlFile("20261111052704_staff_branch_access.sql"));
  await db.exec(
    await functionFromMigration(
      "20261111070229_staff_branch_checkout_permissions.sql",
      "_staff_permission_at_scope",
    ),
  );
  await db.exec(`create schema extensions;
 alter table tenants add column settings jsonb;
 alter table profiles add column pos_pin_hash text,add column pos_pin_locked_until timestamptz,add column pos_pin_failed_attempts integer default 0;
 alter table kitchen_orders add column status text default 'pending',add column invoice_id uuid,add column delivery_staff_id uuid,add column delivery_assigned_at timestamptz,add column created_at timestamptz default now(),add column delivery_completed_at timestamptz;
 alter table kitchen_orders add column order_type text default 'delivery',add column delivery_platform text default 'direct',add column customer_id uuid,add column customer_name text,add column delivery_address text,add column delivery_phone text,add column delivery_recipient text;
 update kitchen_orders set delivery_staff_id='${id(100)}';
 create table fnb_print_points(id uuid,tenant_id uuid,branch_id uuid,enabled boolean);create table fnb_print_jobs(id uuid);
 create table invoices(id uuid,code text,tenant_id uuid,branch_id uuid,customer_id uuid,customer_name text,status text,debt numeric,source text,shift_id uuid);
 create table shifts(id uuid,tenant_id uuid,branch_id uuid,cashier_id uuid,status text,starting_cash numeric,opened_at timestamptz);
 create table products(id uuid,tenant_id uuid,name text,category_id uuid,sort_order integer,channel text,product_type text,is_active boolean,allow_sale boolean);
 create table product_variants(id uuid,tenant_id uuid,product_id uuid,name text);
 create table categories(id uuid,tenant_id uuid,name text,sort_order integer,scope text);
 insert into products(id,tenant_id,name) values('${id(80)}','${id(1)}','Synthetic coffee');
 insert into user_branches(user_id,branch_id) values('${id(101)}','${id(11)}');
 update profiles set pos_pin_hash='synthetic-not-a-real-hash' where id='${id(101)}';
 select set_config('request.jwt.claim.sub','${id(101)}',false);`);
  await (
    await import("./staff-access-tests/checkout-definitions.mjs")
  ).loadCheckoutDefinitions(db);
  const sendNames = [
    "_fnb_send_to_kitchen_before_branch_price_20261028",
    "_fnb_send_to_kitchen_impl_00303",
    "_fnb_send_to_kitchen_impl_before_00377",
    "_fnb_send_to_kitchen_impl_before_00449",
  ];
  const sendBase = await functionFromMigration(
    "00303_fnb_topping_compat_phase1.sql",
    "fnb_send_to_kitchen_atomic_v2",
  );
  for (const name of sendNames)
    await db.exec(
      sendBase.replace(
        "public.fnb_send_to_kitchen_atomic_v2(",
        `public.${name}(`,
      ),
    );
  const names = [
    ...sendNames,
    "_fnb_print_access_v1",
    "fnb_print_enqueue_v1",
    "fnb_save_order_note_v1",
    "fnb_select_order_customer_v1",
    "get_fnb_delivery_price_policy",
  ];
  for (const [file, name] of [
    ["00252_harden_fnb_kds_delivery.sql", "assign_delivery_staff_to_order"],
    ["00252_harden_fnb_kds_delivery.sql", "complete_delivery_for_order"],
    ["00252_harden_fnb_kds_delivery.sql", "fnb_set_delivery_pricing_v2"],
    [
      "202610200003_fnb_delivery_dispatch.sql",
      "fnb_delivery_destination_20261020",
    ],
    [
      "202610200003_fnb_delivery_dispatch.sql",
      "fnb_delivery_dispatch_20261020",
    ],
    ["00564_fnb_branch_pos_layout.sql", "get_fnb_pos_menu_layout"],
    [
      "20261027163753_fnb_delivery_staff_branch_scope.sql",
      "list_fnb_delivery_staff_20261027",
    ],
    ["00344_harden_fnb_pos_pin_handover.sql", "list_pos_pin_users"],
    ["00460_persist_pos_pin_failed_attempts.sql", "verify_pos_pin"],
    ["00425_fnb_menu_display_order.sql", "get_fnb_menu_order_revision"],
    ["00566_manager_approval_requests.sql", "request_manager_approval_00566"],
  ]) {
    await db.exec(await functionFromMigration(file, name));
    names.push(name);
  }
  for (const name of [
    "_manager_approval_permission_00566",
    "_manager_approval_detail_00566",
    "_manager_approval_items_00566",
  ])
    await db.exec(
      await functionFromMigration("00566_manager_approval_requests.sql", name),
    );
  await db.exec(
    await functionFromMigration(
      "202610200002_fnb_selected_item_discount.sql",
      "_validate_fnb_item_discount_20261020",
    ),
  );
  const approvalSetup = await sqlFile("00566_manager_approval_requests.sql");
  await db.exec(
    approvalSetup.slice(
      approvalSetup.indexOf("create table public.manager_approval_requests"),
      approvalSetup.indexOf(
        "create function public._manager_approval_permission",
      ),
    ),
  );
  if (process.env.ONEBIZ_KITCHEN_AUDIT_FILE) {
    const defs = JSON.parse(
      await readFile(process.env.ONEBIZ_KITCHEN_AUDIT_FILE, "utf8"),
    ).filter((f) => names.includes(f.proname));
    assert.equal(defs.length, names.length);
    for (const f of defs) await db.exec(f.definition + ";");
  }
  await db.exec(
    await sqlFile("20261111095224_staff_branch_kitchen_permissions.sql"),
  );
  await db.exec(`insert into role_permissions values('${id(20)}','pos_fnb.send_kitchen');
 insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values
 ('${id(1)}','${id(101)}','${id(10)}','pos_fnb.send_kitchen','revoke','${id(100)}'),
 ('${id(1)}','${id(101)}','${id(11)}','pos_fnb.send_kitchen','grant','${id(100)}');`);
  for (const name of sendNames) {
    await assert.rejects(
      db.query(`select ${name}('${id(10)}')`),
      /INSUFFICIENT_PERMISSION/,
    );
    checks++;
    // Caller-supplied allowed branch cannot override the persisted denied order.
    await assert.rejects(
      db.query(`select ${name}('${id(11)}',p_existing_order_id:='${id(30)}')`),
      /INSUFFICIENT_PERMISSION/,
    );
    checks++;
  }
  for (const [sql, pattern] of [
    [
      `select assign_delivery_staff_to_order('${id(30)}','${id(100)}')`,
      /PERMISSION/,
    ],
    [
      `select complete_delivery_for_order('${id(30)}')`,
      /PERMISSION|DELIVERY_COMPLETION_NOT_ALLOWED/,
    ],
    [
      `select fnb_delivery_destination_20261020('${id(30)}','Address','000','Recipient')`,
      /DENIED/,
    ],
    [
      `select fnb_set_delivery_pricing_v2('${id(30)}','direct',0,0)`,
      /PERMISSION/,
    ],
    [`select fnb_save_order_note_v1('${id(30)}','test','')`, /DENIED/],
    [`select fnb_select_order_customer_v1('${id(30)}',null)`, /DENIED/],
    [`select get_fnb_delivery_price_policy('${id(10)}')`, /DENIED/],
    [`select get_fnb_pos_menu_layout('${id(10)}')`, /DENIED/],
    [`select list_fnb_delivery_staff_20261027('${id(10)}')`, /PERMISSION/],
    [`select verify_pos_pin('${id(100)}','123456','${id(10)}')`, /DENIED/],
    [`select _fnb_print_access_v1('${id(10)}')`, /quyền/],
    [
      `select fnb_print_enqueue_v1('${id(10)}',null,'kitchen','Test','80mm','')`,
      /quyền/,
    ],
  ]) {
    try {
      await assert.rejects(db.query(sql), pattern);
      checks++;
    } catch (e) {
      console.error(sql);
      throw e;
    }
  }
  assert.equal(
    (await db.query(`select * from list_pos_pin_users('${id(10)}')`)).rows
      .length,
    0,
  );
  checks++;
  await db.exec(
    "delete from role_permissions where permission_code='pos_fnb.send_kitchen'",
  );
  assert.equal(
    (await db.query(`select * from list_pos_pin_users('${id(11)}')`)).rows
      .length,
    1,
  );
  checks++;
  assert.equal(
    (await db.query("select length(get_fnb_menu_order_revision()) n")).rows[0]
      .n,
    32,
  );
  checks++;
  for (const name of sendNames) {
    await assert.rejects(
      db.query(`select ${name}('${id(11)}')`),
      /KITCHEN_ORDER_ITEMS_REQUIRED/,
    );
    checks++;
  }
  const meta = {
    branch_id: id(10),
    items: [{ productId: id(80), quantity: 1, unitPrice: 100 }],
    amount: 10,
    subtotal: 100,
  };
  await assert.rejects(
    db.query(
      "select request_manager_approval_00566('fnb.discount_override',$1,'Synthetic approval')",
      [meta],
    ),
    /APPROVAL_PERMISSION_DENIED/,
  );
  checks++;
  meta.branch_id = id(11);
  assert.ok(
    (
      await db.query(
        "select request_manager_approval_00566('fnb.discount_override',$1,'Synthetic approval') value",
        [meta],
      )
    ).rows[0].value.id,
  );
  checks++;
  assert.equal(
    (
      await db.query(
        "select count(*)::integer n from manager_approval_requests",
      )
    ).rows[0].n,
    1,
  );
  checks++;
  await db.exec(`alter table kitchen_orders add column delivery_distance_tier text,add column delivery_fee numeric default 0,add column platform_commission numeric default 0,add column platform_commission_percent numeric default 0,add column updated_at timestamptz;
 insert into role_permissions values('${id(20)}','pos_fnb.edit_price');
 insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values('${id(1)}','${id(101)}','${id(11)}','pos_fnb.edit_price','revoke','${id(100)}');`);
  await assert.rejects(
    db.query(`select fnb_set_delivery_pricing_v2('${id(31)}','direct',0,5)`),
    /PLATFORM_COMMISSION_OVERRIDE_DENIED/,
  );
  checks++;
  assert.equal(
    (
      await db.query(
        `select platform_commission_percent::integer n from kitchen_orders where id='${id(31)}'`,
      )
    ).rows[0].n,
    0,
  );
  checks++;
  await db.exec(
    "delete from role_permissions where permission_code='pos_fnb.edit_price'; update user_branch_permission_overrides set override_type='grant' where permission_code='pos_fnb.edit_price';",
  );
  await db.query(
    `select fnb_set_delivery_pricing_v2('${id(31)}','direct',0,5)`,
  );
  assert.equal(
    (
      await db.query(
        `select platform_commission_percent::integer n from kitchen_orders where id='${id(31)}'`,
      )
    ).rows[0].n,
    5,
  );
  checks++;
  console.log(
    `PASS ${checks} kitchen scope checks (${process.env.ONEBIZ_KITCHEN_AUDIT_FILE ? "actual exported bodies" : "public functions and historical send base aliases"})`,
  );
} catch (e) {
  console.error(e.message, e.where);
  process.exitCode = 1;
} finally {
  await db.close();
}
