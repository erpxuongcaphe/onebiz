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
const migration = (file) =>
  readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8");

try {
  await initializeStaffAccessFixture(db, id);
  await db.exec(await migration("20261111052704_staff_branch_access.sql"));
  for (const [file, name] of [
    [
      "20261111070229_staff_branch_checkout_permissions.sql",
      "_staff_permission_at_scope",
    ],
    [
      "20261111095224_staff_branch_kitchen_permissions.sql",
      "_staff_permission_any_branch",
    ],
  ])
    await db.exec(await functionFromMigration(file, name));

  await db.exec(`
    create table production_orders(
      id uuid primary key, tenant_id uuid, branch_id uuid, product_id uuid,
      code text, lot_number text, notes text, status text, planned_qty numeric,
      actual_end timestamptz, created_at timestamptz, created_by uuid, cogs_amount numeric
    );
    create table production_order_materials(id uuid, production_order_id uuid);
    create table product_lots(id uuid);
    create table production_used_adjustments(id uuid, tenant_id uuid, branch_id uuid);
    alter table production_used_adjustments enable row level security;
    create policy production_used_adjustments_read on production_used_adjustments
      for select to authenticated using (false);
    create table products_scoped(id uuid, tenant_id uuid, name text, code text);
    create function get_user_accessible_branches(uuid) returns table(branch_id uuid)
    language sql stable as $$ select b.id from branches b where user_has_branch_access($1,b.id) $$;
    create function _can_read_branch_inventory_00476(uuid,uuid,uuid) returns boolean
    language sql stable as $$ select $2=get_user_tenant_id() and user_has_branch_access($1,$3) $$;
    create view production_orders_scoped as select t.* from production_orders t
      join branches b on b.id=t.branch_id
      where _can_read_branch_inventory_00476(auth.uid(),t.tenant_id,t.branch_id);
    create view production_order_materials_scoped as select t.* from production_order_materials t
      where exists(select 1 from production_orders o where o.id=t.production_order_id
        and _can_read_branch_inventory_00476(auth.uid(),o.tenant_id,o.branch_id));
    insert into user_branches values ('${id(101)}','${id(11)}',null);
    insert into products_scoped values ('${id(500)}','${id(1)}','Coffee','P1');
    insert into production_orders values
      ('${id(510)}','${id(1)}','${id(10)}','${id(500)}','A',null,null,'in_production',1,null,now(),'${id(101)}',900),
      ('${id(511)}','${id(1)}','${id(11)}','${id(500)}','B',null,null,'in_production',1,null,now(),'${id(101)}',100);
    insert into production_order_materials values ('${id(520)}','${id(510)}'), ('${id(521)}','${id(511)}');
    insert into production_used_adjustments values ('${id(530)}','${id(1)}','${id(10)}'), ('${id(531)}','${id(1)}','${id(11)}');
    grant usage on schema auth to authenticated;
    grant select on production_orders_scoped,production_order_materials_scoped,
      production_used_adjustments,products_scoped,branches,profiles,role_permissions,
      user_permission_overrides,user_branches to authenticated;
    select set_config('request.jwt.claim.sub','${id(101)}',false);
  `);
  await db.exec(
    await functionFromMigration(
      "00513_inventory_operational_read_projections.sql",
      "get_production_order_list_workspace",
    ),
  );
  await db.exec(
    await functionFromMigration(
      "202610230003_production_used_adjustment.sql",
      "_production_used_adjustment",
    ),
  );
  if (process.env.ONEBIZ_PRODUCTION_READ_AUDIT_FILE) {
    const definitions = JSON.parse(
      await readFile(process.env.ONEBIZ_PRODUCTION_READ_AUDIT_FILE, "utf8"),
    );
    for (const name of [
      "get_production_order_list_workspace",
      "_production_used_adjustment",
    ]) {
      const match = definitions.find((entry) => entry.proname === name);
      assert.ok(match, name);
      await db.exec(match.definition);
    }
  }
  await db.exec(
    await migration("20261112010015_staff_branch_production_read.sql"),
  );

  const list = async (branch = null) =>
    (
      await db.query(
        "select get_production_order_list_workspace(p_branch_id=>$1) result",
        [branch],
      )
    ).rows[0].result;
  const ids = async (view) =>
    (await db.query(`select id from ${view} order by id`)).rows.map(
      (row) => row.id,
    );
  await db.exec("set role authenticated");
  assert.deepEqual(await ids("production_orders_scoped"), [id(510), id(511)]);
  await assert.rejects(list(), /PRODUCTION_LIST_PERMISSION_DENIED/);
  await db.exec(`reset role;
    insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
    values ('${id(1)}','${id(101)}','${id(11)}','production.view','grant','${id(100)}');
    set role authenticated;`);
  assert.deepEqual(await ids("production_orders_scoped"), [id(511)]);
  assert.deepEqual(await ids("production_order_materials_scoped"), [id(521)]);
  assert.deepEqual(await ids("production_used_adjustments"), [id(531)]);
  assert.equal((await list()).total, 1);
  assert.equal((await list()).summary.totalCogs, 100);
  await assert.rejects(list(id(10)), /PRODUCTION_LIST_PERMISSION_DENIED/);
  assert.equal((await list(id(11))).items[0].id, id(511));
  await db.exec(`reset role;
    insert into role_permissions values ('${id(20)}','production.view');
    update user_branch_permission_overrides set override_type='revoke'
      where permission_code='production.view';
    set role authenticated;`);
  assert.deepEqual(await ids("production_orders_scoped"), [id(510)]);
  assert.deepEqual(await ids("production_order_materials_scoped"), [id(520)]);
  assert.deepEqual(await ids("production_used_adjustments"), [id(530)]);
  assert.equal((await list()).summary.totalCogs, 900);
  await assert.rejects(list(id(11)), /PRODUCTION_LIST_PERMISSION_DENIED/);
  await db.exec(`reset role;
    insert into role_permissions values ('${id(20)}','production.correct_order');`);
  const correction = (order) =>
    db.query(
      "select _production_used_adjustment($1,null,null,null,null,false,null,null)",
      [order],
    );
  await assert.rejects(
    correction(id(511)),
    /PRODUCTION_CORRECTION_PERMISSION_REQUIRED/,
  );
  await assert.rejects(
    correction(id(510)),
    /PRODUCTION_CORRECTION_REASON_REQUIRED/,
  );
  await db.exec(`
    update user_branch_permission_overrides set override_type='grant'
      where permission_code='production.view';
    insert into user_permission_overrides(tenant_id,user_id,permission_code,override_type)
    values ('${id(1)}','${id(101)}','production.view','revoke');
    set role authenticated;`);
  assert.deepEqual(await ids("production_orders_scoped"), []);
  await assert.rejects(list(), /PRODUCTION_LIST_PERMISSION_DENIED/);
  console.log(
    "PASS production read: legacy scope, local grant and denial through authenticated list, aggregate, materials and history.",
  );
} finally {
  await db.close();
}
