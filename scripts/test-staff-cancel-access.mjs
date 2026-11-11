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
let checks = 0;
try {
  await initializeStaffAccessFixture(db, id);
  await db.exec(await file("20261111052704_staff_branch_access.sql"));
  await db.exec(
    await functionFromMigration(
      "20261111070229_staff_branch_checkout_permissions.sql",
      "_staff_permission_at_scope",
    ),
  );
  await db.exec(
    await functionFromMigration(
      "20261111095224_staff_branch_kitchen_permissions.sql",
      "_staff_permission_any_branch",
    ),
  );
  await db.exec(`create schema extensions;
 alter table kitchen_orders add column invoice_id uuid,add column table_id uuid,add column order_number text,add column status text default 'pending',add column note text,add column merged_into_id uuid,add column discount_amount numeric default 0;
 create table kitchen_order_items(id uuid,kitchen_order_id uuid,quantity numeric,cancelled_qty numeric default 0,unit_price numeric,toppings jsonb,variant_id uuid,note text);
 create table restaurant_tables(id uuid,tenant_id uuid,name text);
 create table shifts(id uuid,tenant_id uuid,branch_id uuid,cashier_id uuid,status text);
 create table manager_otp_codes(id uuid,tenant_id uuid,branch_id uuid,target_meta jsonb,created_at timestamptz,expires_at timestamptz,used_at timestamptz);
 create table manager_approval_requests(id uuid,tenant_id uuid,branch_id uuid,action_code text,target_id uuid,status text,expires_at timestamptz,otp_id uuid);
 create function verify_otp_authorization(uuid,text,uuid,uuid) returns uuid language sql as $$select '${id(101)}'::uuid$$;
 insert into user_branches(user_id,branch_id) values('${id(101)}','${id(11)}');
 select set_config('request.jwt.claim.sub','${id(101)}',false);`);
  const cancel = await file("00455_fnb_cancel_requests.sql");
  await db.exec(
    cancel.slice(
      cancel.indexOf("create table"),
      cancel.indexOf("create or replace function"),
    ),
  );
  await db.exec(
    `alter table fnb_cancel_requests add column rejected_at timestamptz,add column rejection_reason text,add column rejected_by uuid,add column superseded_at timestamptz;`,
  );
  for (const [migration, name] of [
    ["00455_fnb_cancel_requests.sql", "_fnb_cancel_context_00455"],
    ["00455_fnb_cancel_requests.sql", "fnb_request_cancel_00455"],
    ["00455_fnb_cancel_requests.sql", "fnb_execute_cancel_request_00455"],
    ["00455_fnb_cancel_requests.sql", "fnb_issue_cancel_otp_00455"],
    ["00455_fnb_cancel_requests.sql", "fnb_pending_cancel_requests_00455"],
    ["00462_fnb_cancel_request_review.sql", "fnb_reject_cancel_request_00462"],
    [
      "202610190002_fnb_cancel_approval_timing.sql",
      "_fnb_cancel_status_20261019",
    ],
    [
      "202610190002_fnb_cancel_approval_timing.sql",
      "fnb_cancel_status_20261019",
    ],
    ["00566_manager_approval_requests.sql", "issue_manager_otp"],
    [
      "00566_manager_approval_requests.sql",
      "_manager_approval_permission_00566",
    ],
  ])
    await db.exec(await functionFromMigration(migration, name));
  await db.exec(
    (
      await functionFromMigration(
        "00066_otp_target_binding.sql",
        "fnb_cancel_unpaid_order_atomic",
      )
    ).replace(
      "public.fnb_cancel_unpaid_order_atomic(",
      "public._fnb_cancel_unpaid_order_impl_00066(",
    ),
  );
  for (const migration of [
    "00066_otp_target_binding.sql",
    "00087_issue_otp_resolve_code.sql",
  ])
    await db.exec(
      (await functionFromMigration(migration, "issue_manager_otp")).replace(
        "public.issue_manager_otp(",
        "public._issue_manager_otp_before_00566(",
      ),
    );
  if (process.env.ONEBIZ_CANCEL_AUDIT_FILE) {
    const names = [
      "_fnb_cancel_unpaid_order_impl_00066",
      "fnb_request_cancel_00455",
      "fnb_execute_cancel_request_00455",
      "fnb_issue_cancel_otp_00455",
      "fnb_pending_cancel_requests_00455",
      "fnb_reject_cancel_request_00462",
      "fnb_cancel_status_20261019",
      "issue_manager_otp",
      "_issue_manager_otp_before_00566",
    ];
    const defs = JSON.parse(
      await readFile(process.env.ONEBIZ_CANCEL_AUDIT_FILE, "utf8"),
    ).filter((f) => names.includes(f.proname));
    assert.equal(defs.length, 10);
    for (const f of defs) await db.exec(f.definition + ";");
  }
  await db.exec(
    await file("20261111100912_staff_branch_cancel_permissions.sql"),
  );
  await db.exec(`insert into role_permissions values('${id(20)}','pos_fnb.cancel_unpaid_order'),('${id(20)}','pos_fnb.void');
 insert into fnb_cancel_requests(id,tenant_id,branch_id,kitchen_order_id,requested_by,reason,items,context_hash,whole_bill)
 values ('${id(40)}','${id(1)}','${id(10)}','${id(30)}','${id(100)}','Synthetic cancel','[]',_fnb_cancel_context_00455('${id(30)}'),true),
 ('${id(41)}','${id(1)}','${id(11)}','${id(31)}','${id(100)}','Synthetic cancel','[]',_fnb_cancel_context_00455('${id(31)}'),true);
 insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values
 ('${id(1)}','${id(101)}','${id(10)}','pos_fnb.cancel_unpaid_order','revoke','${id(100)}'),
 ('${id(1)}','${id(101)}','${id(11)}','pos_fnb.cancel_unpaid_order','grant','${id(100)}');`);
  for (const [sql, error] of [
    [
      `select _fnb_cancel_unpaid_order_impl_00066('${id(30)}','Khác')`,
      /PERMISSION_DENIED/,
    ],
    [`select fnb_execute_cancel_request_00455('${id(40)}')`, /OTP_REQUIRED/],
    [
      `select fnb_request_cancel_00455('${id(30)}','[]','Synthetic cancel',true)`,
      /PERMISSION_DENIED/,
    ],
    [`select fnb_issue_cancel_otp_00455('${id(40)}')`, /PERMISSION_DENIED/],
    [
      `select fnb_reject_cancel_request_00462('${id(40)}','Synthetic refusal')`,
      /PERMISSION_DENIED/,
    ],
    [
      `select fnb_cancel_status_20261019('${id(40)}')`,
      /CANCEL_REQUEST_NOT_FOUND/,
    ],
  ]) {
    if (sql.includes("fnb_execute_cancel_request"))
      await db.exec(
        `update fnb_cancel_requests set requested_by='${id(101)}' where id='${id(40)}'`,
      );
    await assert.rejects(db.query(sql), error);
    checks++;
    await db.exec(
      `update fnb_cancel_requests set requested_by='${id(100)}' where id='${id(40)}'`,
    );
  }
  // An authorized approver can still act in the other branch without a global grant.
  await db.exec(
    `delete from role_permissions where permission_code='pos_fnb.cancel_unpaid_order';`,
  );
  const pending = (
    await db.query("select fnb_pending_cancel_requests_00455() as result")
  ).rows[0].result;
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, id(41));
  checks += 2;
  await assert.rejects(
    db.query(
      `select issue_manager_otp('fnb.cancel_unpaid_bill',jsonb_build_object('request_id','${id(40)}','entity_id','${id(30)}','context_hash',_fnb_cancel_context_00455('${id(30)}')),'${id(10)}',null::text,null::text)`,
    ),
    /APPROVAL_SCOPE_DENIED/,
  );
  checks++;
  // Both historical overloads carry defaults, so select the three-argument body
  // by signature under a test-only name rather than relying on ambiguous dispatch.
  await db.exec(
    "alter function _issue_manager_otp_before_00566(text,jsonb,uuid) rename to test_legacy_otp_three",
  );
  for (const [name, suffix] of [
    ["test_legacy_otp_three", ""],
    ["_issue_manager_otp_before_00566", ",null::text,null::text"],
  ]) {
    await assert.rejects(
      db.query(
        `select ${name}('fnb.cancel_unpaid_bill'::text,'{}'::jsonb,'${id(10)}'::uuid${suffix})`,
      ),
      /PERMISSION_DENIED/,
    );
    checks++;
  }
  await db.query(
    `select fnb_reject_cancel_request_00462('${id(41)}','Synthetic refusal')`,
  );
  assert.equal(
    (
      await db.query(
        `select rejected_by from fnb_cancel_requests where id='${id(41)}'`,
      )
    ).rows[0].rejected_by,
    id(101),
  );
  checks++;
  assert.equal(
    (
      await db.query(
        `select rejected_at from fnb_cancel_requests where id='${id(40)}'`,
      )
    ).rows[0].rejected_at,
    null,
  );
  checks++;
  assert.equal(
    (
      await db.query(
        `select _staff_legacy_cancel_permission('${id(101)}','${id(10)}') as ok`,
      )
    ).rows[0].ok,
    false,
  );
  checks++;
  await db.exec(
    `delete from user_branch_permission_overrides where branch_id='${id(10)}';`,
  );
  assert.equal(
    (
      await db.query(
        `select _staff_legacy_cancel_permission('${id(101)}','${id(10)}') as ok`,
      )
    ).rows[0].ok,
    true,
  );
  checks++;
  console.log(
    `Staff cancellation: ${checks} checks passed; granular denial blocks legacy void fallback, allowed-branch approval preserved.`,
  );
} finally {
  await db.close();
}
