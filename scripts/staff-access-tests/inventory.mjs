import { readFile } from "node:fs/promises";

export async function functionFromMigration(file, name) {
  const sql = await readFile(
    new URL(`../../supabase/migrations/${file}`, import.meta.url),
    "utf8",
  );
  const start = sql.search(
    new RegExp(`create(?: or replace)? function public\\.${name}\\s*\\(`, "i"),
  );
  if (start < 0) throw new Error(`Missing function ${name}`);
  const tail = sql.slice(start);
  const delimiter = /\bas\s+(\$[a-z_]*\$)/i.exec(tail);
  if (!delimiter) throw new Error(`Missing body delimiter for ${name}`);
  const end = tail.indexOf(delimiter[1], delimiter.index + delimiter[0].length);
  if (end < 0) throw new Error(`Unterminated body for ${name}`);
  return `${tail.slice(0, end + delimiter[1].length)};`;
}

/** Real inventory authorization bodies, with isolated minimal document tables. */
export async function verifyInventoryBranchPermissions(
  db,
  { id, actor, check, rejects },
) {
  await db.exec(`
    create table inventory_checks(id uuid primary key,tenant_id uuid,branch_id uuid,code text,status text,note text,updated_at timestamptz default now());
    create table inventory_check_items(id uuid primary key,check_id uuid,product_id uuid,product_name text,system_stock numeric,actual_stock numeric);
    create table inventory_check_changes(id uuid,tenant_id uuid,request_id uuid,created_by uuid,request jsonb,result jsonb);
    create table products(id uuid primary key,tenant_id uuid,code text,unit text,inventory_role text);
    create function _apply_inventory_check_impl_00056(uuid,uuid,uuid) returns jsonb language sql as $$select '{"applied":true}'::jsonb$$;
    insert into inventory_checks(id,tenant_id,branch_id,code,status) values
      ('${id(201)}','${id(1)}','${id(10)}','Premium check','draft'),
      ('${id(202)}','${id(1)}','${id(11)}','Tu Bua check','draft'),
      ('${id(203)}','${id(2)}','${id(12)}','Foreign check','draft');
    insert into user_branches values('${id(101)}','${id(11)}') on conflict do nothing;
    insert into role_permissions values
      ('${id(20)}','inventory.view'),('${id(20)}','inventory.check'),
      ('${id(20)}','inventory.edit_check'),('${id(20)}','inventory.cancel_check');
  `);
  const originals = [
    [
      "00249_harden_inventory_check_transfer.sql",
      "apply_inventory_check_atomic",
      "_apply_inventory_check_auth_impl_00249",
    ],
    [
      "00256_harden_stock_document_creation.sql",
      "create_and_apply_inventory_check_atomic",
    ],
    [
      "00263_atomic_inventory_check_cancel.sql",
      "cancel_inventory_check_atomic",
    ],
    ["00515_operational_uom_snapshots.sql", "create_stock_operation_with_uom"],
    [
      "20261026115757_inventory_check_amendment.sql",
      "get_inventory_check_change_source",
    ],
    ["20261026115757_inventory_check_amendment.sql", "_change_inventory_check"],
  ];
  for (const [file, name, renamed] of originals) {
    let source = await functionFromMigration(file, name);
    if (
      name === "_change_inventory_check" &&
      process.env.ONEBIZ_INVENTORY_CHANGE_AUDIT_FILE
    ) {
      const definitions = JSON.parse(
        await readFile(process.env.ONEBIZ_INVENTORY_CHANGE_AUDIT_FILE, "utf8"),
      );
      const current = definitions.find((entry) => entry.proname === name);
      if (!current) throw new Error(`Missing captured function ${name}`);
      source = current.definition;
    }
    await db.exec(
      renamed
        ? source.replace(`public.${name}(`, `public.${renamed}(`)
        : source,
    );
  }
  const amendment = await readFile(
    new URL(
      "../../supabase/migrations/20261026115757_inventory_check_amendment.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await db.exec(amendment.match(/do \$patch\$[\s\S]*?end \$patch\$;/)[0]);
  await db.exec(
    await readFile(
      new URL(
        "../../supabase/migrations/20261111060519_staff_branch_inventory_permissions.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    await functionFromMigration(
      "20261111070229_staff_branch_checkout_permissions.sql",
      "_staff_permission_at_scope",
    ),
  );
  await db.exec(
    await readFile(
      new URL(
        "../../supabase/migrations/20261112033025_staff_branch_inventory_shared_reads.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await actor(101);
  // The view prerequisite must follow the stored check's branch, without
  // broadening the separate permission to change the check.
  await db.exec(`insert into staff_branch_permission_catalog values ('inventory.view',1);
    insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
    values ('${id(1)}','${id(101)}','${id(10)}','inventory.view','revoke','${id(100)}');`);
  for (const action of ["edit", "cancel"]) {
    await rejects(
      db.query(
        "select _change_inventory_check($1,$2,$3,null,null,null,null,null,false)",
        [id(201), action, []],
      ),
      /INSUFFICIENT_PERMISSION/,
    );
    await rejects(
      db.query(
        "select _change_inventory_check($1,$2,$3,null,null,null,null,null,false)",
        [id(202), action, []],
      ),
      /INVENTORY_CHECK_REASON_REQUIRED/,
    );
  }
  await db.exec(`delete from role_permissions where role_id='${id(20)}' and permission_code='inventory.view';
    update user_branch_permission_overrides set branch_id='${id(11)}',override_type='grant' where permission_code='inventory.view';`);
  await rejects(
    db.query(
      "select _change_inventory_check($1,'edit',$2,null,null,null,null,null,false)",
      [id(202), []],
    ),
    /INVENTORY_CHECK_REASON_REQUIRED/,
  );
  await rejects(
    db.query(
      "select _change_inventory_check($1,'edit',$2,null,null,null,null,null,false)",
      [id(201), []],
    ),
    /INSUFFICIENT_PERMISSION/,
  );
  await db.exec(`delete from user_branch_permission_overrides where permission_code='inventory.view';
    delete from staff_branch_permission_catalog where permission_code='inventory.view';
    insert into role_permissions values ('${id(20)}','inventory.view');`);
  // Existing templates still authorize both accessible branches before any exception.
  for (const document of [201, 202]) {
    const result = await db.query(
      "select get_inventory_check_change_source($1) value",
      [id(document)],
    );
    check(
      result.rows[0].value.id,
      id(document),
      "existing inventory access preserved",
    );
  }
  await db.exec(`insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
    select '${id(1)}','${id(101)}','${id(10)}',code,'revoke','${id(100)}'
    from unnest(array['inventory.check','inventory.edit_check','inventory.cancel_check']) code;`);
  await rejects(
    db.query("select get_inventory_check_change_source($1)", [id(201)]),
    /INSUFFICIENT_PERMISSION/,
  );
  await rejects(
    db.query("select cancel_inventory_check_atomic($1)", [id(201)]),
    /INSUFFICIENT_PERMISSION/,
  );
  await rejects(
    db.query("select _apply_inventory_check_auth_impl_00249($1,$2,$3)", [
      id(1),
      id(201),
      id(101),
    ]),
    /INSUFFICIENT_PERMISSION/,
  );
  await rejects(
    db.query("select create_and_apply_inventory_check_atomic($1,null,$2)", [
      id(10),
      [],
    ]),
    /INSUFFICIENT_PERMISSION/,
  );
  await rejects(
    db.query(
      "select create_stock_operation_with_uom('inventory_check',$1,$2,$3,null,null,null)",
      [id(10), [], id(300)],
    ),
    /UOM_OPERATION_DENIED/,
  );
  for (const action of ["edit", "cancel"]) {
    await rejects(
      db.query(
        "select _change_inventory_check($1,$2,$3,null,null,null,null,null,false)",
        [id(201), action, []],
      ),
      /INSUFFICIENT_PERMISSION/,
    );
    await rejects(
      db.query(
        "select _change_inventory_check($1,$2,$3,null,null,null,null,null,false)",
        [id(202), action, []],
      ),
      /INVENTORY_CHECK_REASON_REQUIRED/,
    );
  }
  await rejects(
    db.query("select create_and_apply_inventory_check_atomic($1,null,$2)", [
      id(11),
      [],
    ]),
    /INVENTORY_CHECK_ITEMS_INVALID/,
  );
  await rejects(
    db.query(
      "select create_stock_operation_with_uom('inventory_check',$1,$2,$3,null,null,null)",
      [id(11), [], id(300)],
    ),
    /UOM_ITEMS_REQUIRED/,
  );
  check(
    (
      await db.query("select get_inventory_check_change_source($1) value", [
        id(202),
      ])
    ).rows[0].value.id,
    id(202),
    "other branch remains accessible",
  );
  check(
    (
      await db.query("select cancel_inventory_check_atomic($1) value", [
        id(202),
      ])
    ).rows[0].value.status,
    "cancelled",
    "real draft cancellation works in permitted branch",
  );
  check(
    (
      await db.query("select status from inventory_checks where id=$1", [
        id(201),
      ])
    ).rows[0].status,
    "draft",
    "denied check was not modified",
  );
  await rejects(
    db.query("select cancel_inventory_check_atomic($1)", [id(203)]),
    /INSUFFICIENT_PERMISSION/,
  );
  // A branch grant must also work when the common role lacks the permission.
  await db.exec(`delete from role_permissions where role_id='${id(20)}' and permission_code='inventory.check';
    update user_branch_permission_overrides set override_type='grant' where user_id='${id(101)}' and permission_code='inventory.check';`);
  await rejects(
    db.query("select create_and_apply_inventory_check_atomic($1,null,$2)", [
      id(10),
      [],
    ]),
    /INVENTORY_CHECK_ITEMS_INVALID/,
  );
  await rejects(
    db.query("select create_and_apply_inventory_check_atomic($1,null,$2)", [
      id(11),
      [],
    ]),
    /INSUFFICIENT_PERMISSION/,
  );
}
