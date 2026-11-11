import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { functionFromMigration } from "./inventory.mjs";
export async function installCheckoutTest(db) {
  await db.exec(`alter table profiles add column role text default 'staff',add column full_name text;
 update profiles set full_name='Synthetic cashier';
 alter table cash_transactions add column performed_by uuid,add column performed_by_name text,add column created_at timestamptz default transaction_timestamp();
 alter table branches add column tenant_id uuid,add column is_active boolean default true;
 update branches set tenant_id='00000000-0000-0000-0000-000000000002';
 create table user_permission_overrides(tenant_id uuid,user_id uuid,permission_code text,override_type text);
 create table user_branch_permission_overrides(tenant_id uuid,user_id uuid,branch_id uuid,permission_code text,override_type text);
 create table fnb_print_points(id uuid,tenant_id uuid,branch_id uuid,enabled boolean);
 create table fnb_print_jobs(id uuid);
 create or replace function get_user_tenant_id() returns uuid language sql stable as $$select tenant_id from profiles where id=auth.uid()$$;`);
  await db.exec(
    await functionFromMigration(
      "20261111052704_staff_branch_access.sql",
      "user_has_permission_at_branch",
    ),
  );
  await (
    await import("./checkout-definitions.mjs")
  ).loadCheckoutDefinitions(db);
  await db.exec(
    await readFile(
      new URL(
        "../../supabase/migrations/20261111070229_staff_branch_checkout_permissions.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(`create trigger test_cash_actor before insert on cash_transactions for each row execute function stamp_fnb_cash_actor_v1();
 create trigger test_linked_cash_actor after update of invoice_id on kitchen_orders for each row execute function stamp_linked_fnb_cash_actor_v1();`);
  await db.exec(
    `insert into user_branch_permission_overrides values('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','pos_fnb.checkout','revoke');`,
  );
  const state = async () =>
    JSON.stringify(
      (
        await db.query(
          `select (select count(*) from invoices) invoices,(select count(*) from cash_transactions) cash,(select count(*) from stock_movements) movements,(select jsonb_agg(b order by product_id) from branch_stock b) stock`,
        )
      ).rows[0],
    );
  const before = await state();
  await assert.rejects(db.query("select test_pay()"), /FNB_CHECKOUT_DENIED/);
  assert.equal(
    await state(),
    before,
    "denied checkout changes neither cash, invoices nor stock",
  );
  await db.exec(`create or replace function user_has_permission(uuid,text) returns boolean language sql as $$select $2<>'pos_fnb.checkout'$$;
 update user_branch_permission_overrides set override_type='grant' where permission_code='pos_fnb.checkout';`);
  console.log(
    "PASS: branch checkout denial prevents invoice, cash and stock writes; continuing actual posting chain with branch-only checkout grant",
  );
}

export async function verifyCheckoutCashActor(db, invoiceId) {
  const rows = (
    await db.query(
      "select performed_by,performed_by_name from cash_transactions where reference_id=$1",
      [invoiceId],
    )
  ).rows;
  assert.ok(rows.length > 0);
  assert.ok(
    rows.every(
      (c) =>
        c.performed_by === "00000000-0000-0000-0000-000000000001" &&
        c.performed_by_name === "Synthetic cashier",
    ),
  );
  console.log(
    "PASS: actual cash triggers retain performer attribution for a branch-only checkout grant",
  );
}
