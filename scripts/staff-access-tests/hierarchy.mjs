import { functionFromMigration } from "./inventory.mjs";

/** Verify one-save integration with the actual organizational validator/history writer. */
export async function verifyHierarchyIntegration(
  db,
  { id, actor, check, rejects },
) {
  await db.exec(`
    alter table account_hierarchy_config add column updated_by uuid, add column updated_at timestamptz;
    create table account_hierarchy_history(tenant_id uuid,version bigint,changed_by uuid,document jsonb);
    drop function get_account_hierarchy();
    drop function _validate_account_hierarchy(uuid,jsonb);
    drop function save_account_hierarchy(jsonb,bigint,text);
    insert into profiles(id,tenant_id,role,role_id,full_name,branch_id)
      values('${id(103)}','${id(1)}','staff','${id(20)}','Other existing staff','${id(10)}');
  `);
  for (const name of [
    "_account_descendant",
    "_validate_account_hierarchy",
    "get_account_hierarchy",
    "save_account_hierarchy",
  ]) {
    await db.exec(
      await functionFromMigration(
        "20261102044150_scoped_account_management.sql",
        name,
      ),
    );
  }
  const other = {
    userId: id(103),
    positionId: "staff",
    departmentId: "ops",
    managedBranchIds: [],
  };
  const document = {
    positions: [
      {
        id: "manager",
        name: "Manager",
        parentId: null,
        scope: "assigned",
        depth: "all",
        roleId: id(20),
        permissions: { edit: true, create: true, password: true },
      },
      {
        id: "staff",
        name: "Staff",
        parentId: "manager",
        scope: "branch",
        depth: "direct",
        permissions: { edit: false, create: false, password: false },
      },
    ],
    departments: [{ id: "ops", name: "Operations", parentId: null }],
    assignments: [other],
    globalAdminIds: [id(103)],
  };
  await db.query(
    "update account_hierarchy_config set document=$1 where tenant_id=$2",
    [document, id(1)],
  );
  await actor(100);
  const snapshot = async () =>
    (await db.query("select get_staff_profile_access($1) value", [id(101)]))
      .rows[0].value;
  const s = await snapshot();
  const draft = {
    roleId: s.user.roleId,
    branchIds: [id(10), id(11)],
    assignments: [
      {
        userId: id(101),
        positionId: "manager",
        departmentId: "ops",
        managedBranchIds: [id(11)],
      },
    ],
    exceptions: s.exceptions,
  };
  const save = async (state, next) =>
    (
      await db.query("select save_staff_profile_access($1,$2,$3) value", [
        id(101),
        state.fingerprint,
        next,
      ])
    ).rows[0].value;
  const saved = await save(s, draft);
  check(
    saved.hierarchy.document.assignments.find((a) => a.userId === id(103)),
    other,
    "other staff assignment preserved by actual hierarchy writer",
  );
  check(
    saved.hierarchy.document.globalAdminIds,
    [id(103)],
    "existing company-wide managers unchanged",
  );
  check(
    saved.hierarchy.document.assignments.find((a) => a.userId === id(101)),
    draft.assignments[0],
    "position, department and management scope saved together",
  );
  check(
    saved.hierarchy.version,
    s.hierarchy.version + 1,
    "organization version increments once",
  );
  check(
    (
      await db.query(
        "select count(*)::integer n from account_hierarchy_history",
      )
    ).rows[0].n,
    1,
    "actual hierarchy writer records history",
  );
  const bad = structuredClone(draft);
  bad.branchIds = [id(10)];
  // Deliberately leave a management assignment outside selected access.
  await rejects(save(saved, bad), /HIERARCHY_BRANCH_INVALID/);
  check(
    (await snapshot()).fingerprint,
    saved.fingerprint,
    "invalid management scope rolls back membership and all other changes",
  );
  bad.branchIds = draft.branchIds;
  bad.assignments[0].departmentId = "missing";
  await rejects(save(saved, bad), /HIERARCHY_ASSIGNMENT_INVALID/);
  check(
    (
      await db.query(
        "select count(*)::integer n from account_hierarchy_history",
      )
    ).rows[0].n,
    1,
    "failed save creates no organization history",
  );
}
