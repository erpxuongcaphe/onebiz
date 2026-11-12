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
const readers = [
  "get_product_lot_list_workspace",
  "get_lots_for_product",
  "check_expiring_lots",
  "get_prepared_stock_unit_history_00517",
];

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
    ...readers.slice(0, 3).map((name) => ["00527_lot_expiry_time.sql", name]),
    ["00527_lot_expiry_time.sql", "_lot_expiry_moment_00527"],
    ["00517_prepared_stock_gram_cutover.sql", readers[3]],
  ])
    await db.exec(await functionFromMigration(file, name));

  await db.exec(`
    create table products(id uuid primary key,tenant_id uuid,name text,code text);
    create table product_lots(
      id uuid primary key,tenant_id uuid,branch_id uuid,product_id uuid,
      lot_number text,source_type text,production_order_id uuid,purchase_order_id uuid,
      manufactured_date date,manufactured_at timestamptz,expiry_date date,expiry_at timestamptz,
      received_date date,initial_qty numeric,current_qty numeric,status text,
      note text,created_at timestamptz default now(),updated_at timestamptz default now()
    );
    create table prepared_stock_unit_rows_00517(product_id uuid,row_id text,table_name text,old_data jsonb);
    create table prepared_stock_unit_cutovers_00517(product_id uuid,tenant_id uuid,state text,old_unit text,factor numeric);
    create function get_user_accessible_branches(uuid) returns table(branch_id uuid)
    language sql stable as $$ select b.id from branches b where user_has_branch_access($1,b.id) $$;
    create function _can_read_branch_inventory_00476(uuid,uuid,uuid) returns boolean
    language sql stable set search_path=public
    as $$ select $2=get_user_tenant_id() and user_has_branch_access($1,$3) $$;
    insert into user_branches values ('${id(101)}','${id(11)}',null);
    insert into products values ('${id(600)}','${id(1)}','Coffee','P1');
    insert into product_lots(id,tenant_id,branch_id,product_id,lot_number,source_type,
      expiry_date,received_date,initial_qty,current_qty,status) values
      ('${id(610)}','${id(1)}','${id(10)}','${id(600)}','A','production',current_date+2,current_date,90,90,'active'),
      ('${id(611)}','${id(1)}','${id(11)}','${id(600)}','B','purchase',current_date+2,current_date,10,10,'active');
    insert into prepared_stock_unit_cutovers_00517 values ('${id(600)}','${id(1)}','completed','KG',1000);
    insert into prepared_stock_unit_rows_00517
      select product_id,id::text,'product_lots',to_jsonb(product_lots) from product_lots;
    alter table product_lots enable row level security;
    create policy legacy_lot_read on product_lots for select to authenticated
      using (_can_read_branch_inventory_00476(auth.uid(),tenant_id,branch_id));
    grant usage on schema auth to authenticated;
    grant select on product_lots,products,branches,profiles,role_permissions,
      user_permission_overrides,user_branches to authenticated;
    select set_config('request.jwt.claim.sub','${id(101)}',false);
  `);

  if (process.env.ONEBIZ_INVENTORY_LOT_AUDIT_FILE) {
    const definitions = JSON.parse(
      await readFile(process.env.ONEBIZ_INVENTORY_LOT_AUDIT_FILE, "utf8"),
    );
    for (const name of readers) {
      const match = definitions.find((entry) => entry.proname === name);
      assert.ok(match, name);
      await db.exec(match.definition);
    }
  }
  await db.exec(
    await migration("20261112011209_staff_branch_inventory_lot_read.sql"),
  );
  const result = async (sql, args = []) =>
    (await db.query(sql, args)).rows[0].result;
  const workspace = (branch = null) =>
    result("select get_product_lot_list_workspace(p_branch_id=>$1) result", [
      branch,
    ]);
  const history = (lot) =>
    result("select get_prepared_stock_unit_history_00517('lot',$1) result", [
      lot,
    ]);
  const lotIds = async () =>
    (await db.query("select id from product_lots order by id")).rows.map(
      (row) => row.id,
    );
  await db.exec(
    `insert into role_permissions values ('${id(20)}','inventory.view'); set role authenticated;`,
  );
  assert.equal((await workspace()).summary.currentQty, 100);
  assert.deepEqual(await lotIds(), [id(610), id(611)]);
  await db.exec(`reset role;
    insert into staff_branch_permission_catalog values ('inventory.view',1);
    insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
    values ('${id(1)}','${id(101)}','${id(10)}','inventory.view','revoke','${id(100)}');
    set role authenticated;`);
  assert.equal((await workspace()).summary.currentQty, 10);
  assert.deepEqual(await lotIds(), [id(611)]);
  await assert.rejects(workspace(id(10)), /PRODUCT_LOT_LIST_PERMISSION_DENIED/);
  await assert.rejects(history(id(610)), /GRAM_HISTORY_BRANCH_DENIED/);
  assert.equal((await history(id(611))).length, 1);
  assert.deepEqual(
    (
      await result("select check_expiring_lots($1,30) result", [id(1)])
    ).lots.map((lot) => lot.lot_id),
    [id(611)],
  );
  assert.deepEqual(
    (
      await result("select get_lots_for_product($1,null) result", [id(600)])
    ).map((lot) => lot.id),
    [id(611)],
  );
  await db.exec(`reset role;
    delete from role_permissions where permission_code='inventory.view';
    update user_branch_permission_overrides set branch_id='${id(11)}',override_type='grant'
      where permission_code='inventory.view';
    set role authenticated;`);
  assert.equal((await workspace()).summary.currentQty, 10);
  assert.equal((await workspace(id(11))).items[0].id, id(611));
  assert.deepEqual(await lotIds(), [id(611)]);
  console.log(
    "PASS inventory lots: authenticated list, totals, direct reads, expiry and unit history respect branch exceptions.",
  );
  const { verifyInventoryDocumentReads } = await import(
    "./staff-access-tests/inventory-documents.mjs"
  );
  await verifyInventoryDocumentReads(db, id);
  const { verifyRelatedInventoryReads } = await import(
    "./staff-access-tests/inventory-related.mjs"
  );
  await verifyRelatedInventoryReads(db, id);
  const { verifyTwoBranchInventoryReads } = await import(
    "./staff-access-tests/inventory-two-branch.mjs"
  );
  await verifyTwoBranchInventoryReads(db, id);
  const { verifyInventoryStockProducts } = await import(
    "./staff-access-tests/inventory-stock-products.mjs"
  );
  await verifyInventoryStockProducts(db, id);
} finally {
  await db.close();
}
