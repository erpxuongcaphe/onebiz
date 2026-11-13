import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { functionFromMigration } from "./inventory.mjs";

export async function verifyBranchMerge(db, id, takeaway) {
  await db.exec(`alter table profiles add column role text default 'staff';
create table staff_branch_permission_catalog(permission_code text primary key,enforcement_version integer);
create table user_permission_overrides(tenant_id uuid,user_id uuid,permission_code text,override_type text);
create table user_branch_permission_overrides(tenant_id uuid,user_id uuid,branch_id uuid,permission_code text,override_type text);
create function get_user_tenant_id() returns uuid language sql stable as $$select tenant_id from profiles where id=auth.uid()$$;
-- Minimal additive-bootstrap contract; full bootstrap is covered by profile tests.
create function get_my_auth_bootstrap() returns jsonb language sql stable as $$select jsonb_build_object('legacyPermissionDenials',coalesce((select jsonb_agg(o.permission_code) from user_permission_overrides o where o.user_id=auth.uid() and o.permission_code in ('pos_fnb.cancel_unpaid_order','pos_fnb.void_paid_bill') and o.override_type='revoke'),'[]'::jsonb))$$;
insert into branches(id,tenant_id) values('${id(13)}','${id(2)}');
create or replace function user_has_branch_access(uuid,uuid) returns boolean language sql stable as $$select $2 in ('${id(3)}'::uuid,'${id(13)}'::uuid)$$;`);
  for (const [file, name] of [
    ["20261111052704_staff_branch_access.sql", "user_has_permission_at_branch"],
    [
      "20261111070229_staff_branch_checkout_permissions.sql",
      "_staff_permission_at_scope",
    ],
  ])
    await db.exec(await functionFromMigration(file, name));
  if (process.env.ONEBIZ_MERGE_AUDIT_FILE) {
    const defs = JSON.parse(
      await readFile(process.env.ONEBIZ_MERGE_AUDIT_FILE, "utf8"),
    ).filter((f) => f.proname === "merge_kitchen_orders_atomic");
    assert.equal(defs.length, 1);
    await db.exec(defs[0].definition + ";");
  }
  await db.exec(
    await readFile(
      new URL(
        "../../supabase/migrations/20261111121818_staff_branch_merge_permissions.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(`set test.merge='false';set test.manage='true';
insert into user_branch_permission_overrides values('${id(2)}','${id(1)}','${id(3)}','pos_fnb.merge_bills','revoke'),('${id(2)}','${id(1)}','${id(13)}','pos_fnb.merge_bills','grant');`);
  const blockedTarget = await takeaway("scoped-block-target"),
    blockedSource = await takeaway("scoped-block-source");
  const state = async () =>
    JSON.stringify(
      (
        await db.query(
          `select (select jsonb_agg(o order by id) from kitchen_orders o) orders,(select jsonb_agg(i order by id) from kitchen_order_items i) items,(select count(*) from audit_log) audits`,
        )
      ).rows[0],
    );
  const before = await state();
  await assert.rejects(
    db.query("select merge_kitchen_orders_atomic($1,$2)", [
      blockedTarget,
      [blockedSource],
    ]),
    /PERMISSION_REQUIRED/,
  );
  assert.equal(
    await state(),
    before,
    "local merge denial defeats legacy table-manager access without changing bills",
  );
  const allowedTarget = await takeaway("scoped-allow-target"),
    allowedSource = await takeaway("scoped-allow-source");
  for (const table of ["kitchen_orders", "fnb_kitchen_item_batches"])
    await db.query(
      `update ${table} set branch_id=$1 where ${table === "kitchen_orders" ? "id" : "kitchen_order_id"}=any($2::uuid[])`,
      [id(13), [allowedTarget, allowedSource]],
    );
  await db.exec("set test.manage='false'");
  await assert.rejects(
    db.query("select merge_kitchen_orders_atomic($1,$2)", [
      allowedTarget,
      [blockedSource],
    ]),
    /SOURCE_NOT_ELIGIBLE/,
  );
  await db.query("select merge_kitchen_orders_atomic($1,$2)", [
    allowedTarget,
    [allowedSource],
  ]);
  assert.equal(
    (
      await db.query("select merged_into_id from kitchen_orders where id=$1", [
        allowedSource,
      ])
    ).rows[0].merged_into_id,
    allowedTarget,
  );
  await db.exec(
    `insert into user_permission_overrides values('${id(2)}','${id(1)}','pos_fnb.merge_bills','revoke');set test.manage='true';`,
  );
  await assert.rejects(
    db.query("select merge_kitchen_orders_atomic($1,$2)", [
      allowedTarget,
      [blockedSource],
    ]),
    /PERMISSION_REQUIRED/,
  );
  assert.deepEqual(
    (await db.query("select get_my_auth_bootstrap() result")).rows[0].result
      .legacyPermissionDenials,
    ["pos_fnb.merge_bills"],
  );
  await db.exec(
    `delete from user_permission_overrides;delete from user_branch_permission_overrides where branch_id='${id(3)}';`,
  );
  await db.query("select merge_kitchen_orders_atomic($1,$2)", [
    blockedTarget,
    [blockedSource],
  ]);
  assert.equal(
    (
      await db.query("select merged_into_id from kitchen_orders where id=$1", [
        blockedSource,
      ])
    ).rows[0].merged_into_id,
    blockedTarget,
    "legacy manager behavior is retained without a local exception",
  );
  console.log(
    "PASS: actual merge local deny/legacy alias, local-only grant, cross-branch source denial, global deny, bootstrap and unchanged legacy behavior.",
  );
}
