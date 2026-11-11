import { readFile } from "node:fs/promises";
import { functionFromMigration } from "./inventory.mjs";

export async function verifyProductionBranchPermissions(
  db,
  { id, actor, check, rejects },
) {
  await db.exec(`
    create table production_orders(id uuid primary key,tenant_id uuid,branch_id uuid,status text,planned_qty numeric,product_id uuid,actual_start timestamptz,updated_at timestamptz default now());
    create table product_lots(id uuid primary key);
    create table operational_uom_requests(reference_type text,request_id uuid,tenant_id uuid,payload jsonb,result jsonb);
    create table branch_stock(tenant_id uuid,branch_id uuid,product_id uuid,variant_id uuid,quantity numeric);
    create table fnb_branch_product_cost_balances(tenant_id uuid,branch_id uuid,product_id uuid,costed_quantity numeric,deficit_quantity numeric);
    create function _can_read_branch_inventory_00476(uuid,uuid,uuid) returns boolean language sql set search_path=public as $$select user_has_branch_access($1,$3) or user_has_permission($1,'reports.view_all_branches')$$;
    insert into production_orders(id,tenant_id,branch_id,status,planned_qty) values
      ('${id(401)}','${id(1)}','${id(10)}','planned',10),
      ('${id(402)}','${id(1)}','${id(11)}','planned',10),
      ('${id(403)}','${id(2)}','${id(12)}','planned',10);
    insert into role_permissions select '${id(20)}',code from unnest(array[
      'production.view','production.create_order','production.complete_order','production.cancel_order','production.correct_order']) code;
  `);
  const functions = [
    [
      "00283_harden_production_order_lifecycle.sql",
      "create_production_order_atomic",
      "_create_production_order_auth_impl_00390",
    ],
    [
      "00283_harden_production_order_lifecycle.sql",
      "complete_production_atomic",
      "_complete_production_auth_impl_00283",
    ],
    [
      "00283_harden_production_order_lifecycle.sql",
      "revert_production_materials",
      "_revert_production_auth_impl_00283",
    ],
    [
      "00283_harden_production_order_lifecycle.sql",
      "change_production_status_atomic",
    ],
    [
      "00525_prepared_production_material_snapshot_guard.sql",
      "complete_production_atomic",
    ],
    ["00515_operational_uom_snapshots.sql", "complete_production_with_uom"],
    ["00527_lot_expiry_time.sql", "complete_production_with_expiry_time"],
    ["00528_production_date_times.sql", "complete_production_with_date_times"],
    [
      "202610230002_production_correction_lot_scope.sql",
      "correct_production_order_quantities",
    ],
    [
      "202610230003_production_used_adjustment.sql",
      "_production_used_adjustment",
    ],
    [
      "00512_inventory_scope_and_cost_visibility.sql",
      "get_fnb_production_stock_health_00476",
    ],
    [
      "20261103124910_fnb_production_negative_stock.sql",
      "get_fnb_production_stock_health_20261103",
    ],
  ];
  for (const [file, name, renamed] of functions) {
    const source = await functionFromMigration(file, name);
    await db.exec(
      renamed
        ? source.replace(`public.${name}(`, `public.${renamed}(`)
        : source,
    );
  }
  const adjustmentMigration = await readFile(
    new URL(
      "../../supabase/migrations/202610230003_production_used_adjustment.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await db.exec(
    adjustmentMigration.match(/do \$cancel_zero\$[\s\S]*?\$cancel_zero\$;/)[0],
  );
  await db.exec(
    await readFile(
      new URL(
        "../../supabase/migrations/20261111061912_staff_branch_production_permissions.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await actor(101);
  await db.exec(`insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
    select '${id(1)}','${id(101)}','${id(10)}',code,'revoke','${id(100)}' from unnest(array[
      'production.create_order','production.complete_order','production.cancel_order','production.correct_order']) code;`);
  const completions = [
    ["_complete_production_auth_impl_00283", "null,null,null,null"],
    ["complete_production_atomic", "null,null,null,null"],
    ["complete_production_with_uom", "null,null,null,null,null,null,null"],
    [
      "complete_production_with_expiry_time",
      "null,null,null,null,null,null,null,null",
    ],
    [
      "complete_production_with_date_times",
      "null,null,null,null,null,null,null,null",
    ],
  ];
  for (const [name, args] of completions)
    await rejects(
      db.query(`select ${name}($1,${args})`, [id(401)]),
      /COMPLETE_PRODUCTION_ORDER_PERMISSION_REQUIRED/,
    );
  await rejects(
    db.query("select change_production_status_atomic($1,$2)", [
      id(401),
      "material_check",
    ]),
    /UPDATE_PRODUCTION_ORDER_PERMISSION_REQUIRED/,
  );
  await rejects(
    db.query("select _create_production_order_auth_impl_00390($1)", [
      { branch_id: id(10) },
    ]),
    /CREATE_PRODUCTION_ORDER_PERMISSION_REQUIRED/,
  );
  await rejects(
    db.query("select _revert_production_auth_impl_00283($1,null)", [id(401)]),
    /CANCEL_PRODUCTION_ORDER_PERMISSION_REQUIRED/,
  );
  for (const cancel of [true, false])
    await rejects(
      db.query(
        "select correct_production_order_quantities($1,null,null,null,null,null,$2)",
        [id(401), cancel],
      ),
      /PRODUCTION_CORRECTION_PERMISSION_REQUIRED/,
    );
  await rejects(
    db.query(
      "select _production_used_adjustment($1,null,null,null,null,false,null,null)",
      [id(401)],
    ),
    /PRODUCTION_CORRECTION_PERMISSION_REQUIRED/,
  );
  for (const version of ["00476", "20261103"]) {
    await rejects(
      db.query(
        `select * from get_fnb_production_stock_health_${version}($1,$2)`,
        [id(10), []],
      ),
      /PRODUCTION_BRANCH_ACCESS_DENIED/,
    );
    check(
      (
        await db.query(
          `select * from get_fnb_production_stock_health_${version}($1,$2)`,
          [id(11), []],
        )
      ).rows.length,
      0,
      "allowed branch reader works through real wrapper",
    );
  }
  await rejects(
    db.query("select _create_production_order_auth_impl_00390($1)", [
      { branch_id: id(11) },
    ]),
    /PLANNED_QUANTITY_INVALID/,
  );
  await rejects(
    db.query("select _revert_production_auth_impl_00283($1,null)", [id(402)]),
    /CANCEL_REASON_REQUIRED/,
  );
  await rejects(
    db.query(
      "select _production_used_adjustment($1,null,null,null,null,false,null,null)",
      [id(402)],
    ),
    /PRODUCTION_CORRECTION_REASON_REQUIRED/,
  );
  await db.query("select change_production_status_atomic($1,$2)", [
    id(402),
    "material_check",
  ]);
  check(
    (
      await db.query("select status from production_orders where id=$1", [
        id(402),
      ])
    ).rows[0].status,
    "material_check",
    "allowed branch lifecycle mutation succeeds",
  );
  check(
    (
      await db.query("select status from production_orders where id=$1", [
        id(401),
      ])
    ).rows[0].status,
    "planned",
    "denied branch not modified",
  );
  // Preserve pre-existing company-wide read access for staff without membership.
  await db.exec(`insert into branches(id,tenant_id,name) values('${id(13)}','${id(1)}','Unassigned');
    insert into role_permissions values('${id(20)}','reports.view_all_branches');`);
  check(
    (
      await db.query(
        "select * from get_fnb_production_stock_health_00476($1,$2)",
        [id(13), []],
      )
    ).rows.length,
    0,
    "company-wide quantity read unchanged without override",
  );
  await db.exec(`delete from role_permissions where role_id='${id(20)}' and permission_code='production.complete_order';
    update user_branch_permission_overrides set override_type='grant' where user_id='${id(101)}' and permission_code='production.complete_order';`);
  await db.query("select change_production_status_atomic($1,$2)", [
    id(401),
    "material_check",
  ]);
  check(
    (
      await db.query("select status from production_orders where id=$1", [
        id(401),
      ])
    ).rows[0].status,
    "material_check",
    "local lifecycle grant works without shared template grant",
  );
  await rejects(
    db.query("select change_production_status_atomic($1,$2)", [
      id(402),
      "in_production",
    ]),
    /UPDATE_PRODUCTION_ORDER_PERMISSION_REQUIRED/,
  );
}
