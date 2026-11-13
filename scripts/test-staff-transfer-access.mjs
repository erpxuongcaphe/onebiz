// Disposable PostgreSQL/WASM only. Never connects to a live project.
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
const migration = (name) =>
  readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
try {
  await initializeStaffAccessFixture(db, id);
  await db.exec(await migration("20261111052704_staff_branch_access.sql"));
  const scoped = await migration(
    "20261111070229_staff_branch_checkout_permissions.sql",
  );
  await db.exec(
    scoped.slice(
      scoped.indexOf("create function public._staff_permission_at_scope"),
      scoped.indexOf("do $migration$"),
    ),
  );
  await db.exec(`
 create table stock_transfers(id uuid primary key default gen_random_uuid(),tenant_id uuid,code text,from_branch_id uuid,to_branch_id uuid,status text,total_items integer,note text,created_by uuid,updated_at timestamptz default now());
 create table stock_transfer_items(id uuid primary key default gen_random_uuid(),transfer_id uuid,product_id uuid,product_name text,product_code text,unit text,quantity numeric,note text);
 create table products(id uuid primary key,tenant_id uuid,name text,code text,unit text,inventory_role text,is_active boolean default true);
 create table branch_stock(tenant_id uuid,branch_id uuid,product_id uuid,variant_id uuid,quantity numeric,reserved numeric default 0);
 create function next_code(uuid,text) returns text language sql as $$select 'TEST-'||gen_random_uuid()$$;
 insert into user_branches(user_id,branch_id) values('${id(101)}','${id(11)}');
 insert into role_permissions values('${id(20)}','inventory.transfer');
 insert into products values('${id(200)}','${id(1)}','Material','MAT','g','raw_material',true);
 insert into branch_stock values('${id(1)}','${id(10)}','${id(200)}',null,100,0),('${id(1)}','${id(11)}','${id(200)}',null,100,0);
 select set_config('request.jwt.claim.sub','${id(101)}',false);
 `);
  for (const name of [
    "create_stock_transfer_atomic",
    "set_stock_transfer_state_atomic",
  ])
    await db.exec(
      await functionFromMigration(
        "00256_harden_stock_document_creation.sql",
        name,
      ),
    );
  await db.exec(
    (
      await functionFromMigration(
        "00249_harden_inventory_check_transfer.sql",
        "complete_stock_transfer_atomic",
      )
    ).replace(
      "public.complete_stock_transfer_atomic(",
      "public._complete_stock_transfer_auth_impl_00249(",
    ),
  );
  await db.exec(
    (
      await functionFromMigration(
        "00515_operational_uom_snapshots.sql",
        "create_stock_operation_with_uom",
      )
    ).replace(
      "user_has_permission(actor,permission)",
      "(case when permission='inventory.check' then public.user_has_permission_at_branch(actor,permission,p_branch_id) else public.user_has_permission(actor,permission) end)",
    ),
  );
  // Optional private audit verifies replacement anchors against deployed functions.
  if (process.env.ONEBIZ_TRANSFER_AUDIT_FILE) {
    const defs = JSON.parse(
      await readFile(process.env.ONEBIZ_TRANSFER_AUDIT_FILE, "utf8"),
    );
    for (const name of [
      "create_stock_transfer_atomic",
      "set_stock_transfer_state_atomic",
      "_complete_stock_transfer_auth_impl_00249",
    ]) {
      const f = defs.find((x) => x.proname === name);
      assert.ok(f, name);
      await db.exec(f.definition);
    }
  }
  await db.exec(
    await migration("20261111123652_staff_branch_transfer_permissions.sql"),
  );
  const create = (from = 10, to = 11) =>
    db.query("select create_stock_transfer_atomic($1,$2,null,$3) value", [
      id(from),
      id(to),
      [{ product_id: id(200), quantity: 2 }],
    ]);
  const first = (await create()).rows[0].value.transfer_id;
  assert.ok(first);
  const before = (await db.query("select count(*)::int n from audit_log"))
    .rows[0].n;
  await db.exec(
    `insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values('${id(1)}','${id(101)}','${id(11)}','inventory.transfer','revoke','${id(100)}')`,
  );
  await assert.rejects(create(), /INSUFFICIENT_PERMISSION/);
  await assert.rejects(create(11, 10), /INSUFFICIENT_PERMISSION/);
  await assert.rejects(
    db.query("select set_stock_transfer_state_atomic($1,'in_transit')", [
      first,
    ]),
    /INSUFFICIENT_PERMISSION/,
  );
  await assert.rejects(
    db.query("select _complete_stock_transfer_auth_impl_00249($1,$2,$3)", [
      id(1),
      first,
      id(101),
    ]),
    /INSUFFICIENT_PERMISSION/,
  );
  await assert.rejects(
    db.query(
      "select create_stock_operation_with_uom('transfer',$1,'[]',$2,$3,null,null)",
      [id(10), id(300), id(11)],
    ),
    /UOM_OPERATION_DENIED/,
  );
  assert.equal(
    (await db.query("select count(*)::int n from audit_log")).rows[0].n,
    before,
  );
  assert.equal(
    (await db.query("select status from stock_transfers where id=$1", [first]))
      .rows[0].status,
    "draft",
  );
  await db.exec(
    `delete from role_permissions where permission_code='inventory.transfer'; update user_branch_permission_overrides set override_type='grant' where permission_code='inventory.transfer';`,
  );
  await assert.rejects(create(), /INSUFFICIENT_PERMISSION/); // One branch alone is insufficient.
  await db.exec(
    `insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values('${id(1)}','${id(101)}','${id(10)}','inventory.transfer','grant','${id(100)}');`,
  );
  assert.ok((await create()).rows[0].value.transfer_id);
  await db.query("select set_stock_transfer_state_atomic($1,'in_transit')", [
    first,
  ]);
  assert.equal(
    (await db.query("select status from stock_transfers where id=$1", [first]))
      .rows[0].status,
    "in_transit",
  );
  await assert.rejects(
    create(10, 12),
    /INSUFFICIENT_PERMISSION|TRANSFER_BRANCH_NOT_FOUND|BRANCH_ACCESS_DENIED/,
  );
  await db.exec(
    `insert into user_permission_overrides(tenant_id,user_id,permission_code,override_type) values('${id(1)}','${id(101)}','inventory.transfer','revoke');`,
  );
  await assert.rejects(create(), /INSUFFICIENT_PERMISSION/);
  await db.exec(`delete from user_permission_overrides where permission_code='inventory.transfer';
 grant usage on schema public,auth to authenticated;
 grant select,insert,update,delete on stock_transfers,stock_transfer_items to authenticated;
 alter table stock_transfers enable row level security; alter table stock_transfer_items enable row level security;
 create policy fixture_legacy on stock_transfers to authenticated using(true) with check(true);
 create policy fixture_legacy on stock_transfer_items to authenticated using(true) with check(true);
 set role authenticated;`);
  assert.equal(
    (await db.query("update stock_transfers set note='bypass' returning id"))
      .rows.length,
    0,
  );
  assert.equal(
    (await db.query("delete from stock_transfers returning id")).rows.length,
    0,
  );
  assert.equal(
    (await db.query("update stock_transfer_items set quantity=99 returning id"))
      .rows.length,
    0,
  );
  assert.equal(
    (await db.query("delete from stock_transfer_items returning id")).rows
      .length,
    0,
  );
  await assert.rejects(
    db.query("insert into stock_transfers(note) values('bypass')"),
    /row-level security/,
  );
  await assert.rejects(
    db.query("insert into stock_transfer_items(quantity) values(99)"),
    /row-level security/,
  );
  // Existing authorized RPC remains usable while direct writes are restricted.
  await db.query("select set_stock_transfer_state_atomic($1,'cancelled')", [
    first,
  ]);
  await db.exec(
    `reset role; delete from user_branch_permission_overrides where permission_code='inventory.transfer'; insert into role_permissions values('${id(20)}','inventory.transfer'); set role authenticated;`,
  );
  assert.ok(
    (await db.query("update stock_transfers set note='legacy' returning id"))
      .rows.length > 0,
  );
  await db.exec("reset role");
  console.log(
    "Transfer access: actual create/state, both branches, global denial, authorization before completion/UOM, and authenticated direct-write isolation passed. Stock completion implementation remains unchanged.",
  );
} finally {
  await db.close();
}
