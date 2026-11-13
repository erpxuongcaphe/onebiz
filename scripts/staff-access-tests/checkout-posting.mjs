import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { functionFromMigration } from "./inventory.mjs";
export async function installCheckoutTest(db) {
  await db.exec(`alter table profiles add column role text default 'staff',add column full_name text;
 update profiles set full_name='Synthetic cashier';
 alter table cash_transactions add column performed_by uuid,add column performed_by_name text,add column created_at timestamptz default transaction_timestamp();
 alter table branches add column tenant_id uuid,add column is_active boolean default true;
 update branches set tenant_id='00000000-0000-0000-0000-000000000002';
 create table staff_branch_permission_catalog(permission_code text primary key,enforcement_version integer);
 create table user_permission_overrides(tenant_id uuid,user_id uuid,permission_code text,override_type text);
 create table user_branch_permission_overrides(tenant_id uuid,user_id uuid,branch_id uuid,permission_code text,override_type text);
 create table fnb_print_points(id uuid,tenant_id uuid,branch_id uuid,enabled boolean);
 create table fnb_print_jobs(id uuid);
 create or replace function get_user_tenant_id() returns uuid language sql stable as $$select tenant_id from public.profiles where id=auth.uid()$$;`);
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
  let fixturePaymentDefinition;
  if (process.env.ONEBIZ_FNB_PAYMENT_VIEW_AUDIT_FILE) {
    fixturePaymentDefinition = (
      await db.query(
        `select pg_get_functiondef('public._fnb_complete_payment_impl_00343(uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text)'::regprocedure) as definition`,
      )
    ).rows[0].definition;
    const definitions = JSON.parse(
      await readFile(process.env.ONEBIZ_FNB_PAYMENT_VIEW_AUDIT_FILE, "utf8"),
    );
    const current = definitions.find(
      (entry) => entry.proname === "_fnb_complete_payment_impl_00343",
    );
    assert.ok(current);
    await db.exec(current.definition);
  }
  await db.exec(
    await readFile(
      new URL(
        "../../supabase/migrations/20261112045533_staff_branch_fnb_order_view.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(`insert into user_branch_permission_overrides values
    ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','pos_fnb.view_orders','revoke');`);
  // Checkout is an independent operation. A view denial must not block a
  // cashier who still has checkout at this branch. Roll back the synthetic
  // transaction so the downstream posting/replay fixture starts unchanged.
  await db.exec("begin");
  try {
    const paid = await db.query("select test_pay() result");
    if (!fixturePaymentDefinition) assert.ok(paid.rows[0].result.invoice_id);
  } catch (error) {
    // A captured production body needs additional production views absent from
    // this compact fixture; it must nevertheless pass the authorization guard.
    if (!fixturePaymentDefinition || /FNB_PAYMENT_DENIED|FNB_CHECKOUT_DENIED/.test(error.message)) throw error;
  } finally {
    await db.exec("rollback");
  }
  assert.equal(await state(), before, "synthetic checkout rolled back before replay test");
  await db.exec(`alter table kitchen_orders enable row level security;
    alter table kitchen_order_items enable row level security;
    alter function public.get_user_tenant_id() security definer;
    create policy test_kitchen_order_select on kitchen_orders for select to authenticated using (tenant_id=public.get_user_tenant_id());
    create policy test_kitchen_item_select on kitchen_order_items for select to authenticated using (true);
    grant usage on schema public,auth to authenticated;
    grant select on kitchen_orders,kitchen_order_items to authenticated;
    create or replace function user_has_permission(uuid,text) returns boolean language sql as $$select false$$;`);
  await db.exec(
    await readFile(
      new URL(
        "../../supabase/migrations/20261112065630_staff_branch_fnb_view_direct_reads.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec("set role authenticated");
  assert.equal(
    (await db.query("select count(*)::int n from kitchen_orders")).rows[0].n,
    1,
    "a branch checkout grant retains POS order reads despite a separate denied view",
  );
  await db.exec("reset role");
  if (fixturePaymentDefinition) {
    // The captured production implementation uses additional production views
    // absent from this compact fixture. Test its denial above, then use the
    // stock-posting fixture to exercise the full successful posting chain.
    await db.exec(fixturePaymentDefinition);
    await db.exec(
      await readFile(
        new URL(
          "../../supabase/migrations/20261112045533_staff_branch_fnb_order_view.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
  }
  await db.exec(`create or replace function user_has_permission(uuid,text) returns boolean language sql as $$select $2 not in ('pos_fnb.checkout','pos_fnb.view_orders')$$;
    update user_branch_permission_overrides set override_type='grant' where permission_code='pos_fnb.view_orders';`);
  // A separate order exception must not prevent actual F&B posting through
  // its secured RPC, even though direct invoice DML is restricted.
  await db.exec(`create table if not exists sales_orders(id uuid);
    create table if not exists sales_order_items(id uuid);
    create table if not exists shipping_orders(id uuid);
    alter table invoices enable row level security;
    alter table invoice_items enable row level security;
    alter table sales_orders enable row level security;
    alter table sales_order_items enable row level security;
    alter table shipping_orders enable row level security;
    insert into user_branch_permission_overrides values('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','orders.cancel','revoke');
    grant usage on schema public,auth to authenticated;
    grant execute on function public.test_pay(uuid) to authenticated;`);
  await db.exec(
    await readFile(
      new URL(
        "../../supabase/migrations/20261112040420_staff_branch_order_direct_writes.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  console.log(
    "PASS: branch checkout denial prevents invoice, cash and stock writes; continuing actual posting chain with branch-only checkout grant",
  );
}

export async function payAsAuthenticated(db) {
  await db.exec("set role authenticated");
  try {
    return (await db.query("select test_pay() result")).rows[0].result;
  } finally {
    await db.exec("reset role");
  }
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
