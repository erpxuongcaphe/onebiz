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
const file = (n) =>
  readFile(new URL("../supabase/migrations/" + n, import.meta.url), "utf8");
try {
  await initializeStaffAccessFixture(db, id);
  await db.exec(await file("20261111052704_staff_branch_access.sql"));
  for (const [f, n] of [
    [
      "20261111070229_staff_branch_checkout_permissions.sql",
      "_staff_permission_at_scope",
    ],
    [
      "20261111095224_staff_branch_kitchen_permissions.sql",
      "_staff_permission_any_branch",
    ],
  ])
    await db.exec(await functionFromMigration(f, n));
  for (const [f, t] of [
    ["00016_fnb_tables.sql", "restaurant_tables"],
    ["00125_floor_plan.sql", "floor_plan_zones"],
    ["00126_floor_plan_decorations.sql", "floor_plan_decorations"],
  ]) {
    const s = await file(f),
      start = s.indexOf("create table if not exists public." + t + " (");
    assert.ok(start >= 0);
    await db.exec(
      s
        .slice(start, s.indexOf("\n);", start) + 3)
        .replaceAll("uuid_generate_v4()", "gen_random_uuid()"),
    );
  }
  const floor = await file("00125_floor_plan.sql"),
    start = floor.indexOf("alter table public.restaurant_tables");
  await db.exec(floor.slice(start, floor.indexOf(";", start) + 1));
  await db.exec(`create schema storage;
 create function storage.foldername(text) returns text[] language sql immutable as $$select (string_to_array($1,'/'))[1:2]$$;
 create function storage.filename(text) returns text language sql immutable as $$select split_part($1,'/',3)$$;
 insert into user_branches(user_id,branch_id) values('${id(101)}','${id(11)}');
 insert into role_permissions values('${id(20)}','floor_plan.edit_branch');
 select set_config('request.jwt.claim.sub','${id(101)}',false);
 insert into floor_plan_zones(id,tenant_id,branch_id,name) values('${id(800)}','${id(1)}','${id(10)}','A'),('${id(801)}','${id(1)}','${id(11)}','B');
 insert into restaurant_tables(id,tenant_id,branch_id,table_number,name,zone_id) values('${id(810)}','${id(1)}','${id(10)}',1,'A','${id(800)}'),('${id(811)}','${id(1)}','${id(11)}',1,'B','${id(801)}');
 insert into floor_plan_decorations(id,tenant_id,branch_id,zone_id,kind) values('${id(820)}','${id(1)}','${id(10)}','${id(800)}','plant');`);
  const defs = [
    ["00323_fnb_table_config_rpcs.sql", "fnb_floor_zone_config_atomic"],
    ["00323_fnb_table_config_rpcs.sql", "fnb_floor_layout_update_atomic"],
    ["00323_fnb_table_config_rpcs.sql", "fnb_floor_decoration_config_atomic"],
    ["00324_fnb_table_create_from_floor_plan.sql", "fnb_table_config_atomic"],
    [
      "00326_storage_floor_plans_with_check.sql",
      "fnb_floor_plan_object_writable",
    ],
    ["00564_fnb_branch_pos_layout.sql", "reorder_fnb_floor_zones_atomic"],
  ];
  for (const [f, n] of defs) await db.exec(await functionFromMigration(f, n));
  if (process.env.ONEBIZ_FLOOR_AUDIT_FILE) {
    const actual = JSON.parse(
      await readFile(process.env.ONEBIZ_FLOOR_AUDIT_FILE, "utf8"),
    );
    for (const [, name] of defs) {
      const d = actual.find((x) => x.proname === name);
      assert.ok(d, name);
      await db.exec(d.definition);
    }
  }
  await db.exec(
    await file("20261111151351_staff_branch_floor_permissions.sql"),
  );
  await db.exec(
    `insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values('${id(1)}','${id(101)}','${id(10)}','floor_plan.edit_branch','revoke','${id(100)}'),('${id(1)}','${id(101)}','${id(11)}','floor_plan.edit_branch','grant','${id(100)}');`,
  );
  const denied = /không có quyền|FLOOR_PLAN_PERMISSION_DENIED/;
  for (const [sql, args] of [
    [
      "select fnb_floor_zone_config_atomic('create',$1,'{\"name\":\"Denied\"}')",
      [id(10)],
    ],
    [
      "select fnb_table_config_atomic('create',$1,$2)",
      [id(10), { name: "Denied", table_number: 2, zone_id: id(800) }],
    ],
    [
      "select fnb_floor_decoration_config_atomic('create',$1)",
      [{ zone_id: id(800), kind: "plant" }],
    ],
    [
      "select fnb_floor_decoration_config_atomic('update',$1)",
      [{ decoration_id: id(820), label: "Denied" }],
    ],
    [
      "select fnb_floor_decoration_config_atomic('delete',$1)",
      [{ decoration_id: id(820) }],
    ],
    ["select reorder_fnb_floor_zones_atomic($1,1,$2,$2)", [id(10), [id(800)]]],
    [
      "select fnb_floor_layout_update_atomic($1)",
      [
        [
          { table_id: id(811), position_x: 99 },
          { table_id: id(810), position_x: 99 },
        ],
      ],
    ],
  ])
    await assert.rejects(db.query(sql, args), denied);
  assert.equal(
    (
      await db.query("select position_x from restaurant_tables where id=$1", [
        id(811),
      ])
    ).rows[0].position_x,
    0,
    "mixed branch batch rolls back allowed first row",
  );
  const writable = async (branch, zone) =>
    (
      await db.query("select fnb_floor_plan_object_writable($1) v", [
        `${id(1)}/${branch}/${zone}.png`,
      ])
    ).rows[0].v;
  assert.equal(await writable(id(10), id(800)), false);
  assert.equal(
    await writable(id(11), id(800)),
    false,
    "forged path cannot move another branch zone",
  );
  await db.exec(
    "delete from role_permissions where permission_code='floor_plan.edit_branch'",
  );
  assert.equal(await writable(id(11), id(801)), true);
  await db.query("select fnb_floor_layout_update_atomic($1)", [
    [{ table_id: id(811), position_x: 99 }],
  ]);
  assert.equal(
    (
      await db.query("select position_x from restaurant_tables where id=$1", [
        id(811),
      ])
    ).rows[0].position_x,
    99,
  );
  const zone = (
    await db.query(
      "select fnb_floor_zone_config_atomic('create',$1,'{\"name\":\"Allowed\"}') v",
      [id(11)],
    )
  ).rows[0].v;
  assert.ok(zone.ok);
  await db.query("select fnb_table_config_atomic('create',$1,$2)", [
    id(11),
    { name: "Allowed", table_number: 2, zone_id: id(801) },
  ]);
  await db.query("select fnb_floor_decoration_config_atomic('create',$1)", [
    { zone_id: id(801), kind: "plant" },
  ]);
  const order = (
    await db.query(
      "select id from floor_plan_zones where branch_id=$1 order by sort_order,id",
      [id(11)],
    )
  ).rows.map((x) => x.id);
  await db.query("select reorder_fnb_floor_zones_atomic($1,1,$2,$3)", [
    id(11),
    order,
    [...order].reverse(),
  ]);
  await db.query(
    "insert into user_permission_overrides(tenant_id,user_id,permission_code,override_type) values($1,$2,'floor_plan.edit_branch','revoke')",
    [id(1), id(101)],
  );
  assert.equal(await writable(id(11), id(801)), false);
  await assert.rejects(
    db.query("select fnb_floor_layout_update_atomic($1)", [
      [{ table_id: id(811), position_x: 88 }],
    ]),
    denied,
  );
  // Explicit company-wide floor permission remains independent and visible as such.
  await db.query(
    "insert into role_permissions values($1,'floor_plan.edit_global')",
    [id(20)],
  );
  assert.equal(await writable(id(10), id(800)), true);
  await db.query("select fnb_floor_layout_update_atomic($1)", [
    [{ table_id: id(810), position_x: 77 }],
  ]);
  for (const table of [
    "restaurant_tables",
    "floor_plan_zones",
    "floor_plan_decorations",
  ]) {
    await db.exec(
      `alter table ${table} enable row level security;create policy test_legacy on ${table} to authenticated using(true) with check(true);grant select,insert,update,delete on ${table} to authenticated;set role authenticated;`,
    );
    await assert.rejects(
      db.query(`insert into ${table}(id) values($1)`, [id(850)]),
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
    await db.exec("reset role");
  }
  console.log(
    "PASS: six floor-plan consumers, seven denied operations, mixed-branch rollback, real local-only layout/zone/table/decoration/reorder, storage path isolation, global denial/company permission and nine DML policies.",
  );
} finally {
  await db.close();
}
