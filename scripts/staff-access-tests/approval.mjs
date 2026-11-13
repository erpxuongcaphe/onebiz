import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { functionFromMigration } from "./inventory.mjs";
export async function verifyApprovalScope(db, { id, actor, call }) {
  if (process.env.ONEBIZ_APPROVAL_AUDIT_FILE) {
    const actual = JSON.parse(
      await readFile(process.env.ONEBIZ_APPROVAL_AUDIT_FILE, "utf8"),
    );
    for (const name of [
      "pending_manager_approvals_00566",
      "manager_approval_history_00566",
      "get_manager_approval_00566",
      "reject_manager_approval_00566",
      "issue_manager_approval_otp_00566",
      "verify_and_use_manager_otp",
      "verify_otp_authorization",
    ]) {
      const f = actual.find((x) => x.proname === name);
      assert.ok(f, name);
      await db.exec(f.definition);
    }
  }
  if (process.env.ONEBIZ_LEGACY_OTP_AUDIT_FILE) {
    const definitions = JSON.parse(
      await readFile(process.env.ONEBIZ_LEGACY_OTP_AUDIT_FILE, "utf8"),
    );
    const current = definitions.find(
      (entry) => entry.proname === "_verify_and_use_manager_otp_before_00566",
    );
    assert.ok(current);
    await db.exec(current.definition);
  }
  await db.exec(`create role service_role;
 alter function user_has_permission(uuid,text) set search_path=public;
 alter function user_has_branch_access(uuid,uuid) set search_path=public;
 create table user_permission_overrides(tenant_id uuid,user_id uuid,permission_code text,override_type text);
 create table user_branch_permission_overrides(tenant_id uuid,user_id uuid,branch_id uuid,permission_code text,override_type text);
 create table staff_branch_permission_catalog(permission_code text primary key,enforcement_version integer);
 insert into branch_grants values('${id(1)}','${id(11)}'),('${id(2)}','${id(11)}');
 delete from manager_approval_requests; delete from manager_otp_codes;
 insert into user_branch_permission_overrides values('${id(100)}','${id(1)}','${id(10)}','pos_fnb.discount','revoke'),('${id(100)}','${id(1)}','${id(11)}','pos_fnb.discount','grant');`);
  for (const [file, name] of [
    ["20261111052704_staff_branch_access.sql", "user_has_permission_at_branch"],
    [
      "20261111070229_staff_branch_checkout_permissions.sql",
      "_staff_permission_at_scope",
    ],
  ])
    await db.exec(await functionFromMigration(file, name));
  // Reproduce the already-tested issuance prerequisites from the cancellation migration.
  for (const name of ["issue_manager_otp", "_issue_manager_otp_before_00566"]) {
    const defs = (
      await db.query(
        "select pg_get_functiondef(oid) d from pg_proc where pronamespace='public'::regnamespace and proname=$1",
        [name],
      )
    ).rows;
    for (const { d } of defs)
      await db.exec(
        d
          .replaceAll(
            "user_has_permission(a,_manager_approval_permission_00566(r.action_code))",
            "_staff_permission_at_scope(a,_manager_approval_permission_00566(r.action_code),r.branch_id)",
          )
          .replaceAll(
            "user_has_permission(v_actor, v_required_perm)",
            "_staff_permission_at_scope(v_actor,v_required_perm,coalesce(p_branch_id,v_profile.branch_id))",
          ),
      );
  }
  await db.exec(
    await readFile(
      new URL(
        "../../supabase/migrations/20261111150452_staff_branch_approval_consumption.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      new URL(
        "../../supabase/migrations/20261112034850_staff_branch_retail_discount_catalog.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  for (const n of [10, 11])
    await db.query(
      `insert into manager_approval_requests(id,tenant_id,branch_id,action_code,requested_by,reason,summary,payload) values($1,$2,$3,'fnb.discount_override',$4,'Test reason','Test','{"amount":100}')`,
      [id(n + 800), id(100), id(n), id(2)],
    );
  await actor(1);
  assert.deepEqual(
    (await call("select pending_manager_approvals_00566() v")).map((x) => x.id),
    [id(811)],
  );
  assert.deepEqual(
    (await call("select manager_approval_history_00566() v")).map((x) => x.id),
    [id(811)],
  );
  for (const sql of [
    "select get_manager_approval_00566($1) v",
    "select reject_manager_approval_00566($1,'Test reason') v",
    "select issue_manager_approval_otp_00566($1) v",
  ])
    await assert.rejects(call(sql, [id(810)]), /PERMISSION_DENIED/);
  await db.exec(
    "delete from grants where actor='" +
      id(1) +
      "' and permission='pos_fnb.discount'",
  );
  const issued = await call("select issue_manager_approval_otp_00566($1) v", [
    id(811),
  ]);
  await actor(2);
  await db.exec(
    "update user_branch_permission_overrides set override_type='revoke' where branch_id='" +
      id(11) +
      "'",
  );
  await assert.rejects(
    call("select verify_and_use_manager_otp($1,'fnb.discount_override',$2) v", [
      issued.code,
      { approval_request_id: id(811) },
    ]),
    /APPROVER_SCOPE_DENIED/,
  );
  assert.equal(
    await call("select used_at v from manager_otp_codes where id=$1", [
      issued.otp_id,
    ]),
    null,
  );
  await db.exec(
    "update user_branch_permission_overrides set override_type='grant' where branch_id='" +
      id(11) +
      "'",
  );
  await call(
    "select verify_and_use_manager_otp($1,'fnb.discount_override',$2) v",
    [issued.code, { approval_request_id: id(811) }],
  );
  await db.exec(
    "update user_branch_permission_overrides set override_type='revoke' where branch_id='" +
      id(11) +
      "'",
  );
  await assert.rejects(
    call(
      "select verify_otp_authorization($1,'fnb.discount_override',$2,null) v",
      [issued.otp_id, id(2)],
    ),
    /APPROVER_SCOPE_DENIED/,
  );
  assert.equal(
    await call("select status v from manager_approval_requests where id=$1", [
      id(811),
    ]),
    "authorized",
  );
  await db.exec(
    "update user_branch_permission_overrides set override_type='grant' where branch_id='" +
      id(11) +
      "'",
  );
  await db.query(
    "insert into user_permission_overrides values($1,$2,'pos_fnb.discount','revoke')",
    [id(100), id(1)],
  );
  await assert.rejects(
    call(
      "select verify_otp_authorization($1,'fnb.discount_override',$2,null) v",
      [issued.otp_id, id(2)],
    ),
    /APPROVER_SCOPE_DENIED/,
  );
  await db.exec("delete from user_permission_overrides");
  assert.equal(
    await call(
      "select verify_otp_authorization($1,'fnb.discount_override',$2,null) v",
      [issued.otp_id, id(2)],
    ),
    id(1),
  );
  await assert.rejects(
    call(
      "select verify_otp_authorization($1,'fnb.discount_override',$2,null) v",
      [issued.otp_id, id(2)],
    ),
    /SCOPE_DENIED/,
  );
  // Retail uses the same approval lifecycle, but has a separate permission.
  await db.exec(`delete from manager_approval_requests; delete from manager_otp_codes;
    delete from grants where actor='${id(1)}' and permission='pos_retail.discount';
    delete from user_branch_permission_overrides;
    insert into user_branch_permission_overrides values
      ('${id(100)}','${id(1)}','${id(10)}','pos_retail.discount','revoke'),
      ('${id(100)}','${id(1)}','${id(11)}','pos_retail.discount','grant');
    insert into manager_approval_requests(id,tenant_id,branch_id,action_code,requested_by,reason,summary,payload)
      values ('${id(820)}','${id(100)}','${id(10)}','pos_retail.discount_override','${id(2)}','Test reason','Test','{"amount":100}'),
             ('${id(821)}','${id(100)}','${id(11)}','pos_retail.discount_override','${id(2)}','Test reason','Test','{"amount":100}');`);
  await actor(1);
  assert.deepEqual(
    (await call("select pending_manager_approvals_00566() v")).map((x) => x.id),
    [id(821)],
  );
  await assert.rejects(
    call("select issue_manager_approval_otp_00566($1) v", [id(820)]),
    /PERMISSION_DENIED/,
  );
  const retail = await call("select issue_manager_approval_otp_00566($1) v", [
    id(821),
  ]);
  await actor(2);
  await db.exec(
    `update user_branch_permission_overrides set override_type='revoke' where permission_code='pos_retail.discount' and branch_id='${id(11)}';`,
  );
  await assert.rejects(
    call(
      "select verify_and_use_manager_otp($1,'pos_retail.discount_override',$2) v",
      [retail.code, { approval_request_id: id(821) }],
    ),
    /APPROVER_SCOPE_DENIED/,
  );
  await db.exec(
    `update user_branch_permission_overrides set override_type='grant' where permission_code='pos_retail.discount' and branch_id='${id(11)}';`,
  );
  await call(
    "select verify_and_use_manager_otp($1,'pos_retail.discount_override',$2) v",
    [retail.code, { approval_request_id: id(821) }],
  );
  assert.equal(
    await call(
      "select verify_otp_authorization($1,'pos_retail.discount_override',$2,null) v",
      [retail.otp_id, id(2)],
    ),
    id(1),
  );
  await assert.rejects(
    call(
      "select verify_otp_authorization($1,'pos_retail.discount_override',$2,null) v",
      [retail.otp_id, id(2)],
    ),
    /SCOPE_DENIED/,
  );
  await actor(1);
  await db.exec(`insert into grants values ('${id(1)}','pos_fnb.cancel_unpaid_order');
    insert into user_branch_permission_overrides values ('${id(100)}','${id(1)}','${id(11)}','pos_fnb.cancel_unpaid_order','grant');`);
  const legacy = await call(
    "select _issue_manager_otp_before_00566('fnb.cancel_unpaid_bill','{}',$1,null::text,null::text) v",
    [id(11)],
  );
  await db.exec(
    `update user_branch_permission_overrides set override_type='revoke' where permission_code='pos_fnb.cancel_unpaid_order';`,
  );
  await actor(2);
  await assert.rejects(
    call(
      "select verify_and_use_manager_otp($1,'fnb.cancel_unpaid_bill','{}') v",
      [legacy.code],
    ),
    /APPROVER_SCOPE_DENIED/,
  );
  assert.equal(
    await call("select used_at v from manager_otp_codes where id=$1", [
      legacy.otp_id,
    ]),
    null,
  );
  await db.exec(
    `update user_branch_permission_overrides set override_type='grant' where permission_code='pos_fnb.cancel_unpaid_order';`,
  );
  assert.equal(
    (
      await call(
        "select verify_and_use_manager_otp($1,'fnb.cancel_unpaid_bill','{}') v",
        [legacy.code],
      )
    ).otp_id,
    legacy.otp_id,
  );
  console.log(
    "PASS: all seven approval stages respect persisted branch, local-only manager grant works through issuance/verification/consumption, revocation blocks unused and verified tokens, replay blocked.",
  );
}
