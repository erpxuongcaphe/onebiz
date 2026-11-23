import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { initializeStaffAccessFixture } from "./staff-access-tests/fixture.mjs";
import { functionFromMigration } from "./staff-access-tests/inventory.mjs";

const db = new PGlite();
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const migration = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const row = async (query, params = []) => (await db.query(query, params)).rows[0];

async function asActor(actor, role = "authenticated") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [actor ? id(actor) : ""]);
  await db.exec(role === "anon" ? "set role anon" : "set role authenticated");
}

async function change(orderId, expected, next, { table = null, platform = null, fee = 0, tier = null, revision = null } = {}) {
  return (await row("select public.fnb_change_bill_service_v1($1,$2,$3,$4,$5,$6,$7,$8) result",
    [id(orderId), expected, next, table ? id(table) : null, platform, fee, tier, revision])).result;
}

try {
  await initializeStaffAccessFixture(db, id);
  await db.exec(await migration("20261111052704_staff_branch_access.sql"));
  await db.exec(await functionFromMigration("20261111070229_staff_branch_checkout_permissions.sql", "_staff_permission_at_scope"));
  await db.exec(`
    alter table tenants add column settings jsonb;
    alter table kitchen_orders
      add column invoice_id uuid, add column table_id uuid, add column original_table_id uuid,
      add column merged_into_id uuid, add column created_at timestamptz default now(),
      add column updated_at timestamptz, add column status text not null default 'ready',
      add column order_type text not null default 'takeaway', add column order_number text,
      add column note text, add column discount_amount numeric default 0,
      add column delivery_platform text, add column delivery_fee numeric default 0,
      add column platform_commission numeric default 0, add column platform_commission_percent numeric default 0,
      add column platform_commission_amount numeric default 0, add column delivery_distance_tier text,
      add column delivery_assigned_at timestamptz, add column delivery_completed_at timestamptz,
      add column delivery_staff_id uuid, add column delivery_address text, add column delivery_phone text,
      add column delivery_recipient text;
    create table restaurant_tables(id uuid primary key, tenant_id uuid, branch_id uuid, status text,
      current_order_id uuid, is_active boolean default true, updated_at timestamptz);
    create table kitchen_order_items(id uuid primary key, kitchen_order_id uuid, quantity int, status text);
    create table fnb_delivery_fee_tiers(tenant_id uuid, branch_id uuid, tier_code text, fee numeric, is_active boolean);
    insert into restaurant_tables(id, tenant_id, branch_id, status, current_order_id) values
      ('${id(50)}','${id(1)}','${id(10)}','occupied','${id(30)}'),
      ('${id(51)}','${id(1)}','${id(10)}','available',null),
      ('${id(52)}','${id(1)}','${id(11)}','available',null);
    update kitchen_orders set table_id = '${id(50)}', order_type = 'dine_in', order_number = 'KB-30',
      note = 'Giữ ghi chú', discount_amount = 1000 where id = '${id(30)}';
    insert into kitchen_orders(id,tenant_id,branch_id,table_id,order_type) values
      ('${id(33)}','${id(1)}','${id(10)}','${id(50)}','dine_in');
    insert into kitchen_order_items values ('${id(60)}','${id(30)}',2,'ready');
    insert into fnb_delivery_fee_tiers values ('${id(1)}','${id(10)}','near',5000,true);
    insert into role_permissions values ('${id(20)}','pos_fnb.send_kitchen');
  `);
  await db.exec(await migration("202610200001_fnb_delivery_price_policy.sql"));
  await db.exec(await functionFromMigration("00252_harden_fnb_kds_delivery.sql", "fnb_set_delivery_pricing_v2"));
  await db.exec(await migration("20261123014043_fnb_change_bill_service.sql"));

  await asActor(101);
  const direct = { platform: "direct", fee: 123, tier: "near", revision: 0 };
  await assert.rejects(change(31, "takeaway", "delivery", direct), /FNB_SERVICE_DENIED/);
  await assert.rejects(change(32, "takeaway", "delivery", direct), /FNB_SERVICE_DENIED/);
  await assert.rejects(change(30, "dine_in", "delivery", { ...direct, revision: 1 }), /FNB_SERVICE_POLICY_CHANGED/);
  assert.equal((await change(30, "dine_in", "delivery", direct)).delivery_fee, 5000);
  assert.equal((await change(30, "dine_in", "delivery", direct)).changed, false);
  await assert.rejects(change(30, "dine_in", "takeaway"), /FNB_SERVICE_STALE/);
  await assert.rejects(change(30, "delivery", "dine_in", { table: 50 }), /FNB_SERVICE_TABLE_UNAVAILABLE/);
  await assert.rejects(change(30, "delivery", "dine_in", { table: 52 }), /FNB_SERVICE_TABLE_UNAVAILABLE/);
  await db.exec("reset role");
  assert.equal((await row("select current_order_id from restaurant_tables where id = $1", [id(50)])).current_order_id, id(33));
  assert.equal((await row("select count(*)::int n from audit_log where action = 'fnb_order_service_change'")).n, 1);
  await asActor(101);
  assert.equal((await change(30, "delivery", "dine_in", { table: 51 })).table_id, id(51));
  assert.equal((await change(30, "dine_in", "takeaway")).table_id, null);
  assert.equal((await change(30, "takeaway", "dine_in", { table: 51 })).table_id, id(51));
  await change(30, "dine_in", "takeaway");
  assert.equal((await change(30, "takeaway", "delivery", { platform: "grab_food" })).platform_commission_percent, 25);
  await db.exec("reset role");
  await db.query("update kitchen_orders set delivery_staff_id=$1, delivery_assigned_at=now(), delivery_address='Test' where id=$2", [id(101), id(30)]);
  await asActor(101);
  const takeaway = await change(30, "delivery", "takeaway");
  assert.equal(takeaway.delivery_fee, 0);
  assert.equal(takeaway.delivery_staff_id, null);
  assert.equal(takeaway.platform_commission_percent, 0);
  await db.exec("reset role");
  assert.deepEqual(await row("select status,current_order_id from restaurant_tables where id=$1", [id(51)]), { status: "available", current_order_id: null });
  assert.deepEqual(await row("select order_number, note, discount_amount, status, delivery_address from kitchen_orders where id=$1", [id(30)]),
    { order_number: "KB-30", note: "Giữ ghi chú", discount_amount: "1000", status: "ready", delivery_address: null });
  assert.deepEqual(await row("select id,quantity,status from kitchen_order_items where kitchen_order_id=$1", [id(30)]),
    { id: id(60), quantity: 2, status: "ready" });
  await db.query("update tenants set settings = '{\"fnb_delivery_platforms\":{\"grab_food\":{\"active\":false}}}' where id=$1", [id(1)]);
  await asActor(101);
  await assert.rejects(change(30, "takeaway", "delivery", { platform: "grab_food" }), /DELIVERY_PLATFORM_DISABLED/);
  await db.exec("reset role");
  assert.equal((await row("select order_type from kitchen_orders where id=$1", [id(30)])).order_type, "takeaway");
  await db.query(`insert into fnb_delivery_price_policies(branch_id,tenant_id,revision,policy,updated_by)
    values ($1,$2,2,'{"enabled":true,"amountBasis":"after_discount","rules":[{"enabled":true,"fee":10000}]}',$3)`,
    [id(10), id(1), id(100)]);
  await asActor(101);
  await assert.rejects(change(30, "takeaway", "delivery", { platform: "direct", fee: 1, tier: "custom", revision: 2 }), /FNB_SERVICE_FEE_INVALID/);
  assert.equal((await change(30, "takeaway", "delivery", { platform: "direct", fee: 10000, tier: "custom", revision: 2 })).delivery_fee, 10000);
  await assert.rejects(change(30, "takeaway", "delivery", { platform: "direct", fee: 5000, tier: "custom", revision: 2 }), /FNB_SERVICE_STALE/);
  await db.exec("reset role");
  await db.query("update kitchen_orders set delivery_completed_at=now() where id=$1", [id(30)]);
  await asActor(101);
  await assert.rejects(change(30, "delivery", "takeaway"), /FNB_SERVICE_DELIVERED/);
  await db.exec("reset role");
  await db.query("update kitchen_orders set invoice_id=$1 where id=$2", [id(70), id(30)]);
  await asActor(101);
  await assert.rejects(change(30, "takeaway", "delivery", direct), /FNB_SERVICE_CLOSED/);
  await asActor(null, "anon");
  await assert.rejects(change(30, "takeaway", "delivery", direct), /permission denied/);
  console.log("PASS F&B bill service changes, branch scope, retries, tables, delivery pricing and original kitchen lines");
} finally {
  await db.close();
}
