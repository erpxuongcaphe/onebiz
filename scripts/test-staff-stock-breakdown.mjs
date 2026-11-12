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
  await db.exec(`alter table branches add column code text;
  update branches set code='TEST';
  insert into branches(id,tenant_id,name,code) values('${id(13)}','${id(1)}','Empty','E');
  create table products(id uuid primary key,tenant_id uuid);
  create table branch_stock(tenant_id uuid,branch_id uuid,product_id uuid,quantity numeric,reserved numeric,updated_at timestamptz);
  alter function public.get_user_tenant_id() security definer;
  alter table branch_stock enable row level security;
  create policy legacy_stock on branch_stock for select to authenticated using (tenant_id=public.get_user_tenant_id());
  insert into products values('${id(60)}','${id(1)}'),('${id(61)}','${id(2)}');
  insert into branch_stock values ('${id(1)}','${id(10)}','${id(60)}',10,2,now()),
   ('${id(1)}','${id(10)}','${id(60)}',5,1,now()),('${id(1)}','${id(11)}','${id(60)}',20,0,now());
  insert into user_branches values('${id(101)}','${id(11)}',null);
  insert into role_permissions values('${id(20)}','inventory.view');
  insert into staff_branch_permission_catalog values('inventory.view',1),('production.view',1);
  grant usage on schema public,auth to authenticated;grant select on branch_stock to authenticated;select set_config('request.jwt.claim.sub','${id(101)}',false);`);
  await db.exec(
    await file("20261112103125_staff_inventory_product_breakdown_scope.sql"),
  );
  await db.exec(
    await file("20261112104703_staff_inventory_branch_stock_reads.sql"),
  );
  await db.exec("set role authenticated");
  const read = async (product = 60) =>
    (
      await db.query(
        "select branch_id,quantity,reserved from get_inventory_product_breakdown_scoped($1) order by branch_id",
        [id(product)],
      )
    ).rows;
  const raw = async () =>
    (
      await db.query(
        "select distinct branch_id from branch_stock order by branch_id",
      )
    ).rows.map((r) => r.branch_id);
  assert.deepEqual(await raw(), [id(10), id(11)]);
  assert.deepEqual(await read(), [
    { branch_id: id(10), quantity: "15", reserved: "3" },
    { branch_id: id(11), quantity: "20", reserved: "0" },
    { branch_id: id(13), quantity: "0", reserved: "0" },
  ]);
  await assert.rejects(read(61), /STOCK_BREAKDOWN_PRODUCT_INVALID/);
  await db.exec(`reset role; insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
  values('${id(1)}','${id(101)}','${id(10)}','inventory.view','revoke','${id(100)}'); set role authenticated;`);
  assert.deepEqual(
    await read(),
    [{ branch_id: id(11), quantity: "20", reserved: "0" }],
    "denied and unassigned branches are omitted, never reported as zero",
  );
  assert.deepEqual(await raw(), [id(11)]);
  await db.exec(
    `reset role; insert into role_permissions values('${id(20)}','production.view'); set role authenticated;`,
  );
  assert.deepEqual(
    await raw(),
    [id(10), id(11)],
    "production dashboard can still read required stock",
  );
  assert.deepEqual(
    await read(),
    [{ branch_id: id(11), quantity: "20", reserved: "0" }],
    "production access does not widen the inventory breakdown",
  );
  await db.exec(`reset role; insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
   values('${id(1)}','${id(101)}','${id(10)}','production.view','revoke','${id(100)}'); set role authenticated;`);
  assert.deepEqual(await raw(), [id(11)], "local production denial is honored");
  await db.exec(
    `reset role; delete from role_permissions where permission_code='production.view'; delete from user_branch_permission_overrides where permission_code='production.view'; set role authenticated;`,
  );
  await db.exec(
    `reset role; insert into role_permissions values('${id(20)}','reports.view_all_branches'); set role authenticated;`,
  );
  assert.deepEqual(
    await read(),
    [
      { branch_id: id(11), quantity: "20", reserved: "0" },
      { branch_id: id(13), quantity: "0", reserved: "0" },
    ],
    "authorized empty branch stays visible",
  );
  await db.exec(`reset role; delete from role_permissions where permission_code in ('inventory.view','reports.view_all_branches');
  update user_branch_permission_overrides set override_type='grant' where permission_code='inventory.view'; set role authenticated;`);
  assert.deepEqual(
    await read(),
    [{ branch_id: id(10), quantity: "15", reserved: "3" }],
    "branch-only grant does not expose other branches",
  );
  assert.deepEqual(
    await raw(),
    [id(10)],
    "branch-only inventory grant keeps raw reads inside the granted branch",
  );
  console.log(
    "PASS stock breakdown: quantities, explicit zero and denied/foreign branches are distinguished",
  );
} catch (e) {
  console.error(e.message, e.where ?? "");
  process.exitCode = 1;
} finally {
  await db.close();
}
