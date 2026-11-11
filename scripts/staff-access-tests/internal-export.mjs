import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { functionFromMigration } from "./inventory.mjs";

export async function verifyInternalExportScope(db, { id, migration }) {
  await db.exec(`
 create table internal_exports(id uuid primary key,tenant_id uuid,branch_id uuid,code text,status text,updated_at timestamptz default now());
 create table internal_export_items(id uuid primary key default gen_random_uuid(),export_id uuid,quantity numeric);
 create table internal_sales(id uuid primary key,tenant_id uuid,from_branch_id uuid,to_branch_id uuid,code text,status text,note text);
 create table internal_sale_items(id uuid primary key default gen_random_uuid(),internal_sale_id uuid,quantity numeric);
 create function _apply_internal_export_impl_00084(p_document uuid,p_actor uuid) returns jsonb language plpgsql as $$begin insert into test_ledger_calls values('internal_apply',p_document,null); return '{"delegate":true}'; end$$;
 create function _void_internal_export_impl_00228(p_document uuid,p_actor uuid,p_reason text) returns jsonb language plpgsql as $$begin insert into test_ledger_calls values('internal_void',p_document,null); return '{"delegate":true}'; end$$;
 insert into internal_exports values('${id(210)}','${id(1)}','${id(10)}','Premium','draft',now()),('${id(211)}','${id(1)}','${id(11)}','Tu Bua','draft',now());
 insert into internal_export_items(export_id,quantity) values('${id(210)}',2);
 insert into internal_sales values('${id(220)}','${id(1)}','${id(10)}','${id(11)}','Supply','draft',null);
 insert into internal_sale_items(internal_sale_id,quantity) values('${id(220)}',2);
 insert into role_permissions values('${id(20)}','inventory.internal_export');
 alter table internal_sales add column invoice_id uuid;
 create table invoices(id uuid primary key,tenant_id uuid,source text);
 create table invoice_items(id uuid primary key,invoice_id uuid,quantity numeric);
 insert into invoices values('${id(230)}','${id(1)}','internal'),('${id(231)}','${id(1)}','pos'),('${id(232)}','${id(1)}','pos');
 update internal_sales set invoice_id='${id(231)}' where id='${id(220)}';
 insert into invoice_items values('${id(240)}','${id(230)}',1),('${id(241)}','${id(231)}',1),('${id(242)}','${id(232)}',1);
 `);
  const definitions = [
    ["00246_harden_stock_document_rpcs.sql", "apply_internal_export_atomic"],
    [
      "00246_harden_stock_document_rpcs.sql",
      "void_internal_export_atomic",
      "_void_internal_export_auth_impl_00246",
    ],
    [
      "00243_harden_internal_sale_atomic.sql",
      "create_internal_sale_atomic",
      "_create_internal_sale_auth_impl_00243",
    ],
    ["00466_internal_pos_checkout.sql", "checkout_internal_pos_atomic"],
    [
      "00470_internal_pos_payment_and_precision.sql",
      "checkout_internal_pos_v2",
      "_checkout_internal_pos_before_fnb_bridge_20261023",
    ],
    [
      "20261027005706_internal_customer_canonical_identity.sql",
      "checkout_internal_pos_v2",
    ],
    [
      "00289_atomic_input_invoice_internal_sale_state.sql",
      "cancel_internal_sale_atomic",
      "_cancel_internal_sale_draft_00471",
    ],
    ["00471_internal_sale_paired_reversal.sql", "cancel_internal_sale_atomic"],
    [
      "00269_atomic_stock_export_cancel.sql",
      "cancel_internal_export_atomic_v2",
    ],
  ];
  for (const [file, name, renamed] of definitions) {
    let sql = await functionFromMigration(file, name);
    if (renamed) sql = sql.replace(`public.${name}(`, `public.${renamed}(`);
    await db.exec(sql);
  }
  if (process.env.ONEBIZ_INTERNAL_EXPORT_AUDIT_FILE) {
    const defs = JSON.parse(
      await readFile(process.env.ONEBIZ_INTERNAL_EXPORT_AUDIT_FILE, "utf8"),
    );
    for (const [, name, renamed] of definitions.filter(
      (x) => x[1] !== "cancel_internal_export_atomic_v2",
    )) {
      const f = defs.find((x) => x.proname === (renamed ?? name));
      assert.ok(f, name);
      await db.exec(f.definition);
    }
  }
  await db.exec(
    await migration(
      "20261111134801_staff_branch_internal_export_permissions.sql",
    ),
  );
  const apply = (n) =>
    db.query("select apply_internal_export_atomic($1,null)", [id(n)]);
  const cancel = (n) =>
    db.query("select cancel_internal_export_atomic_v2($1,'test reason')", [
      id(n),
    ]);
  await apply(210);
  await db.exec(
    `truncate test_ledger_calls; insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values('${id(1)}','${id(101)}','${id(10)}','inventory.internal_export','revoke','${id(100)}');`,
  );
  const deny = /INSUFFICIENT_PERMISSION|INTERNAL_.*DENIED|UOM_OPERATION_DENIED/;
  const calls = [
    () => apply(210),
    () => cancel(210),
    () =>
      db.query("select _void_internal_export_auth_impl_00246($1,null,null)", [
        id(210),
      ]),
    () =>
      db.query(
        "select _create_and_apply_stock_export_00268('internal',$1,'test',null,'[]')",
        [id(10)],
      ),
    () =>
      db.query(
        'select _apply_manual_stock_movement_auth_impl_00246($1,$2,$3,\'[{"reference_type":"internal_export"}]\')',
        [id(1), id(10), id(101)],
      ),
    () =>
      db.query(
        "select create_stock_operation_with_uom('internal_export',$1,'[]',$2,null,null,null)",
        [id(10), id(301)],
      ),
    () =>
      db.query(
        "select _create_internal_sale_auth_impl_00243($1,$2,$3,$4,null,null,null,null,'[]','debt',false,null)",
        [id(1), id(10), id(11), id(101)],
      ),
    () =>
      db.query(
        "select checkout_internal_pos_atomic($1,null,'[]','debt',0,$2,null,null,null,null)",
        [id(10), id(302)],
      ),
    () =>
      db.query("select checkout_internal_pos_v2($1)", [{ branchId: id(10) }]),
    () =>
      db.query("select _checkout_internal_pos_before_fnb_bridge_20261023($1)", [
        { branchId: id(10) },
      ]),
    () =>
      db.query("select cancel_internal_sale_atomic($1,'test reason')", [
        id(220),
      ]),
    () =>
      db.query("select _cancel_internal_sale_draft_00471($1,'test reason')", [
        id(220),
      ]),
  ];
  for (const call of calls) await assert.rejects(call(), deny);
  assert.equal(
    (await db.query("select count(*)::int n from test_ledger_calls")).rows[0].n,
    0,
  );
  await cancel(211);
  assert.equal(
    (
      await db.query("select status from internal_exports where id=$1", [
        id(211),
      ])
    ).rows[0].status,
    "cancelled",
  );
  await db.exec(
    `delete from role_permissions where permission_code='inventory.internal_export'; update user_branch_permission_overrides set override_type='grant' where permission_code='inventory.internal_export';`,
  );
  await apply(210);
  await assert.rejects(apply(211), deny);
  await db.exec(
    `insert into user_permission_overrides(tenant_id,user_id,permission_code,override_type) values('${id(1)}','${id(101)}','inventory.internal_export','revoke');`,
  );
  await assert.rejects(apply(210), deny);
  await db.exec(
    `delete from user_permission_overrides where permission_code='inventory.internal_export';`,
  );
  for (const table of [
    "internal_exports",
    "internal_export_items",
    "internal_sales",
    "internal_sale_items",
    "invoices",
    "invoice_items",
  ]) {
    await db.exec(
      `grant select,insert,update,delete on ${table} to authenticated; alter table ${table} enable row level security; create policy fixture_legacy on ${table} to authenticated using(true) with check(true);`,
    );
  }
  await db.exec("set role authenticated");
  for (const table of [
    "internal_exports",
    "internal_export_items",
    "internal_sales",
    "internal_sale_items",
  ]) {
    assert.equal(
      (await db.query(`delete from ${table} returning id`)).rows.length,
      0,
    );
    assert.equal(
      (await db.query(`update ${table} set id=id returning id`)).rows.length,
      0,
    );
    await assert.rejects(
      db.query(`insert into ${table}(id) values('${id(999)}')`),
      /row-level security/,
    );
  }
  await cancel(210);
  assert.deepEqual(
    (await db.query("update invoices set source=source returning id")).rows.map(
      (r) => r.id,
    ),
    [id(232)],
  );
  assert.deepEqual(
    (
      await db.query("update invoice_items set quantity=quantity returning id")
    ).rows.map((r) => r.id),
    [id(242)],
  );
  await assert.rejects(
    db.query("update invoices set source='internal' where id=$1", [id(232)]),
    /row-level security/,
  );
  await assert.rejects(
    db.query("update invoice_items set invoice_id=$1 where id=$2", [
      id(230),
      id(242),
    ]),
    /row-level security/,
  );
  await assert.rejects(
    db.query("insert into invoices values($1,$2,'internal')", [id(233), id(1)]),
    /row-level security/,
  );
  await assert.rejects(
    db.query("insert into invoice_items values($1,$2,1)", [id(243), id(231)]),
    /row-level security/,
  );
  assert.equal(
    (
      await db.query("delete from invoices where id in($1,$2) returning id", [
        id(230),
        id(231),
      ])
    ).rows.length,
    0,
  );
  assert.equal(
    (
      await db.query(
        "delete from invoice_items where invoice_id in($1,$2) returning id",
        [id(230), id(231)],
      )
    ).rows.length,
    0,
  );
  await db.query("insert into invoices values($1,$2,'pos')", [id(234), id(1)]);
  await db.query("insert into invoice_items values($1,$2,1)", [
    id(244),
    id(234),
  ]);
  await db.exec("reset role");
  console.log(
    "Internal export scope: 12 consumers, source branch, global denial/local grant, actual draft cancellation and 12 direct-DML guards passed; costing delegates remain bounded fixtures.",
  );
}
