import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { functionFromMigration } from "./inventory.mjs";

export async function verifyInventoryCatalogScope(db, id, catalog) {
  await db.exec(`
    alter table profiles add column is_active boolean default true, add column role text default 'staff';
    create table user_permission_overrides(tenant_id uuid,user_id uuid,permission_code text,override_type text);
    create table user_branch_permission_overrides(tenant_id uuid,user_id uuid,branch_id uuid,permission_code text,override_type text);
    create function public.user_has_branch_access(uuid,uuid) returns boolean
    language sql stable set search_path=public as $$
      select exists(select 1 from branch_access a where a.user_id=$1 and a.branch_id=$2)
    $$;
    insert into branch_access values ('${id(1)}','${id(101)}');
    select set_config('request.jwt.claim.sub','${id(1)}',false);
  `);
  for (const [file, name] of [
    ["20261111052704_staff_branch_access.sql", "user_has_permission_at_branch"],
    [
      "20261111070229_staff_branch_checkout_permissions.sql",
      "_staff_permission_at_scope",
    ],
    [
      "20261111095224_staff_branch_kitchen_permissions.sql",
      "_staff_permission_any_branch",
    ],
    [
      "20261112011209_staff_branch_inventory_lot_read.sql",
      "_staff_my_inventory_view",
    ],
  ])
    await db.exec(await functionFromMigration(file, name));
  await db.exec(
    "revoke all on function public._staff_my_inventory_view(uuid) from public,anon; grant execute on function public._staff_my_inventory_view(uuid) to authenticated;",
  );

  const names = [
    "get_inventory_catalog_00573",
    "get_inventory_catalog_filtered",
  ];
  if (process.env.ONEBIZ_INVENTORY_CATALOG_AUDIT_FILE) {
    const definitions = JSON.parse(
      await readFile(process.env.ONEBIZ_INVENTORY_CATALOG_AUDIT_FILE, "utf8"),
    );
    for (const name of names) {
      const match = definitions.find((entry) => entry.proname === name);
      assert.ok(match, name);
      await db.exec(match.definition);
    }
  }
  await db.exec(
    await readFile(
      new URL(
        "../../supabase/migrations/20261112011521_staff_branch_inventory_catalog_read.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const oldCatalog = async () =>
    (await db.query("select get_inventory_catalog_00573(p_limit=>100) result"))
      .rows[0].result;
  await db.exec("set role authenticated");
  assert.ok((await catalog()).rows.some((row) => row.branch_id === id(101)));
  await db.exec(`reset role;
    insert into user_branch_permission_overrides values ('${id(10)}','${id(1)}','${id(101)}','inventory.view','revoke');
    set role authenticated;`);
  for (const read of [catalog, oldCatalog]) {
    const result = await read();
    assert.ok(result.rows.length > 0);
    assert.ok(result.rows.every((row) => row.branch_id === id(100)));
    assert.ok(result.total_value < 9000);
  }
  await assert.rejects(
    catalog({ branch: id(101) }),
    /INVENTORY_CATALOG_ACCESS_DENIED/,
  );
  await db.exec(`reset role;
    update profiles set inventory_access=false where id='${id(1)}';
    update user_branch_permission_overrides set override_type='grant';
    set role authenticated;`);
  for (const read of [catalog, oldCatalog]) {
    const result = await read();
    assert.ok(result.rows.length > 0);
    assert.ok(result.rows.every((row) => row.branch_id === id(101)));
    assert.equal(result.total_value, 9000);
  }
  console.log(
    "PASS inventory catalog: local-only grants and denials constrain balances, zero rows and stock value totals.",
  );
}
