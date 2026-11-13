import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { functionFromMigration } from "./inventory.mjs";

export async function verifyBranchTables(db, id, takeaway) {
  await db.exec(`alter table branches add settings jsonb default '{}',add updated_at timestamptz;
alter table tenants add updated_at timestamptz;
create or replace function user_has_permission(uuid,text) returns boolean language sql stable as $$select case
 when $2='pos_fnb.manage_tables' then current_setting('test.manage',true)='true'
 when $2 in ('system.manage_branches','system.manage_roles') then coalesce(current_setting('test.system',true),'false')='true'
 when $2='pos_fnb.merge_bills' then false else true end$$;`);
  const sources = [
    ["00275_guard_fnb_table_available.sql", "mark_fnb_table_available_atomic"],
    ["00277_atomic_branch_management.sql", "update_branch_settings_atomic"],
    ["00278_atomic_operational_settings.sql", "patch_tenant_settings_atomic"],
  ];
  for (const [file, name] of sources)
    await db.exec(await functionFromMigration(file, name));
  if (process.env.ONEBIZ_TABLE_AUDIT_FILE) {
    const names = sources.map(([, name]) => name);
    const defs = JSON.parse(
      await readFile(process.env.ONEBIZ_TABLE_AUDIT_FILE, "utf8"),
    ).filter((f) => names.includes(f.proname));
    assert.equal(defs.length, 3);
    for (const f of defs) await db.exec(f.definition + ";");
  }
  await db.exec(
    await readFile(
      new URL(
        "../../supabase/migrations/20261111122219_staff_branch_table_permissions.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(`insert into user_branch_permission_overrides values
 ('${id(2)}','${id(1)}','${id(3)}','pos_fnb.manage_tables','revoke'),('${id(2)}','${id(1)}','${id(13)}','pos_fnb.manage_tables','grant');
insert into restaurant_tables(id,tenant_id,branch_id,status,name) values
 ('${id(800)}','${id(2)}','${id(3)}','cleaning','Denied'),('${id(801)}','${id(2)}','${id(13)}','cleaning','Allowed');`);
  await assert.rejects(
    db.query("select mark_fnb_table_available_atomic($1)", [id(800)]),
    /MANAGE_TABLES_PERMISSION_REQUIRED/,
  );
  await assert.rejects(
    db.query(
      'select update_branch_settings_atomic($1,\'{"pos_layout_mode":"manual"}\')',
      [id(3)],
    ),
    /BRANCH_SETTINGS_PERMISSION_REQUIRED/,
  );
  await assert.rejects(
    db.query(
      "select patch_tenant_settings_atomic('fnb_delivery_platforms','{}')",
    ),
    /MANAGE_FNB_SETTINGS_PERMISSION_REQUIRED/,
  );
  await db.exec("set test.manage='false'");
  await db.query("select mark_fnb_table_available_atomic($1)", [id(801)]);
  assert.equal(
    (
      await db.query("select status from restaurant_tables where id=$1", [
        id(801),
      ])
    ).rows[0].status,
    "available",
  );
  await db.query(
    'select update_branch_settings_atomic($1,\'{"pos_layout_mode":"manual"}\')',
    [id(13)],
  );
  assert.equal(
    (await db.query("select settings from branches where id=$1", [id(13)]))
      .rows[0].settings.pos_layout_mode,
    "manual",
  );
  await assert.rejects(
    db.query(
      "select patch_tenant_settings_atomic('fnb_delivery_platforms','{}')",
    ),
    /MANAGE_FNB_SETTINGS_PERMISSION_REQUIRED/,
  );
  // Local table management keeps the existing merge capability at that branch.
  await db.exec(
    "delete from user_branch_permission_overrides where permission_code='pos_fnb.merge_bills'",
  );
  const target = await takeaway("table-scope-merge-target"),
    source = await takeaway("table-scope-merge-source");
  await assert.rejects(
    db.query("select merge_kitchen_orders_atomic($1,$2)", [target, [source]]),
    /PERMISSION_REQUIRED/,
  );
  await db.query(
    "update kitchen_orders set branch_id=$1 where id=any($2::uuid[])",
    [id(13), [target, source]],
  );
  await db.query(
    "update fnb_kitchen_item_batches set branch_id=$1 where kitchen_order_id=any($2::uuid[])",
    [id(13), [target, source]],
  );
  await db.query("select merge_kitchen_orders_atomic($1,$2)", [
    target,
    [source],
  ]);
  assert.equal(
    (
      await db.query("select merged_into_id from kitchen_orders where id=$1", [
        source,
      ])
    ).rows[0].merged_into_id,
    target,
  );
  // Real authenticated RLS evaluation, including the original permissive tenant policy.
  await db.exec(`alter table restaurant_tables enable row level security;
grant usage on schema public,auth to authenticated;
grant select on profiles to authenticated;
grant select,insert,update,delete on restaurant_tables to authenticated;
create policy fixture_tenant_tables on restaurant_tables for all to authenticated using(tenant_id=get_user_tenant_id()) with check(tenant_id=get_user_tenant_id());
update restaurant_tables set status='cleaning' where id='${id(801)}';
set role authenticated;`);
  assert.equal(
    (
      await db.query(
        "update restaurant_tables set status='available' where id=$1 returning id",
        [id(800)],
      )
    ).rows.length,
    0,
  );
  assert.equal(
    (
      await db.query("delete from restaurant_tables where id=$1 returning id", [
        id(800),
      ])
    ).rows.length,
    0,
  );
  await assert.rejects(
    db.query(
      "insert into restaurant_tables(id,tenant_id,branch_id,status) values($1,$2,$3,'available')",
      [id(802), id(2), id(3)],
    ),
    /row-level security/,
  );
  await db.query("select mark_fnb_table_available_atomic($1)", [id(801)]);
  assert.equal(
    (
      await db.query("select status from restaurant_tables where id=$1", [
        id(801),
      ])
    ).rows[0].status,
    "available",
    "guarded RPC still works under authenticated with local grant",
  );
  await db.exec(
    "reset role;delete from user_branch_permission_overrides where permission_code='pos_fnb.manage_tables';set test.manage='true'",
  );
  await db.query(
    "select patch_tenant_settings_atomic('fnb_delivery_platforms','{}')",
  );
  await db.exec("set role authenticated");
  assert.equal(
    (
      await db.query(
        "update restaurant_tables set name='Unchanged legacy access' where id=$1 returning id",
        [id(800)],
      )
    ).rows.length,
    1,
  );
  await db.exec("reset role");
  console.log(
    "PASS: table operations and branch settings scoped; local rights never authorize shared settings; raw writes blocked, authenticated RPC preserved, merge fallback scoped, legacy unchanged.",
  );
}
