import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

export async function verifyOrderDirectWrites(db, id) {
  const tables = [
    "invoices",
    "invoice_items",
    "sales_orders",
    "sales_order_items",
    "shipping_orders",
  ];
  await db.exec(`reset role;
    create table if not exists invoice_items(id uuid primary key);
    create table sales_order_items(id uuid primary key);
    insert into invoices(id,tenant_id,branch_id,code,status,paid,debt) values ('${id(217)}','${id(1)}','${id(11)}','B4','draft',0,0);
    delete from user_permission_overrides where permission_code='orders.create';
    delete from user_branch_permission_overrides where permission_code in ('orders.create','orders.cancel');
    delete from staff_branch_permission_catalog where permission_code in ('orders.cancel','orders.create');
    grant usage on schema auth to authenticated;
  `);
  for (const table of tables)
    await db.exec(`alter table ${table} enable row level security;
    create policy legacy_all on ${table} for all to authenticated using (true) with check (true);
    grant select,insert,update,delete on ${table} to authenticated;`);
  await db.exec(
    await readFile(
      new URL(
        "../../supabase/migrations/20261112040420_staff_branch_order_direct_writes.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      new URL(
        "../../supabase/migrations/20261112040624_staff_branch_order_cancel_catalog.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      new URL(
        "../../supabase/migrations/20261112043800_staff_branch_order_create_catalog.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec("set role authenticated");
  assert.equal(
    (
      await db.query("update sales_orders set note='legacy' where id=$1", [
        id(220),
      ])
    ).affectedRows,
    1,
  );
  await db.exec(`reset role;
    insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
      values ('${id(1)}','${id(101)}','${id(11)}','orders.cancel','grant','${id(100)}'),
        ('${id(1)}','${id(101)}','${id(11)}','orders.create','grant','${id(100)}');
    set role authenticated;`);
  for (const [index, table] of tables.entries()) {
    await assert.rejects(
      db.query(`insert into ${table}(id) values($1)`, [id(950 + index)]),
      { code: "42501" },
    );
    assert.equal((await db.query(`update ${table} set id=id`)).affectedRows, 0);
    assert.equal((await db.query(`delete from ${table}`)).affectedRows, 0);
  }
  // The actual SECURITY DEFINER cancellation remains usable for this branch.
  const result = (
    await db.query(
      "select cancel_draft_invoice_atomic($1,'test reason') value",
      [id(217)],
    )
  ).rows[0].value;
  assert.equal(result.status, "cancelled");
  const created = (
    await db.query(
      "select save_sales_order_atomic(null,'TEST-AUTH',$1,null,$2,0,null,null,null,null,null) value",
      [id(11), [{ product_id: id(600), quantity: 2, unit_price: 10000 }]],
    )
  ).rows[0].value;
  assert.equal(
    Number(
      (
        await db.query("select total from invoices where id=$1", [
          created.order_id,
        ])
      ).rows[0].total,
    ),
    20000,
  );
  console.log(
    "PASS order writes: authenticated direct DML blocked only with exceptions; authorized cancellation RPC remains usable.",
  );
}
