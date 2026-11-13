import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { functionFromMigration } from "./inventory.mjs";
export async function verifyAdjustmentPosting(db, { id, call, balance }) {
  await db.exec(`alter table profiles add column role text default 'staff';
 create table user_permission_overrides(tenant_id uuid,user_id uuid,permission_code text,override_type text);
 create table user_branch_permission_overrides(tenant_id uuid,user_id uuid,branch_id uuid,permission_code text,override_type text);
 create function get_user_tenant_id() returns uuid language sql stable as $$select tenant_id from profiles where id=auth.uid()$$;`);
  for (const [file, name] of [
    ["20261111052704_staff_branch_access.sql", "user_has_permission_at_branch"],
    [
      "20261111070229_staff_branch_checkout_permissions.sql",
      "_staff_permission_at_scope",
    ],
  ])
    await db.exec(await functionFromMigration(file, name));
  // Prepare the manual dispatcher as after the preceding disposal/internal patches.
  let manual = await functionFromMigration(
    "00246_harden_stock_document_rpcs.sql",
    "apply_manual_stock_movement_atomic",
  );
  manual = manual
    .replace(
      "public.apply_manual_stock_movement_atomic(",
      "public._apply_manual_stock_movement_auth_impl_00246(",
    )
    .replace(
      "public.user_has_permission(v_actor, v_permission)",
      "(case when v_permission in ('inventory.dispose','inventory.internal_export') then public._staff_permission_at_scope(v_actor,v_permission,p_branch_id) else public.user_has_permission(v_actor,v_permission) end)",
    );
  await db.exec(manual);
  const sql = await readFile(
    new URL(
      "../../supabase/migrations/20261111135753_staff_branch_adjustment_permissions.sql",
      import.meta.url,
    ),
    "utf8",
  );
  let block = sql.slice(
    sql.indexOf("do $migration$"),
    sql.indexOf("insert into public.staff_branch_permission_catalog"),
  );
  block = block.replace(
    ") entries(signature,branch_expression) loop",
    ") entries(signature,branch_expression) where signature='public.adjust_stock_to_value_atomic(uuid,uuid,uuid,numeric,numeric,text)' loop",
  );
  await db.exec(block);
  await db.exec(
    `insert into user_branch_permission_overrides values('${id(10)}','${id(1)}','${id(20)}','inventory.adjust','revoke');`,
  );
  const before = (await db.query("select count(*)::int n from stock_movements"))
    .rows[0].n;
  await assert.rejects(
    call({ request: id(100), expected: 12, target: 14 }),
    /STOCK_TARGET_DENIED/,
  );
  assert.equal(await balance(), 12);
  assert.equal(
    (await db.query("select count(*)::int n from stock_movements")).rows[0].n,
    before,
  );
  await db.exec(
    `update user_branch_permission_overrides set override_type='grant'; create or replace function user_has_permission(uuid,text) returns boolean language sql as $$select $2<>'inventory.adjust'$$;`,
  );
  await call({ request: id(100), expected: 12, target: 14 });
  assert.equal(await balance(), 14);
  assert.equal(
    (await db.query("select count(*)::int n from stock_movements")).rows[0].n,
    before + 1,
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from fixture_cost_events where source_reference_id=$1",
        [id(100)],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (await call({ request: id(100), expected: 12, target: 14 })).rows[0].result
      .idempotent,
    true,
  );
  assert.equal(await balance(), 14);
  await db.exec(
    `insert into user_permission_overrides values('${id(10)}','${id(1)}','inventory.adjust','revoke');`,
  );
  await assert.rejects(
    call({ request: id(101), expected: 14, target: 10 }),
    /STOCK_TARGET_DENIED/,
  );
  assert.equal(await balance(), 14);
  assert.equal(
    (await db.query("select total=42000 and paid=42000 ok from invoices"))
      .rows[0].ok,
    true,
  );
  console.log(
    "PASS: local adjustment grant runs actual mutation core and one cost event; denial has no stock effects, replay is idempotent and sales money remains unchanged.",
  );
}
