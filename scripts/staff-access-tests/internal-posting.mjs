import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { functionFromMigration } from "./inventory.mjs";

export async function verifyInternalPostingScope(
  db,
  { context, payload, call },
) {
  await db.exec(`alter table profiles add column role text default 'staff';
 create table user_permission_overrides(tenant_id uuid,user_id uuid,permission_code text,override_type text);
 create table user_branch_permission_overrides(tenant_id uuid,user_id uuid,branch_id uuid,permission_code text,override_type text);
 create function get_user_tenant_id() returns uuid language sql stable as $$select tenant_id from profiles where id=auth.uid()$$;`);
  for (const [file, name] of [
    ["20261111052704_staff_branch_access.sql", "user_has_permission_at_branch"],
    [
      "20261111070229_staff_branch_checkout_permissions.sql",
      "_staff_permission_at_scope",
    ],
  ])
    await db.exec(await functionFromMigration(file, name));
  // Execute the exact migration replacements on the three actual checkout-chain
  // consumers installed by this fixture. The separate scope suite covers all 12.
  const sql = await readFile(
    new URL(
      "../../supabase/migrations/20261111134801_staff_branch_internal_export_permissions.sql",
      import.meta.url,
    ),
    "utf8",
  );
  let block =
    sql.slice(
      sql.indexOf("do $migration$"),
      sql.indexOf(
        " target:='public._apply_manual_stock_movement_auth_impl_00246",
      ),
    ) + "end $migration$;";
  block = block.replace(
    ") entries(signature,branch_expression) loop",
    ") entries(signature,branch_expression) where signature in ('public._create_internal_sale_auth_impl_00243(uuid,uuid,uuid,uuid,uuid,text,uuid,text,jsonb,text,boolean,text)','public.checkout_internal_pos_atomic(uuid,uuid,jsonb,text,numeric,uuid,uuid,integer,uuid,text)','public._checkout_internal_pos_before_fnb_bridge_20261023(jsonb)') loop",
  );
  await db.exec(block);
  const snapshot = async () =>
    JSON.stringify(
      (
        await db.query(`select
 (select count(*) from internal_sales) sales,(select count(*) from invoices) invoices,
 (select count(*) from cash_transactions) cash,(select count(*) from stock_movements) stock,
 (select jsonb_agg(s order by branch_id,product_id) from branch_stock s) balances`)
      ).rows[0],
    );
  await db.query(
    "insert into user_branch_permission_overrides values($1,$2,$3,'inventory.internal_export','revoke')",
    [context.tenant_id, context.actor, payload.branchId],
  );
  const before = await snapshot();
  const attempt = {
    ...payload,
    sessionId: "91000000-0000-0000-0000-000000000091",
  };
  await assert.rejects(
    db.query(call(attempt)),
    /INTERNAL_POS_PERMISSION_DENIED/,
  );
  assert.equal(
    await snapshot(),
    before,
    "denied checkout must not alter paired cash, invoices or stock",
  );
  await db.exec(`update user_branch_permission_overrides set override_type='grant';
 create or replace function user_has_permission(uuid,text) returns boolean language sql stable as $$select $2 <> 'inventory.internal_export'$$;`);
  const result = (await db.query(call(attempt))).rows[0].result;
  assert.ok(result.invoice_id);
  assert.ok(result.input_invoice_id);
  const cash = (
    await db.query(
      "select branch_id,type,sum(amount) amount from cash_transactions where reference_id in ($1,$2) group by branch_id,type",
      [result.invoice_id, result.input_invoice_id],
    )
  ).rows;
  assert.equal(cash.length, 2);
  assert.ok(cash.every((row) => Number(row.amount) === 5000));
  assert.ok(
    cash.some(
      (row) => row.branch_id === payload.branchId && row.type === "receipt",
    ),
  );
  assert.ok(
    cash.some(
      (row) => row.branch_id === context.dest && row.type === "payment",
    ),
  );
  const posted = await snapshot();
  assert.equal(
    (await db.query(call(attempt))).rows[0].result.invoice_id,
    result.invoice_id,
  );
  assert.equal(
    await snapshot(),
    posted,
    "replay does not duplicate stock or paired cash",
  );
  await db.query(
    "insert into user_permission_overrides values($1,$2,'inventory.internal_export','revoke')",
    [context.tenant_id, context.actor],
  );
  await assert.rejects(
    db.query(
      call({ ...attempt, sessionId: "91000000-0000-0000-0000-000000000092" }),
    ),
    /INTERNAL_POS_PERMISSION_DENIED/,
  );
  assert.equal(await snapshot(), posted);
  console.log(
    "PASS: scoped internal checkout denies without effects; source-only grant posts actual paired documents/cash/stock and replays once; global denial wins.",
  );
}
