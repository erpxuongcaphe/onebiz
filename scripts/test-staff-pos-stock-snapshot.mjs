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
  await db.exec(`create table branch_stock(tenant_id uuid,branch_id uuid,product_id uuid,variant_id uuid,quantity numeric);
  alter function public.get_user_tenant_id() security definer;
  alter table branch_stock enable row level security;
  create policy legacy_stock on branch_stock for select to authenticated using (tenant_id=public.get_user_tenant_id());
  insert into branch_stock values
   ('${id(1)}','${id(10)}','${id(60)}',null,12),('${id(1)}','${id(10)}','${id(61)}',null,7),
   ('${id(1)}','${id(10)}','${id(60)}','${id(80)}',2),('${id(1)}','${id(11)}','${id(60)}',null,20),
   ('${id(2)}','${id(12)}','${id(60)}',null,90);
  select set_config('request.jwt.claim.sub','${id(101)}',false);
  insert into staff_branch_permission_catalog values('inventory.view',1),('pos_retail.checkout',1),('pos_fnb.send_kitchen',1),('pos_fnb.checkout',1);
  grant usage on schema auth,public to authenticated;grant select on branch_stock to authenticated;`);
  await db.exec(await file("20261112081429_staff_pos_stock_snapshot.sql"));
  await db.exec(
    await file("20261112104703_staff_inventory_branch_stock_reads.sql"),
  );
  await db.exec(`create function auth.role() returns text language sql stable as $$select current_setting('test.jwt.role',true)$$;
    select set_config('test.jwt.role','authenticated',false);
    create table products(id uuid primary key,tenant_id uuid,name text);
    create table bom_items(bom_id uuid,material_id uuid,quantity numeric,waste_percent numeric);
    insert into products values ('${id(60)}','${id(1)}','Finished'),('${id(61)}','${id(1)}','Material'),('${id(62)}','${id(2)}','Other');
    insert into bom_items values ('${id(90)}','${id(61)}',2,0);
    create function public.get_active_bom_for_branch(uuid,uuid) returns uuid language sql stable as $$select '${id(90)}'::uuid$$;
    create function public.should_cascade_bom_at_branch(uuid,uuid) returns boolean language sql stable as $$select true$$;`);
  await db.exec(
    await functionFromMigration(
      "00300_optimize_bom_availability_batch.sql",
      "get_bom_availability_batch",
    ),
  );
  await db.exec(await file("20261112083252_staff_bom_availability_scope.sql"));
  await db.exec(await functionFromMigration('20261112121837_staff_inventory_global_revoke_guard.sql','_staff_stock_has_no_view_exception'));
  await db.exec(await file('20261112103125_staff_inventory_product_breakdown_scope.sql'));
  await db.exec(await file('20261112131018_staff_stock_breakdown_global_revoke_guard.sql'));
  await db.exec("set role authenticated");
  const read = async (branch, ids) =>
    (
      await db.query(
        "select * from get_pos_stock_snapshot_scoped($1,$2::uuid[]) order by product_id",
        [id(branch), ids.map(id)],
      )
    ).rows;
  await assert.rejects(read(10,[60]),/POS_STOCK_PERMISSION_DENIED/);
  await db.exec(`reset role; insert into role_permissions values('${id(20)}','inventory.view'); set role authenticated;`);
  assert.deepEqual(await read(10, [60]), [
    { product_id: id(60), quantity: "12" },
  ]);
  const bom = async (tenant, branch, sku) =>
    (
      await db.query(
        "select * from get_bom_availability_batch($1,$2,$3::uuid[])",
        [id(tenant), id(branch), [id(sku)]],
      )
    ).rows;
  assert.equal(
    (await bom(1, 10, 60))[0].available,
    "3",
    "availability math stays unchanged",
  );
  assert.deepEqual(
    await bom(1, 10, 62),
    [],
    "another tenant product is not revealed",
  );
  await assert.rejects(bom(2, 12, 62), /BOM_AVAILABILITY_AUTH_DENIED/);
  await assert.rejects(read(11, [60]), /POS_STOCK_BRANCH_DENIED/);
  await assert.rejects(read(12, [60]), /POS_STOCK_BRANCH_DENIED/);
  await assert.rejects(
    read(10, Array(201).fill(60)),
    /POS_STOCK_INVALID_REQUEST/,
  );
  await db.exec(`reset role; delete from role_permissions where permission_code='inventory.view';
  insert into user_branches values('${id(101)}','${id(11)}',null);
  insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values
   ('${id(1)}','${id(101)}','${id(10)}','inventory.view','revoke','${id(100)}'),
   ('${id(1)}','${id(101)}','${id(10)}','pos_retail.checkout','grant','${id(100)}');
  set role authenticated;`);
  assert.deepEqual(await read(10, [60, 61]), [
    { product_id: id(60), quantity: "12" },
    { product_id: id(61), quantity: "7" },
  ]);
  assert.deepEqual(
    (
      await db.query(
        "select distinct branch_id from branch_stock order by branch_id",
      )
    ).rows.map((r) => r.branch_id),
    [id(10)],
    "checkout can receive stock change events only for its authorized branch",
  );
  assert.equal(
    (await bom(1, 10, 60))[0].available,
    "3",
    "checkout grant retains BOM availability",
  );
  await assert.rejects(read(11, [60]), /POS_STOCK_PERMISSION_DENIED/);
  await db.exec(
    `reset role; update user_branch_permission_overrides set override_type='revoke' where permission_code='pos_retail.checkout'; set role authenticated;`,
  );
  assert.equal(
    (await db.query("select count(*)::int n from branch_stock")).rows[0].n,
    0,
    "revoked checkout cannot receive stock rows or events",
  );
  await assert.rejects(read(10, [60]), /POS_STOCK_PERMISSION_DENIED/);
  await assert.rejects(bom(1, 10, 60), /BOM_AVAILABILITY_PERMISSION_DENIED/);
  await db.exec(`reset role; delete from user_branch_permission_overrides where permission_code in ('inventory.view','pos_retail.checkout');
    insert into role_permissions values('${id(20)}','inventory.view');
    insert into user_permission_overrides(tenant_id,user_id,permission_code,override_type,created_by)
     values('${id(1)}','${id(101)}','inventory.view','revoke','${id(100)}'); set role authenticated;`);
  await assert.rejects(read(10,[60]),/POS_STOCK_PERMISSION_DENIED/);
  await assert.rejects(bom(1,10,60),/BOM_AVAILABILITY_PERMISSION_DENIED/);
  await db.exec(`reset role; insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
    values('${id(1)}','${id(101)}','${id(10)}','pos_retail.checkout','grant','${id(100)}'); set role authenticated;`);
  assert.equal((await read(10,[60]))[0].quantity,'12','checkout remains available despite global inventory-view revoke');
  assert.equal((await bom(1,10,60))[0].available,'3','checkout retains BOM availability independently');
  for (const code of ['pos_fnb.send_kitchen','pos_fnb.checkout']) {
    await db.exec(`reset role; delete from user_branch_permission_overrides where permission_code in ('pos_retail.checkout','pos_fnb.send_kitchen','pos_fnb.checkout');
      insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
      values('${id(1)}','${id(101)}','${id(10)}','${code}','grant','${id(100)}'); set role authenticated;`);
    assert.equal((await read(10,[60]))[0].quantity,'12',`${code} keeps its stock snapshot`);
    assert.equal((await bom(1,10,60))[0].available,'3',`${code} keeps its BOM snapshot`);
    await assert.rejects(read(11,[60]),/POS_STOCK_PERMISSION_DENIED/);
  }
  await db.exec(
    `reset role; select set_config('request.jwt.claim.sub','',false); select set_config('test.jwt.role','service_role',false); set role service_role;`,
  );
  assert.equal(
    (await bom(1, 10, 60))[0].available,
    "3",
    "trusted service-role workflows retain availability reads",
  );
  console.log(
    "PASS POS stock snapshot: branch boundaries, local POS grant, denied inventory and bounded product projection",
  );
} catch (e) {
  console.error(e.message, e.where ?? "");
  process.exitCode = 1;
} finally {
  await db.close();
}
