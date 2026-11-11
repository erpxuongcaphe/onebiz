// Scope acceptance in disposable WASM PostgreSQL. Ledger delegates are explicit
// sentinels; this suite does not claim to validate stock costing or reversal.
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
const migration = (name) =>
  readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
try {
  await initializeStaffAccessFixture(db, id);
  await db.exec(await migration("20261111052704_staff_branch_access.sql"));
  const scoped = await migration(
    "20261111070229_staff_branch_checkout_permissions.sql",
  );
  await db.exec(
    scoped.slice(
      scoped.indexOf("create function public._staff_permission_at_scope"),
      scoped.indexOf("do $migration$"),
    ),
  );
  await db.exec(`
 create table disposal_exports(id uuid primary key default gen_random_uuid(),tenant_id uuid,branch_id uuid,code text,status text,total_amount numeric,reason text,note text,created_by uuid,updated_at timestamptz default now());
 create table disposal_export_items(id uuid primary key default gen_random_uuid(),disposal_id uuid,product_id uuid,quantity numeric);
 create table test_ledger_calls(kind text,document_id uuid,branch_id uuid);
 create function get_tenant_setting(uuid,text,jsonb) returns jsonb language sql as $$select $3$$;
 create function _apply_disposal_export_impl_00084(p_document uuid,p_actor uuid) returns jsonb language plpgsql as $$begin insert into test_ledger_calls values('apply',p_document,null); return '{"delegate":true}'; end$$;
 create function _void_disposal_export_impl_00228(p_document uuid,p_actor uuid,p_reason text) returns jsonb language plpgsql as $$begin insert into test_ledger_calls values('void',p_document,null); return '{"delegate":true}'; end$$;
 create function _apply_manual_stock_movement_impl_00226(p_tenant uuid,p_branch uuid,p_actor uuid,p_items jsonb) returns jsonb language plpgsql as $$begin insert into test_ledger_calls values('manual',null,p_branch); return '{"delegate":true}'; end$$;
 insert into user_branches(user_id,branch_id) values('${id(101)}','${id(11)}');
 insert into role_permissions values('${id(20)}','inventory.dispose');
 insert into disposal_exports(id,tenant_id,branch_id,code,status) values('${id(200)}','${id(1)}','${id(10)}','Premium','draft'),('${id(201)}','${id(1)}','${id(11)}','Tu Bua','draft'),('${id(202)}','${id(2)}','${id(12)}','Foreign','draft');
 insert into disposal_export_items(disposal_id,product_id,quantity) values('${id(200)}','${id(400)}',2);
 select set_config('request.jwt.claim.sub','${id(101)}',false);
 `);
  const definitions = [
    ["00246_harden_stock_document_rpcs.sql", "apply_disposal_export_atomic"],
    [
      "00246_harden_stock_document_rpcs.sql",
      "void_disposal_export_atomic",
      "_void_disposal_export_auth_impl_00246",
    ],
    [
      "00246_harden_stock_document_rpcs.sql",
      "apply_manual_stock_movement_atomic",
      "_apply_manual_stock_movement_auth_impl_00246",
    ],
    [
      "00268_atomic_internal_disposal_export_create.sql",
      "_create_and_apply_stock_export_00268",
    ],
    ["00269_atomic_stock_export_cancel.sql", "_cancel_stock_export_00269"],
    [
      "00269_atomic_stock_export_cancel.sql",
      "cancel_disposal_export_atomic_v2",
    ],
    ["00515_operational_uom_snapshots.sql", "create_stock_operation_with_uom"],
  ];
  for (const [file, name, renamed] of definitions) {
    let sql = await functionFromMigration(file, name);
    if (renamed) sql = sql.replace(`public.${name}(`, `public.${renamed}(`);
    if (name === "create_stock_operation_with_uom")
      sql = sql.replace(
        "user_has_permission(actor,permission)",
        "(case when permission='inventory.check' then public.user_has_permission_at_branch(actor,permission,p_branch_id) else public.user_has_permission(actor,permission) end)",
      );
    await db.exec(sql);
  }
  if (process.env.ONEBIZ_DISPOSAL_AUDIT_FILE) {
    const defs = JSON.parse(
      await readFile(process.env.ONEBIZ_DISPOSAL_AUDIT_FILE, "utf8"),
    );
    for (const [, name, renamed] of definitions.filter(
      (x) =>
        ![
          "create_stock_operation_with_uom",
          "cancel_disposal_export_atomic_v2",
        ].includes(x[1]),
    )) {
      const f = defs.find((x) => x.proname === (renamed ?? name));
      assert.ok(f, name);
      await db.exec(f.definition);
    }
  }
  await db.exec(
    await migration("20261111134142_staff_branch_disposal_permissions.sql"),
  );
  const apply = (n) =>
    db.query("select apply_disposal_export_atomic($1,null)", [id(n)]);
  const cancel = (n) =>
    db.query("select cancel_disposal_export_atomic_v2($1,'test reason')", [
      id(n),
    ]);
  const manual = (branch) =>
    db.query(
      "select _apply_manual_stock_movement_auth_impl_00246($1,$2,$3,$4)",
      [
        id(1),
        id(branch),
        id(101),
        [
          {
            reference_type: "disposal_export",
            quantity: 1,
            product_id: id(400),
          },
        ],
      ],
    );
  await apply(200); // Existing role remains effective without a local exception.
  await db.exec(
    `truncate test_ledger_calls; insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values('${id(1)}','${id(101)}','${id(10)}','inventory.dispose','revoke','${id(100)}');`,
  );
  await assert.rejects(apply(200), /INSUFFICIENT_PERMISSION/);
  await assert.rejects(cancel(200), /DISPOSAL_CANCEL_DENIED/);
  await assert.rejects(
    db.query("select _void_disposal_export_auth_impl_00246($1,null,null)", [
      id(200),
    ]),
    /INSUFFICIENT_PERMISSION/,
  );
  await assert.rejects(manual(10), /INSUFFICIENT_PERMISSION/);
  await assert.rejects(
    db.query(
      "select _create_and_apply_stock_export_00268('disposal',$1,'test',null,'[]')",
      [id(10)],
    ),
    /DISPOSAL_EXPORT_DENIED/,
  );
  await assert.rejects(
    db.query(
      "select create_stock_operation_with_uom('disposal',$1,'[]',$2,null,null,null)",
      [id(10), id(300)],
    ),
    /UOM_OPERATION_DENIED/,
  );
  assert.equal(
    (await db.query("select count(*)::int n from test_ledger_calls")).rows[0].n,
    0,
  );
  assert.equal(
    (
      await db.query("select status from disposal_exports where id=$1", [
        id(200),
      ])
    ).rows[0].status,
    "draft",
  );
  await cancel(201); // The other branch still works through the actual mutation.
  assert.equal(
    (
      await db.query("select status from disposal_exports where id=$1", [
        id(201),
      ])
    ).rows[0].status,
    "cancelled",
  );
  await db.exec(
    `delete from role_permissions where permission_code='inventory.dispose'; update user_branch_permission_overrides set override_type='grant' where permission_code='inventory.dispose';`,
  );
  await apply(200);
  await manual(10);
  await assert.rejects(apply(201), /INSUFFICIENT_PERMISSION/);
  await assert.rejects(
    apply(202),
    /INSUFFICIENT_PERMISSION|DISPOSAL_NOT_FOUND/,
  );
  await db.exec(
    `insert into user_permission_overrides(tenant_id,user_id,permission_code,override_type) values('${id(1)}','${id(101)}','inventory.dispose','revoke');`,
  );
  await assert.rejects(apply(200), /INSUFFICIENT_PERMISSION/);
  await db.exec(`delete from user_permission_overrides where permission_code='inventory.dispose';
 grant usage on schema public,auth to authenticated;
 grant select,insert,update,delete on disposal_exports,disposal_export_items to authenticated;
 alter table disposal_exports enable row level security; alter table disposal_export_items enable row level security;
 create policy fixture_legacy on disposal_exports to authenticated using(true) with check(true);
 create policy fixture_legacy on disposal_export_items to authenticated using(true) with check(true);
 set role authenticated;`);
  for (const table of ["disposal_exports", "disposal_export_items"]) {
    assert.equal(
      (await db.query(`delete from ${table} returning id`)).rows.length,
      0,
    );
    assert.equal(
      (await db.query(`update ${table} set id=id returning id`)).rows.length,
      0,
    );
    await assert.rejects(
      db.query(`insert into ${table} default values`),
      /row-level security/,
    );
  }
  await cancel(200);
  assert.equal(
    (
      await db.query("select status from disposal_exports where id=$1", [
        id(200),
      ])
    ).rows[0].status,
    "cancelled",
  );
  await db.exec(
    `reset role; delete from user_branch_permission_overrides where permission_code='inventory.dispose'; set role authenticated;`,
  );
  assert.ok(
    (await db.query("update disposal_exports set note='legacy' returning id"))
      .rows.length > 0,
  );
  await db.exec("reset role");
  console.log(
    "Disposal scope: all six consumers, persisted branch, local grant/global denial, actual draft cancellation, untouched delegates on denial, authenticated DML guard and legacy preservation passed.",
  );
} finally {
  await db.close();
}
