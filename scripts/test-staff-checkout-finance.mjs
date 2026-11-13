// Independent finance rights must survive a local F&B checkout revocation.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { functionFromMigration } from "./staff-access-tests/inventory.mjs";

const { PGlite } = await import(
  process.env.ONEBIZ_PGLITE_MODULE
    ? pathToFileURL(process.env.ONEBIZ_PGLITE_MODULE).href
    : "@electric-sql/pglite"
);
function expand(file) {
  return fs
    .readFileSync(file, "utf8")
    .replace(/^\\ir\s+(.+)$/gm, (_, target) =>
      expand(path.resolve(path.dirname(file), target.trim())),
    )
    .replace(/^\\set.*$/gm, "");
}
const db = new PGlite();
try {
  await db.exec(expand("supabase/tests/00552_party_money.setup.sql"));
  await db.exec(`alter table profiles add column role text default 'staff';
    alter table invoices add column source text default 'fnb';
    create table invoice_items(id uuid,invoice_id uuid);
    create table user_permission_overrides(tenant_id uuid,user_id uuid,permission_code text,override_type text);
    create table user_branch_permission_overrides(tenant_id uuid,user_id uuid,branch_id uuid,permission_code text,override_type text);
    insert into user_branch_permission_overrides values(test_id(2),test_id(1),test_id(3),'pos_fnb.checkout','revoke');
    insert into invoices(id,tenant_id,branch_id,code,customer_id,customer_name,total,paid,debt,status,updated_at,created_at)
     values(test_id(30),test_id(2),test_id(3),'FINANCE-TEST',test_id(5),'Test customer',800,0,800,'completed',now(),now());
    update customers set debt=800 where id=test_id(5);`);
  await db.exec(
    await functionFromMigration(
      "20261111052704_staff_branch_access.sql",
      "user_has_permission_at_branch",
    ),
  );
  const migration = fs.readFileSync(
    "supabase/migrations/20261111070229_staff_branch_checkout_permissions.sql",
    "utf8",
  );
  const start = migration.indexOf("-- Legacy direct-table grants");
  const end = migration.indexOf("end $policies$;", start);
  assert.ok(start > 0 && end > start, "RLS migration section is explicit");
  await db.exec(migration.slice(start, end + "end $policies$;".length));
  await db.exec(`grant usage on schema public,auth to authenticated;
    grant select,insert,update,delete on all tables in schema public to authenticated;
    do $$declare t text;begin foreach t in array array['invoices','invoice_items','cash_transactions','shifts'] loop
      execute format('alter table %I enable row level security',t);
      execute format('create policy fixture_access on %I for all to authenticated using (true) with check (true)',t);
    end loop;end$$;
    set role authenticated;`);
  assert.equal(
    (
      await db.query(
        "select public._staff_checkout_write_allowed(test_id(2),test_id(3)) allowed",
      )
    ).rows[0].allowed,
    false,
  );
  assert.equal(
    (
      await db.query(
        "update invoices set paid=100 where id=test_id(30) returning id",
      )
    ).rows.length,
    0,
  );
  const result = (
    await db.query(`select record_cash_transaction_timed('invoice',
    jsonb_build_object('referenceId',test_id(30),'amount',300,'paymentMethod','cash','note','Independent collection'),
    now(),current_date,null) value`)
  ).rows[0].value;
  assert.ok(result.cash_transaction_id);
  assert.deepEqual(
    (
      await db.query(
        "select paid::integer,debt::integer from invoices where id=test_id(30)",
      )
    ).rows[0],
    { paid: 300, debt: 500 },
  );
  await db.query(
    `select amend_party_cash(id,updated_at,gen_random_uuid(),
    jsonb_build_object('amount',200,'paymentMethod','cash','transactionDate',current_date,'note','Correction'),
    'Independent finance correction') from cash_transactions where id=$1`,
    [result.cash_transaction_id],
  );
  assert.deepEqual(
    (
      await db.query(
        "select paid::integer,debt::integer from invoices where id=test_id(30)",
      )
    ).rows[0],
    { paid: 200, debt: 600 },
  );
  console.log(
    "PASS: local checkout denial blocks raw writes while actual authenticated finance collection and amendment retain independent authorization",
  );
} catch (error) {
  console.error(error.message, error.where);
  process.exitCode = 1;
} finally {
  await db.close();
}
