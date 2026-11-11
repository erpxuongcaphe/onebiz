import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { functionFromMigration } from "./inventory.mjs";
export async function verifyPurchasePostingScope(db, { id, save, line }) {
  await db.exec(`alter table profiles add column role text default 'staff';
 create table user_permission_overrides(tenant_id uuid,user_id uuid,permission_code text,override_type text);
 create table user_branch_permission_overrides(tenant_id uuid,user_id uuid,branch_id uuid,permission_code text,override_type text);
 select set_config('test.denied','no',false);`);
  for (const [file, name] of [
    ["20261111052704_staff_branch_access.sql", "user_has_permission_at_branch"],
    [
      "20261111070229_staff_branch_checkout_permissions.sql",
      "_staff_permission_at_scope",
    ],
  ])
    await db.exec(await functionFromMigration(file, name));
  const sql = await readFile(
    new URL(
      "../../supabase/migrations/20261111143617_staff_branch_purchase_permissions.sql",
      import.meta.url,
    ),
    "utf8",
  );
  // Fixture retains the pre-expiry name for the same real replay-safe function.
  // Execute the migration replacement on both installed save-chain consumers.
  let block =
    sql.slice(
      sql.indexOf("do $migration$"),
      sql.indexOf(" target:='public._apply_manual"),
    ) + "end $migration$;";
  block = block
    .replaceAll(
      "_expiry_po_v2_base_00527",
      "save_purchase_order_with_uom_atomic_v2",
    )
    .replace(
      ") entries(signature,branch_expression) loop",
      ") entries(signature,branch_expression) where signature like 'public.save_purchase_order%('||'uuid,text,uuid,uuid,text,numeric,numeric,numeric,numeric,text,boolean,boolean,jsonb)' loop",
    );
  await db.exec(block);
  const snapshot = async () =>
    JSON.stringify(
      (
        await db.query(`select
 (select jsonb_agg(p order by id) from purchase_orders p) orders,
 (select jsonb_agg(i order by id) from purchase_order_items i) items,
 (select count(*) from effects) effects`)
      ).rows[0],
    );
  await db.query(
    "insert into user_branch_permission_overrides values($1,$2,$3,'inventory.create_po','revoke')",
    [id(1), id(2), id(3)],
  );
  const before = await snapshot();
  await assert.rejects(
    save("PO-SCOPED", [line(7, 2, 100)]),
    /INSUFFICIENT_PERMISSION/,
  );
  assert.equal(await snapshot(), before);
  // A local grant works even when the account-wide permission is absent.
  await db.exec(
    "update user_branch_permission_overrides set override_type='grant'; select set_config('test.denied','yes',false)",
  );
  const created = await save("PO-SCOPED", [line(7, 2, 100)]);
  assert.equal(Number(created.total), 200);
  assert.equal(
    (
      await db.query("select branch_id from purchase_orders where id=$1", [
        created.purchase_order_id,
      ])
    ).rows[0].branch_id,
    id(3),
  );
  const after = await snapshot();
  assert.equal((await save("PO-SCOPED", [line(7, 2, 100)])).idempotent, true);
  assert.equal(await snapshot(), after);
  await db.query(
    "insert into user_permission_overrides values($1,$2,'inventory.create_po','revoke')",
    [id(1), id(2)],
  );
  await assert.rejects(
    save("PO-SCOPED-DENIED", [line(7, 2, 100)]),
    /INSUFFICIENT_PERMISSION/,
  );
  assert.equal(await snapshot(), after);
  console.log(
    "PASS purchase scoped save: actual UOM/replay save chain, denial has no effects, local-only grant creates correct branch and total, replay unchanged, global deny wins. Receiving/payment remain explicit baseline mocks.",
  );
}
