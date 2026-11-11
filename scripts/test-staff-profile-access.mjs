// Isolated PostgreSQL/WASM; never connects to production.
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const { PGlite } = await import(
  process.env.ONEBIZ_PGLITE_MODULE
    ? pathToFileURL(process.env.ONEBIZ_PGLITE_MODULE).href
    : "@electric-sql/pglite"
);
const db = new PGlite();
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
let checks = 0;
function check(actual, expected, label) {
  assert.deepEqual(actual, expected, label);
  checks++;
}
try {
  const { initializeStaffAccessFixture } = await import(
    "./staff-access-tests/fixture.mjs"
  );
  await initializeStaffAccessFixture(db, id);
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/20261111052704_staff_branch_access.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const actor = async (n) =>
    db.query("select set_config('request.jwt.claim.sub',$1,false)", [id(n)]);
  const snapshot = async () =>
    (await db.query("select get_staff_profile_access($1) value", [id(101)]))
      .rows[0].value;
  const draft = (s) =>
    structuredClone({
      roleId: s.user.roleId,
      branchIds: s.user.branchIds,
      assignments: s.hierarchy.document.assignments.filter(
        (a) => a.userId === id(101),
      ),
      exceptions: s.exceptions,
    });
  const save = async (s, d) =>
    (
      await db.query("select save_staff_profile_access($1,$2,$3) value", [
        id(101),
        s.fingerprint,
        d,
      ])
    ).rows[0].value;
  const rejects = async (fn, pattern) => {
    await assert.rejects(fn, pattern);
    checks++;
  };
  await actor(100);
  await db.exec(`update branches set is_active=false where id='${id(10)}';
    insert into user_branches(user_id,branch_id,granted_by) values('${id(101)}','${id(10)}','${id(101)}');`);
  let s = await snapshot();
  check(s.exceptions.length, 1, "old exceptions readable");
  let d = draft(s);
  d.branchIds.push(id(11));
  d.exceptions.push({
    branchId: id(10),
    permissionCode: "pos_fnb.split_bill",
    choice: "revoke",
  });
  s = await save(s, d);
  check(s.user.branchIds.length, 2, "branches and exception saved atomically");
  check(
    (
      await db.query(
        `select granted_by from user_branches where user_id='${id(101)}' and branch_id='${id(10)}'`,
      )
    ).rows[0].granted_by,
    id(101),
    "retained inactive membership keeps original grant author",
  );
  check(
    (
      await db.query(
        `select granted_by from user_branches where user_id='${id(101)}' and branch_id='${id(11)}'`,
      )
    ).rows[0].granted_by,
    id(100),
    "new active membership records current owner",
  );
  await db.query("update branches set is_active=true where id=$1", [id(10)]);
  check(s.exceptions.length, 2, "global deny preserved");
  check(
    (await db.query("select note from user_permission_overrides")).rows[0].note,
    "Keep original note",
    "legacy metadata preserved",
  );
  await db.query("update profiles set branch_id=$1 where id=$2", [
    id(11),
    id(101),
  ]);
  s = await snapshot();
  const same = draft(s);
  s = await save(s, same);
  check(
    (await db.query("select branch_id from profiles where id=$1", [id(101)]))
      .rows[0].branch_id,
    id(11),
    "saving exceptions never reorders primary branch",
  );
  await actor(101);
  check(
    (
      await db.query(
        "select split_kitchen_order_atomic($1,null,null,null) allowed",
        [id(30)],
      )
    ).rows[0].allowed,
    false,
    "actual Premium consumer denies",
  );
  check(
    (
      await db.query(
        "select split_kitchen_order_atomic($1,null,null,null) allowed",
        [id(31)],
      )
    ).rows[0].allowed,
    true,
    "actual other branch consumer allowed",
  );
  check(
    (
      await db.query(
        "select split_kitchen_order_quantities_20261020($1,null,null) allowed",
        [id(30)],
      )
    ).rows[0].allowed,
    false,
    "quantity split path denies too",
  );
  check(
    (
      await db.query(
        "select split_kitchen_order_atomic($1,null,null,null) allowed",
        [id(32)],
      )
    ).rows[0].allowed,
    false,
    "cross tenant document denied",
  );
  await rejects(snapshot(), /OWNER_REQUIRED/);
  await rejects(save(s, d), /OWNER_REQUIRED/);
  await actor(100);
  const previous = s;
  d = draft(s);
  d.exceptions.push({
    branchId: id(11),
    permissionCode: "pos_fnb.transfer_table",
    choice: "grant",
  });
  s = await save(s, d);
  await rejects(save(previous, d), /STAFF_PROFILE_STALE/);
  await actor(101);
  check(
    (
      await db.query(
        "select fnb_transfer_table_atomic(null,$1,null,null) allowed",
        [id(31)],
      )
    ).rows[0].allowed,
    true,
    "branch grant works through actual consumer",
  );
  check(
    (
      await db.query(
        "select fnb_transfer_table_atomic(null,$1,null,null) allowed",
        [id(30)],
      )
    ).rows[0].allowed,
    false,
    "grant does not leak",
  );
  check(
    (
      await db.query(
        "select user_has_permission($1,'pos_fnb.transfer_table') allowed",
        [id(101)],
      )
    ).rows[0].allowed,
    false,
    "global permission stays unchanged",
  );
  const boot = (await db.query("select get_my_auth_bootstrap() value")).rows[0]
    .value;
  check(
    boot.branchPermissionAdjustments.length,
    2,
    "bootstrap includes resolved branch adjustments",
  );
  await actor(100);
  d = draft(s);
  d.branchIds = [id(10)];
  d.exceptions.push({
    branchId: id(10),
    permissionCode: "inventory.check",
    choice: "grant",
  });
  await rejects(save(s, d), /BRANCH_PERMISSION_UNSUPPORTED/);
  check(
    (await snapshot()).fingerprint,
    s.fingerprint,
    "failed save rolls back every field",
  );
  d = draft(s);
  d.branchIds = [id(12)];
  await rejects(save(s, d), /STAFF_BRANCH_INVALID/);
  d = draft(s);
  d.exceptions.push(d.exceptions[0]);
  await rejects(save(s, d), /STAFF_EXCEPTION_DUPLICATE/);
  d = draft(s);
  d.assignments = [
    {
      userId: id(102),
      positionId: "staff",
      departmentId: null,
      managedBranchIds: [],
    },
  ];
  await rejects(save(s, d), /STAFF_ASSIGNMENT_INVALID/);
  d = draft(s);
  d.exceptions = d.exceptions.filter((e) => e.branchId !== id(10));
  s = await save(s, d);
  await actor(101);
  check(
    (
      await db.query(
        "select split_kitchen_order_atomic($1,null,null,null) allowed",
        [id(30)],
      )
    ).rows[0].allowed,
    true,
    "inherit resets to exact original template",
  );
  await actor(100);
  d = draft(s);
  d.exceptions.push({
    branchId: null,
    permissionCode: "pos_fnb.transfer_table",
    choice: "revoke",
  });
  s = await save(s, d);
  await actor(101);
  check(
    (
      await db.query(
        "select fnb_transfer_table_atomic(null,$1,null,null) allowed",
        [id(31)],
      )
    ).rows[0].allowed,
    false,
    "global deny wins local grant",
  );
  await actor(100);
  d = draft(s);
  d.branchIds = [id(10)];
  s = await save(s, d);
  check(
    s.exceptions.some((e) => e.branchId === id(11)),
    true,
    "removed branch exception retained dormant",
  );
  await actor(101);
  check(
    (
      await db.query(
        "select user_has_permission_at_branch($1,'pos_fnb.transfer_table',$2) allowed",
        [id(101), id(11)],
      )
    ).rows[0].allowed,
    false,
    "removed branch cannot be used",
  );
  await actor(100);
  check(
    (
      await db.query(
        "select has_table_privilege('authenticated','user_branch_permission_overrides','INSERT') allowed",
      )
    ).rows[0].allowed,
    false,
    "no direct exception writes",
  );
  check(
    (
      await db.query(
        "select has_function_privilege('anon','save_staff_profile_access(uuid,text,jsonb)','execute') allowed",
      )
    ).rows[0].allowed,
    false,
    "anonymous save denied",
  );
  const { verifyInventoryBranchPermissions } = await import(
    "./staff-access-tests/inventory.mjs"
  );
  check(
    (
      await db.query(
        "select has_function_privilege('authenticated','user_has_permission_at_branch(uuid,text,uuid)','execute') allowed",
      )
    ).rows[0].allowed,
    false,
    "internal resolver cannot expose arbitrary staff permissions",
  );
  await db.exec("set role authenticated");
  check(
    (await db.query("select get_staff_profile_access($1) snapshot", [id(101)]))
      .rows[0].snapshot.user.id,
    id(101),
    "secured owner snapshot still works with the browser database role",
  );
  await db.exec("reset role");
  await verifyInventoryBranchPermissions(db, { id, actor, check, rejects });
  const { verifyProductionBranchPermissions } = await import(
    "./staff-access-tests/production.mjs"
  );
  await verifyProductionBranchPermissions(db, { id, actor, check, rejects });
  const { verifyFnbBranchPermissions } = await import(
    "./staff-access-tests/fnb.mjs"
  );
  await verifyFnbBranchPermissions(db, { id, actor, check, rejects });
  const { verifyHierarchyIntegration } = await import(
    "./staff-access-tests/hierarchy.mjs"
  );
  await verifyHierarchyIntegration(db, { id, actor, check, rejects });
  console.log(`PASS ${checks} staff profile PostgreSQL checks`);
} catch (error) {
  console.error(error.message, error.where);
  process.exitCode = 1;
} finally {
  await db.close();
}
