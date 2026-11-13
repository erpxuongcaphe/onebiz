// Runs only against the dedicated disposable CI PostgreSQL service.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { initializeStaffAccessFixture } from "./fixture.mjs";
import { functionFromMigration } from "./inventory.mjs";

if (process.env.STAFF_EPHEMERAL_DB !== "onebiz_staff_access_test") {
  throw new Error("Dedicated disposable staff-access database required.");
}
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const args = [
  "-XqAt",
  "-v",
  "ON_ERROR_STOP=1",
  "-h",
  "127.0.0.1",
  "-p",
  "55433",
  "-U",
  "staff_test",
  "-d",
  "onebiz_staff_access_test",
];
const env = {
  PATH: process.env.PATH,
  PGPASSWORD: "ephemeral-test-only",
  PGSSLMODE: "disable",
  PGCONNECT_TIMEOUT: "5",
};
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const owner = `set request.jwt.claim.sub='${id(100)}';`;
function execute(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn("psql", args, { env, stdio: ["pipe", "pipe", "pipe"] });
    let out = "",
      err = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Disposable SQL exceeded 15 seconds"));
    }, 15000);
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (err += chunk));
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      code === 0 ? resolve(out.trim()) : reject(new Error(err));
    });
    child.stdin.end(sql);
  });
}
async function hold(sql) {
  const child = spawn("psql", args, { env, stdio: ["pipe", "pipe", "pipe"] });
  let out = "",
    err = "";
  const done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(err)),
    );
  });
  // Observe failures immediately, including while waiting for LOCKED.
  done.catch(() => {});
  child.stderr.on("data", (chunk) => (err += chunk));
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Lock holder did not become ready")),
      5000,
    );
    child.stdout.on("data", (chunk) => {
      out += chunk;
      if (out.includes("LOCKED")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", () => {
      clearTimeout(timer);
      reject(new Error(err || "Lock holder closed early"));
    });
  });
  child.stdin.write(`begin;${sql};select 'LOCKED';\n`);
  try {
    await ready;
  } catch (error) {
    child.kill();
    throw error;
  }
  return async (commit = false) => {
    child.stdin.end(`${commit ? "commit" : "rollback"};\n`);
    await done;
  };
}
await initializeStaffAccessFixture({ exec: execute }, id);
await execute(
  await readFile(
    new URL(
      "../../supabase/migrations/20261111052704_staff_branch_access.sql",
      import.meta.url,
    ),
    "utf8",
  ),
);
const snapshot = async () =>
  JSON.parse(
    await execute(`${owner}select get_staff_profile_access('${id(101)}');`),
  );
const initial = await snapshot();
const draft = {
  roleId: initial.user.roleId,
  branchIds: initial.user.branchIds,
  assignments: [],
  exceptions: initial.exceptions,
};
const saveSql = (state, next) =>
  `${owner}select save_staff_profile_access('${id(101)}',${literal(state.fingerprint)},${literal(JSON.stringify(next))}::jsonb);`;

// Old editors can hold these locks without participating in our advisory lock.
// The new editor must fail quickly, preserve all data and leave readers working.
for (const locked of [
  `select 1 from profiles where id='${id(101)}' for update`,
  "lock table role_permissions in row exclusive mode",
  "lock table user_branches in row exclusive mode",
  "lock table account_hierarchy_config in row exclusive mode",
]) {
  const release = await hold(locked);
  try {
    const start = Date.now();
    await assert.rejects(execute(saveSql(initial, draft)), /lock timeout/);
    assert.ok(
      Date.now() - start < 6000,
      "Save should yield promptly to the active writer",
    );
    assert.equal(
      (await snapshot()).fingerprint,
      initial.fingerprint,
      "Read still works and failed save changes nothing",
    );
  } finally {
    await release();
  }
}
console.log(
  "PASS four legacy-writer lock conflicts, bounded timeout, read access and rollback",
);

const one = structuredClone(draft),
  two = structuredClone(draft);
one.exceptions.push({
  branchId: id(10),
  permissionCode: "pos_fnb.split_bill",
  choice: "revoke",
});
two.exceptions.push({
  branchId: id(10),
  permissionCode: "pos_fnb.transfer_table",
  choice: "grant",
});
const results = await Promise.allSettled([
  execute(saveSql(initial, one)),
  execute(saveSql(initial, two)),
]);
assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
assert.equal(
  results.filter(
    (r) =>
      r.status === "rejected" && /STAFF_PROFILE_STALE/.test(r.reason.message),
  ).length,
  1,
);
assert.equal(
  await execute(
    "select count(*) from audit_log where action='staff_profile_access_saved';",
  ),
  "1",
);
const after = await snapshot();
assert.equal(after.exceptions.filter((e) => e.branchId !== null).length, 1);
assert.equal(after.user.primaryBranchId, id(10));
console.log(
  "PASS simultaneous saves: one commits, the stale writer cannot overwrite it",
);

// A legacy permission change after opening the editor invalidates its snapshot.
await execute(
  `insert into role_permissions values('${id(20)}','inventory.view');`,
);
await assert.rejects(execute(saveSql(after, draft)), /STAFF_PROFILE_STALE/);
assert.equal(
  await execute(
    "select count(*) from audit_log where action='staff_profile_access_saved';",
  ),
  "1",
);
console.log(
  "PASS legacy role edits invalidate the snapshot with no partial save",
);

// Shipping already holds its row while another path may hold the invoice
// first. An own-order permission check must not wait and create a deadlock.
await execute(await functionFromMigration("20261111070229_staff_branch_checkout_permissions.sql","_staff_permission_at_scope"));
for (const name of ["_staff_order_owner_unrestricted","_staff_order_independent_branches"])
  await execute(await functionFromMigration("20261113004524_staff_own_order_scope.sql",name));
await execute(`
 create table invoices(id uuid primary key,tenant_id uuid,branch_id uuid,source text,created_by uuid,code text);
 create table shipping_orders(id uuid primary key,tenant_id uuid,invoice_id uuid,status text,code text,partner_id uuid,updated_at timestamptz);
 create table delivery_partners(id uuid,name text);
 create function can_read_branch_document_00567(t uuid,b uuid) returns boolean language sql stable security definer set search_path=public as $$select t=get_user_tenant_id() and user_has_branch_access(auth.uid(),b)$$;
 insert into invoices values ('${id(501)}','${id(1)}','${id(10)}','order','${id(101)}','INV');
 insert into shipping_orders values ('${id(502)}','${id(1)}','${id(501)}','pending','SHIP',null,now());
 delete from role_permissions where role_id='${id(20)}';
 insert into role_permissions values ('${id(20)}','orders.view_own_only'),('${id(20)}','orders.create');
`);
await execute(await functionFromMigration("20261113005650_staff_own_order_action_scope.sql","_staff_order_target_visible"));
await execute(await functionFromMigration("00276_atomic_shipping_status.sql","update_shipping_order_status_atomic"));
await execute(await readFile(new URL("../../supabase/migrations/20261113013054_staff_shipping_owner_guard.sql",import.meta.url),"utf8"));
const releaseInvoice=await hold(`select 1 from invoices where id='${id(501)}' for update`);
try {
  const start=Date.now();
  await assert.rejects(execute(`set request.jwt.claim.sub='${id(101)}'; select update_shipping_order_status_atomic('${id(502)}','picked_up',null);`),/could not obtain lock/);
  assert.ok(Date.now()-start<6000,"shipping must not wait on reverse invoice lock");
  assert.equal(await execute(`select status from shipping_orders where id='${id(502)}'`),"pending","failed attempt must roll back");
} finally { await releaseInvoice(); }
await execute(`set request.jwt.claim.sub='${id(101)}'; select update_shipping_order_status_atomic('${id(502)}','picked_up',null);`);
assert.equal(await execute(`select status from shipping_orders where id='${id(502)}'`),"picked_up");
console.log("PASS shipping own-order guard fails promptly on conflicting lock and succeeds afterward");
