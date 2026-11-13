import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { functionFromMigration } from "./inventory.mjs";

export async function verifyInventoryReferences(db, id) {
  await db.exec(`reset role;
    create function public.ops_q_can(uuid,text) returns boolean language sql stable as $$select true$$;
    delete from user_branch_permission_overrides where permission_code='inventory.view';
    delete from role_permissions where permission_code in ('inventory.view','products.view');
    insert into role_permissions values ('${id(20)}','inventory.view'),('${id(20)}','products.view');
  `);
  let source = await functionFromMigration(
    "00551_operations_complete_workflows.sql",
    "ops_q_reference_rows",
  );
  if (process.env.ONEBIZ_INVENTORY_LOT_AUDIT_FILE) {
    const definitions = JSON.parse(
      await readFile(process.env.ONEBIZ_INVENTORY_LOT_AUDIT_FILE, "utf8"),
    );
    source = definitions.find(
      (entry) => entry.proname === "ops_q_reference_rows",
    )?.definition;
    assert.ok(source);
  }
  await db.exec(source);
  await db.exec(
    await readFile(
      new URL(
        "../../supabase/migrations/20261112033422_staff_branch_inventory_reference_rows.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const read = async (branch, type) =>
    (
      await db.query("select ops_q_reference_rows($1,$2,'') result", [
        id(branch),
        type,
      ])
    ).rows[0].result;
  assert.equal((await read(10, "lot")).length, 1);
  assert.equal((await read(11, "lot")).length, 1);
  await db.exec(`insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
    values ('${id(1)}','${id(101)}','${id(10)}','inventory.view','revoke','${id(100)}');`);
  await assert.rejects(read(10, "lot"), /OPS_FORBIDDEN/);
  assert.equal((await read(11, "lot")).length, 1);
  assert.equal((await read(10, "product")).length, 1);
  await db.exec(`delete from role_permissions where permission_code='inventory.view';
    update user_branch_permission_overrides set branch_id='${id(11)}',override_type='grant' where permission_code='inventory.view';`);
  assert.equal((await read(11, "lot")).length, 1);
  await assert.rejects(read(10, "lot"), /OPS_FORBIDDEN/);
  await assert.rejects(read(12, "lot"), /OPS_FORBIDDEN/);
  console.log(
    "PASS operations references: lot scope and independent global product permission.",
  );
}
