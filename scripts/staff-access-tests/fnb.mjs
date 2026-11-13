import { readFile } from "node:fs/promises";
import { functionFromMigration } from "./inventory.mjs";

/** Exercise real RPC guards and a real table transfer, without a printer or live database. */
export async function verifyFnbBranchPermissions(
  db,
  { id, actor, check, rejects },
) {
  await db.exec(`
    drop function split_kitchen_order_atomic(uuid,text,uuid[],integer);
    drop function split_kitchen_order_quantities_20261020(uuid,jsonb,uuid);
    drop function fnb_transfer_table_atomic(uuid,uuid,uuid,uuid);
    alter table kitchen_orders add column table_id uuid, add column original_table_id uuid,
      add column order_type text default 'dine_in', add column status text default 'pending',
      add column invoice_id uuid, add column merged_into_id uuid, add column order_number text,
      add column updated_at timestamptz, add column delivery_completed_at timestamptz;
    create table kitchen_order_items(id uuid primary key,kitchen_order_id uuid,quantity integer,cancelled_qty integer);
    create table restaurant_tables(id uuid primary key,tenant_id uuid,branch_id uuid,status text,
      current_order_id uuid,is_active boolean default true,table_number text,name text,updated_at timestamptz);
    insert into user_branches values('${id(101)}','${id(11)}') on conflict do nothing;
    insert into role_permissions values('${id(20)}','pos_fnb.transfer_table');
    delete from user_permission_overrides where user_id='${id(101)}' and permission_code in ('pos_fnb.split_bill','pos_fnb.transfer_table');
    delete from user_branch_permission_overrides where user_id='${id(101)}' and permission_code in ('pos_fnb.split_bill','pos_fnb.transfer_table');
    insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
      select '${id(1)}','${id(101)}','${id(10)}',code,'revoke','${id(100)}'
      from unnest(array['pos_fnb.split_bill','pos_fnb.transfer_table']) code;
    update kitchen_orders set invoice_id='${id(600)}' where id in ('${id(30)}','${id(31)}');
  `);
  for (const [file, name] of [
    [
      "20261031031808_fnb_split_live_schema_contract.sql",
      "split_kitchen_order_atomic",
    ],
    [
      "20261031011730_fnb_direct_delivery_split.sql",
      "split_kitchen_order_quantities_20261020",
    ],
    ["00450_fnb_transfer_selected_bill.sql", "fnb_transfer_table_atomic"],
  ])
    await db.exec(await functionFromMigration(file, name));
  const migration = await readFile(
    new URL(
      "../../supabase/migrations/20261111052704_staff_branch_access.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const patch = migration.slice(
    migration.indexOf("-- Explicit audited consumers."),
    migration.indexOf("-- Additive bootstrap"),
  );
  await db.exec(patch);
  await actor(101);
  const calls = (order) => [
    [
      `select split_kitchen_order_atomic('${id(order)}','items',null,null)`,
      /SPLIT_BILL_PERMISSION_REQUIRED/,
      /KITCHEN_ORDER_NOT_SPLITTABLE/,
    ],
    [
      `select split_kitchen_order_quantities_20261020('${id(order)}','[]','${id(610)}')`,
      /SPLIT_BILL_PERMISSION_REQUIRED/,
      /KITCHEN_ORDER_NOT_SPLITTABLE/,
    ],
    [
      `select fnb_transfer_table_atomic('${id(1)}','${id(order)}','${id(620)}','${id(621)}')`,
      /FNB_TRANSFER_PERMISSION_REQUIRED/,
      /FNB_TRANSFER_ORDER_NOT_ELIGIBLE/,
    ],
  ];
  for (const [sql, denied] of calls(30)) await rejects(db.query(sql), denied);
  for (const [sql, , businessGuard] of calls(31))
    await rejects(db.query(sql), businessGuard);
  for (const [sql, denied] of calls(32)) await rejects(db.query(sql), denied);
  check(
    (await db.query(`select count(*)::integer n from kitchen_orders`)).rows[0]
      .n,
    3,
    "denied FNB calls do not create bills",
  );
  await db.exec(`
    delete from role_permissions where role_id='${id(20)}' and permission_code='pos_fnb.transfer_table';
    insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
      values('${id(1)}','${id(101)}','${id(11)}','pos_fnb.transfer_table','grant','${id(100)}');
    insert into restaurant_tables(id,tenant_id,branch_id,status,current_order_id,table_number,name) values
      ('${id(620)}','${id(1)}','${id(11)}','occupied','${id(31)}','A','Source'),
      ('${id(621)}','${id(1)}','${id(11)}','available',null,'B','Destination');
    update kitchen_orders set invoice_id=null,table_id='${id(620)}' where id='${id(31)}';
  `);
  check(
    (await db.query(calls(31)[2][0])).rows[0].fnb_transfer_table_atomic.success,
    true,
    "branch-only grant permits real transfer without role grant",
  );
  check(
    (await db.query(`select table_id from kitchen_orders where id='${id(31)}'`))
      .rows[0].table_id,
    id(621),
    "only selected bill moved",
  );
  check(
    (
      await db.query(
        `select status from restaurant_tables where id='${id(620)}'`,
      )
    ).rows[0].status,
    "available",
    "source table released",
  );
  check(
    (
      await db.query(
        `select count(*)::integer n from audit_log where action='fnb_transfer_table'`,
      )
    ).rows[0].n,
    1,
    "exactly one transfer audit",
  );
}
