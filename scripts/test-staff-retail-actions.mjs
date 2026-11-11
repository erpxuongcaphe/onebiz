import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { initializeStaffAccessFixture } from "./staff-access-tests/fixture.mjs";
import { functionFromMigration } from "./staff-access-tests/inventory.mjs";
const { PGlite } = await import(
  process.env.ONEBIZ_PGLITE_MODULE
    ? pathToFileURL(process.env.ONEBIZ_PGLITE_MODULE).href
    : "@electric-sql/pglite"
);
const db = new PGlite();
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const migration = (name) =>
  readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
try {
  await initializeStaffAccessFixture(db, id);
  await db.exec(await migration("20261111052704_staff_branch_access.sql"));
  await db.exec(
    await functionFromMigration(
      "20261111070229_staff_branch_checkout_permissions.sql",
      "_staff_permission_at_scope",
    ),
  );
  await db.exec(`
 create table invoices(id uuid primary key,tenant_id uuid,branch_id uuid,code text,status text,source text,paid numeric,total numeric,debt numeric,customer_id uuid,customer_name text,shift_id uuid,deleted_at timestamptz,client_session_id uuid,auto_saved boolean,updated_at timestamptz,draft_revision bigint default 0);
 create table invoice_items(id uuid primary key,invoice_id uuid);
 create table internal_sales(id uuid primary key,tenant_id uuid,from_branch_id uuid,to_branch_id uuid,status text,invoice_id uuid);
 create table purchase_orders(id uuid,tenant_id uuid,branch_id uuid);
 create table shifts(id uuid,tenant_id uuid,branch_id uuid,cashier_id uuid);
 create table products(id uuid,tenant_id uuid,name text,unit text,sell_price numeric,vat_rate numeric,category_id uuid,is_active boolean,allow_sale boolean);
 create table customers(id uuid,tenant_id uuid,name text,group_id uuid,price_tier_id uuid,loyalty_points integer,is_active boolean);
 create table customer_groups(id uuid,tenant_id uuid,discount_percent numeric);
 create function _current_caller_tenant() returns uuid language sql as $$select get_user_tenant_id()$$;
 create function can_read_branch_document_00567(uuid,uuid) returns boolean language sql as $$select public.user_has_branch_access(auth.uid(),$2)$$;
 insert into user_branches values('${id(101)}','${id(11)}',null);
 insert into invoices(id,tenant_id,branch_id,code,status,source,paid,total,debt,auto_saved) values
 ('${id(300)}','${id(1)}','${id(10)}','D-A','draft','pos',0,0,0,true),
 ('${id(301)}','${id(1)}','${id(11)}','D-B','draft','pos',0,0,0,true),
 ('${id(302)}','${id(1)}','${id(10)}','I-A','completed','pos',0,100,100,false);
 insert into invoice_items values('${id(310)}','${id(300)}');
 insert into internal_sales values('${id(320)}','${id(1)}','${id(10)}','${id(11)}','completed','${id(302)}');
 insert into products values('${id(400)}','${id(1)}','Product','Cái',100,0,null,true,true);
 select set_config('request.jwt.claim.sub','${id(101)}',false);
 `);
  const defs = [
    ["00264_atomic_pos_draft_save.sql", "adopt_pos_draft_session_atomic"],
    ["00292_pos_draft_revision_guard.sql", "adopt_pos_draft_session_atomic_v2"],
    ["00264_atomic_pos_draft_save.sql", "soft_delete_pos_draft_atomic"],
    ["00264_atomic_pos_draft_save.sql", "save_pos_draft_atomic"],
    ["00292_pos_draft_revision_guard.sql", "save_pos_draft_atomic_v3"],
    ["00253_harden_retail_pos_pricing.sql", "pos_prepare_retail_checkout"],
    [
      "00250_harden_fnb_payment_invoice_void.sql",
      "void_completed_invoice_atomic_v2",
      "_void_completed_invoice_atomic_v2_impl_00250",
    ],
    ["00510_fnb_internal_actual_receiving.sql", "cancel_internal_sale_atomic"],
  ];
  for (const [file, name, rename] of defs) {
    let sql = await functionFromMigration(file, name);
    if (rename) sql = sql.replace(`public.${name}(`, `public.${rename}(`);
    if (name === "pos_prepare_retail_checkout")
      sql = sql.replace("      and p.status = 'active'", "");
    await db.exec(sql);
  }
  await db.exec(await migration("00297_fix_pos_unassigned_variant_record.sql"));
  await db.exec(
    await migration("20261029170927_retail_closure_customer_catalog.sql"),
  );
  // Public authorization contract for the private payment-history reader;
  // optional local audit below executes its actual exported implementation.
  await db.exec(`create function get_document_payment_history_scoped(p_reference_type text,p_reference_id uuid,p_offset integer default 0,p_limit integer default 500) returns jsonb language plpgsql as $$declare v_actor uuid:=auth.uid();v_branch uuid;begin
 select branch_id into v_branch from invoices where id=p_reference_id and tenant_id=get_user_tenant_id();
 if not public.user_has_permission(v_actor,'pos_retail.void') then raise exception 'PAYMENT_HISTORY_DENIED';end if;return '{}';end$$;`);
  if (process.env.ONEBIZ_RETAIL_ACTION_AUDIT_FILE) {
    const actual = JSON.parse(
      await readFile(process.env.ONEBIZ_RETAIL_ACTION_AUDIT_FILE, "utf8"),
    );
    for (const name of [
      ...defs.map((x) => x[2] ?? x[1]),
      "get_document_payment_history_scoped",
    ]) {
      const f = actual.find((x) => x.proname === name);
      assert.ok(f, name);
      await db.exec(f.definition);
    }
  }
  await db.exec(
    await migration("20261111144156_staff_branch_retail_actions.sql"),
  );
  const codes = [
    "pos_retail.save_draft",
    "pos_retail.edit_price",
    "pos_retail.void",
  ];
  for (const code of codes) {
    await db.query("insert into role_permissions values($1,$2)", [
      id(20),
      code,
    ]);
    await db.query(
      "insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values($1,$2,$3,$4,'revoke',$5),($1,$2,$6,$4,'grant',$5)",
      [id(1), id(101), id(10), code, id(100), id(11)],
    );
  }
  const q = (sql, args) => () => db.query(sql, args);
  const calls = [
    q("select adopt_pos_draft_session_atomic($1,$2)", [id(300), id(330)]),
    q("select adopt_pos_draft_session_atomic_v2($1,$2,0)", [id(300), id(330)]),
    q("select soft_delete_pos_draft_atomic($1,false)", [id(300)]),
    q(
      "select save_pos_draft_atomic($1,null,'[]','cash',0,0,0,0,null,$2,true)",
      [id(10), id(330)],
    ),
    q(
      "select save_pos_draft_atomic_v3($1,null,'[]','cash',0,0,0,null,$2,true,$3,0)",
      [id(11), id(330), id(300)],
    ),
    q("select _void_completed_invoice_atomic_v2_impl_00250($1,$2,null,null)", [
      id(302),
      "test reason",
    ]),
    q("select cancel_internal_sale_atomic($1,$2)", [id(320), "test reason"]),
    q("select get_document_payment_history_scoped('invoice',$1)", [id(302)]),
  ];
  for (const call of calls)
    await assert.rejects(call(), /DENIED|INSUFFICIENT_PERMISSION/);
  const price = (branch) =>
    db.query(
      "select pos_prepare_retail_checkout($1,$2,$3,null,$4,null,0,null,null,0,null,0,0) result",
      [
        id(1),
        id(101),
        branch,
        [{ productId: id(400), quantity: 2, unitPrice: 90, discount: 0 }],
      ],
    );
  await assert.rejects(price(id(10)), /POS_PRICE_CHANGED/);
  await db.exec(
    "delete from role_permissions where permission_code like 'pos_retail.%'",
  );
  assert.equal(Number((await price(id(11))).rows[0].result.total), 180);
  const adopted = (
    await db.query("select adopt_pos_draft_session_atomic_v2($1,$2,0) result", [
      id(301),
      id(331),
    ])
  ).rows[0].result;
  assert.ok(adopted);
  assert.equal(
    (
      await db.query("select client_session_id from invoices where id=$1", [
        id(301),
      ])
    ).rows[0].client_session_id,
    id(331),
  );
  await db.query("select soft_delete_pos_draft_atomic($1,false)", [id(301)]);
  assert.ok(
    (await db.query("select deleted_at from invoices where id=$1", [id(301)]))
      .rows[0].deleted_at,
  );
  for (const code of codes)
    await db.query(
      "insert into user_permission_overrides(tenant_id,user_id,permission_code,override_type) values($1,$2,$3,'revoke')",
      [id(1), id(101), code],
    );
  await assert.rejects(price(id(11)), /POS_PRICE_CHANGED/);
  for (const table of ["invoices", "invoice_items"])
    await db.exec(
      `alter table ${table} enable row level security;create policy legacy_test on ${table} to authenticated using(true) with check(true);grant select,insert,update,delete on ${table} to authenticated;`,
    );
  await db.exec("set role authenticated");
  for (const table of ["invoices", "invoice_items"]) {
    await assert.rejects(
      db.query(`insert into ${table}(id) values($1)`, [id(340)]),
      /row-level security/,
    );
    assert.equal(
      (await db.query(`update ${table} set id=id returning id`)).rows.length,
      0,
    );
    assert.equal(
      (await db.query(`delete from ${table} returning id`)).rows.length,
      0,
    );
  }
  await db.exec("reset role");
  await db.exec(`delete from user_permission_overrides where permission_code like 'pos_retail.%';
 insert into invoices(id,tenant_id,branch_id,code,status,source,auto_saved) values('${id(350)}','${id(1)}','${id(11)}','D-B2','draft','pos',true);set role authenticated;`);
  await db.query("select soft_delete_pos_draft_atomic($1,false)", [id(350)]);
  assert.ok(
    (await db.query("select deleted_at from invoices where id=$1", [id(350)]))
      .rows[0].deleted_at,
  );
  await db.exec(
    "reset role; delete from user_branch_permission_overrides where permission_code like 'pos_retail.%'; set role authenticated",
  );
  await db.query("insert into invoices(id) values($1)", [id(351)]);
  await db.exec("reset role");
  console.log(
    "Retail actions: draft/void denial, persisted branch, actual local draft adoption/delete and price override, global denial and six raw-DML guards passed. Refund posting remains separately covered by full refund CI.",
  );
} finally {
  await db.close();
}
