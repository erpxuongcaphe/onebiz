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
  await db.exec(`create function public.get_user_effective_permissions_before_account_hierarchy(p_user uuid)
    returns table(permission_code text) language sql stable as $$
      select c.code from (select rp.permission_code as code from public.profiles p
        join public.role_permissions rp on rp.role_id=p.role_id where p.id=p_user
        union select o.permission_code from public.user_permission_overrides o
        where o.user_id=p_user and o.override_type='grant') c
      where not exists(select 1 from public.user_permission_overrides r
        where r.user_id=p_user and r.permission_code=c.code and r.override_type='revoke')
    $$`);
  await db.exec(`create function public.get_user_effective_permissions(p_user uuid)
    returns table(permission_code text) language sql stable as $$
      select x.permission_code from public.get_user_effective_permissions_before_account_hierarchy(p_user) x
    $$`);
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
  // Reproduce the previous no-exception bypass with synthetic rows only.
  await db.exec(`delete from user_branch_permission_overrides where permission_code='floor_plan.edit_branch';
    delete from user_permission_overrides where permission_code='floor_plan.edit_branch';
    delete from role_permissions where permission_code in ('floor_plan.edit_branch','floor_plan.edit_global');
    delete from user_branches where user_id='${id(101)}' and branch_id='${id(11)}';
    insert into floor_plan_decorations(id,tenant_id,branch_id,zone_id,kind) values('${id(821)}','${id(1)}','${id(11)}','${id(801)}','plant');
    create function public._staff_direct_table_write_allowed() returns boolean language sql stable security definer set search_path='' as $$ select not exists(select 1 from public.user_branch_permission_overrides where user_id=auth.uid() and permission_code='pos_fnb.manage_tables') $$;
    create policy staff_table_insert_rpc_only on restaurant_tables as restrictive for insert to authenticated
      with check ((select public._staff_direct_table_write_allowed()));
    create policy staff_table_update_rpc_only on restaurant_tables as restrictive for update to authenticated
      using ((select public._staff_direct_table_write_allowed())) with check ((select public._staff_direct_table_write_allowed()));
    create policy staff_table_delete_rpc_only on restaurant_tables as restrictive for delete to authenticated
      using ((select public._staff_direct_table_write_allowed()));
    set role authenticated;`);
  assert.ok((await db.query("update restaurant_tables set name=name returning id")).rows.length>=2,
    "the old no-exception path permits a direct write without floor rights");
  await db.exec("reset role");
  await db.exec('alter policy staff_floor_update on floor_plan_zones rename to synthetic_changed_policy');
  await assert.rejects(db.exec(await file("20261114032000_staff_floor_branch_direct_guard.sql")),/FLOOR_WRITE_POLICIES_CHANGED/,
    'the migration must stop if existing write policies have changed');
  await db.exec('rollback; alter policy synthetic_changed_policy on floor_plan_zones rename to staff_floor_update');
  await db.exec(await file("20261114032000_staff_floor_branch_direct_guard.sql"));
  await db.exec("set role authenticated");
  for (const [table, allowed] of [["restaurant_tables",id(810)],["floor_plan_zones",id(800)],["floor_plan_decorations",id(820)]]) {
    assert.deepEqual((await db.query(`select id from ${table} order by id`)).rows.map(row=>row.id),[allowed],
      `${table}: assigned branch remains readable, other branch hidden`);
    assert.equal((await db.query(`update ${table} set id=id returning id`)).rows.length,0,
      `${table}: direct writes are denied even without branch exceptions`);
    assert.equal((await db.query(`delete from ${table} returning id`)).rows.length,0,
      `${table}: direct deletes are denied even without branch exceptions`);
  }
  for (const sql of [
    `insert into floor_plan_zones(id,tenant_id,branch_id,name) values('${id(850)}','${id(1)}','${id(10)}','Direct')`,
    `insert into restaurant_tables(id,tenant_id,branch_id,table_number,name) values('${id(851)}','${id(1)}','${id(10)}',99,'Direct')`,
    `insert into floor_plan_decorations(id,tenant_id,branch_id,zone_id,kind) values('${id(852)}','${id(1)}','${id(10)}','${id(800)}','plant')`,
  ]) await assert.rejects(db.query(sql),/row-level security/);
  await db.exec('reset role');
  await db.exec('alter policy staff_floor_branch_read on floor_plan_zones rename to synthetic_changed_read_policy');
  await assert.rejects(db.exec(await file('20261114033000_staff_floor_view_scope.sql')),/STAFF_FLOOR_READ_POLICY_CHANGED/,
    'the new migration must fail closed if an existing read policy has drifted');
  await db.exec('rollback; alter policy synthetic_changed_read_policy on floor_plan_zones rename to staff_floor_branch_read');
  await db.exec(await file('20261114033000_staff_floor_view_scope.sql'));
  const permissionParity = async () => {
    const result = await db.query(`select c.code from unnest(array[
      'reports.view_all_branches','floor_plan.edit_global','orders.print','invoices.print',
      'system.manage_branches','products.view','products.edit','floor_plan.view','floor_plan.edit_branch',
      'pos_fnb.send_kitchen','pos_fnb.checkout','pos_fnb.view_orders','pos_fnb.manage_tables']::text[]) c(code)
      join public.profiles p on p.id=$1
      where public.user_has_permission(p.id,c.code) is distinct from
       (p.role='owner' or exists(select 1 from public.get_user_effective_permissions(p.id) x where x.permission_code=c.code))`,[id(101)]);
    assert.deepEqual(result.rows, [], 'bulk permission set must match the existing permission helper');
  };
  await permissionParity();
  await db.exec('set role authenticated');
  assert.deepEqual((await db.query('select id from restaurant_tables')).rows, [],
    'without floor or an independent operational permission, direct reads are denied');
  await db.exec(`reset role;
    insert into user_branches(user_id,branch_id) values('${id(101)}','${id(11)}');
    insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
      values('${id(1)}','${id(101)}','${id(11)}','floor_plan.view','grant','${id(100)}');
    set role authenticated;`);
  assert.deepEqual((await db.query('select distinct branch_id from restaurant_tables order by branch_id')).rows.map(row=>row.branch_id),[id(11)],
    'a branch-only view grant does not give floor data at other assigned branches');
  await db.exec(`reset role;
    delete from user_branches where user_id='${id(101)}' and branch_id='${id(11)}';
    set role authenticated;`);
  assert.deepEqual((await db.query('select id from restaurant_tables')).rows, [],
    'a stale branch grant cannot give access after the branch assignment is removed');
  await db.exec(`reset role;
    insert into user_branches(user_id,branch_id) values('${id(101)}','${id(11)}');
    insert into role_permissions values('${id(20)}','floor_plan.view');
    insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
      values('${id(1)}','${id(101)}','${id(10)}','floor_plan.view','revoke','${id(100)}');
    set role authenticated;`);
  assert.deepEqual((await db.query('select distinct branch_id from restaurant_tables order by branch_id')).rows.map(row=>row.branch_id),[id(11)],
    'branch revocation overrides the view permission inherited from a role');
  await db.exec(`reset role;
    insert into staff_branch_permission_catalog(permission_code,enforcement_version) values('pos_fnb.send_kitchen',1);
    insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
      values('${id(1)}','${id(101)}','${id(10)}','pos_fnb.send_kitchen','grant','${id(100)}');
    set role authenticated;`);
  assert.deepEqual((await db.query('select distinct branch_id from restaurant_tables order by branch_id')).rows.map(row=>row.branch_id),[id(10),id(11)],
    'POS keeps its table data independently of a floor view grant');
  await db.exec(`reset role;
    insert into user_permission_overrides(tenant_id,user_id,permission_code,override_type)
      values('${id(1)}','${id(101)}','floor_plan.view','revoke');
    set role authenticated;`);
  assert.deepEqual((await db.query('select distinct branch_id from restaurant_tables order by branch_id')).rows.map(row=>row.branch_id),[id(10)],
    'a global view revoke overrides a branch view grant but does not revoke POS');
  for (const table of ['floor_plan_zones','floor_plan_decorations']) {
    assert.deepEqual((await db.query(`select distinct branch_id from ${table} order by branch_id`)).rows.map(row=>row.branch_id),[id(10)],
      `${table}: global view revoke and the POS alternative follow the same branch scope`);
  }
  await db.exec('reset role');
  await permissionParity();
  await db.exec(`
    delete from user_branch_permission_overrides where user_id='${id(101)}' and permission_code='pos_fnb.send_kitchen';
    insert into role_permissions values('${id(20)}','products.view');
    set role authenticated;`);
  assert.deepEqual((await db.query('select distinct branch_id from restaurant_tables order by branch_id')).rows.map(row=>row.branch_id),[id(10),id(11)],
    'product setup keeps its independent assigned-branch table reads');
  for (const printCode of ['orders.print','invoices.print']) {
    await db.exec(`reset role;
      delete from role_permissions where role_id='${id(20)}' and permission_code in ('products.view','orders.print','invoices.print');`);
    await db.query('insert into role_permissions values($1,$2)',[id(20),printCode]);
    await db.exec('set role authenticated');
    assert.deepEqual((await db.query('select distinct branch_id from restaurant_tables order by branch_id')).rows.map(row=>row.branch_id),[id(10),id(11)],
      `${printCode}: legacy printing retains assigned-branch table reads even if view is revoked`);
  }
  await db.exec(`reset role;
    delete from user_branch_permission_overrides where user_id='${id(101)}' and permission_code in ('floor_plan.view','pos_fnb.send_kitchen');
    delete from user_permission_overrides where user_id='${id(101)}' and permission_code='floor_plan.view';
    delete from role_permissions where role_id='${id(20)}' and permission_code='products.view';
    delete from role_permissions where role_id='${id(20)}' and permission_code='orders.print';
    delete from role_permissions where role_id='${id(20)}' and permission_code='invoices.print';
    delete from role_permissions where role_id='${id(20)}' and permission_code='floor_plan.view';
    delete from user_branches where user_id='${id(101)}' and branch_id='${id(11)}';
    set role authenticated;`);
  await db.exec(`reset role; insert into role_permissions values('${id(20)}','floor_plan.edit_global'); set role authenticated;`);
  assert.ok((await db.query('select id from restaurant_tables order by id')).rows.some(row=>row.id===id(811)),
    'existing global floor editor can read the other branch');
  assert.equal((await db.query('update restaurant_tables set name=name returning id')).rows.length,0,
    'global editor writes through the checked RPC, not raw tables');
  const viaRpc=(await db.query("select fnb_floor_zone_config_atomic('create',$1,'{\"name\":\"RPC after guard\"}') v",[id(10)])).rows[0].v;
  assert.ok(viaRpc.ok,'global editor can still save using the existing checked RPC');
  await db.exec(`reset role; delete from role_permissions where permission_code='floor_plan.edit_global';
    insert into role_permissions values('${id(20)}','reports.view_all_branches'); set role authenticated;`);
  assert.ok((await db.query('select id from restaurant_tables order by id')).rows.some(row=>row.id===id(811)),
    'existing company reporting read remains available');
  await db.exec(`reset role; delete from role_permissions where permission_code='reports.view_all_branches';
    insert into role_permissions values('${id(20)}','floor_plan.edit_branch'); set role authenticated;`);
  const branchRpc=(await db.query("select fnb_floor_zone_config_atomic('create',$1,'{\"name\":\"Branch RPC\"}') v",[id(10)])).rows[0].v;
  assert.ok(branchRpc.ok,'branch editor retains the checked RPC at their assigned branch');
  await assert.rejects(db.query("select fnb_floor_zone_config_atomic('create',$1,'{\"name\":\"Other branch\"}')",[id(11)]),denied);
  // Compare the optimized candidate filter with the authoritative scope helper
  // for every relevant role/global/branch grant and revoke combination.
  await db.exec(`reset role;
    delete from role_permissions where role_id='${id(20)}' and permission_code='floor_plan.edit_branch';
    insert into user_branches(user_id,branch_id) values('${id(101)}','${id(11)}');
    insert into staff_branch_permission_catalog(permission_code,enforcement_version)
      select c,1 from unnest(array['floor_plan.view','floor_plan.edit_branch','pos_fnb.send_kitchen',
        'pos_fnb.checkout','pos_fnb.view_orders','pos_fnb.manage_tables']) c on conflict do nothing;`);
  const scopedCodes=['floor_plan.view','floor_plan.edit_branch','pos_fnb.send_kitchen',
    'pos_fnb.checkout','pos_fnb.view_orders','pos_fnb.manage_tables'];
  for (const code of scopedCodes) for (const roleGrant of [false,true])
    for (const globalChoice of ['inherit','grant','revoke']) for (const branchChoice of ['inherit','grant','revoke']) {
      await db.query('delete from role_permissions where role_id=$1 and permission_code=$2',[id(20),code]);
      await db.query('delete from user_permission_overrides where user_id=$1 and permission_code=$2',[id(101),code]);
      await db.query('delete from user_branch_permission_overrides where user_id=$1 and permission_code=$2',[id(101),code]);
      if(roleGrant) await db.query('insert into role_permissions values($1,$2)',[id(20),code]);
      if(globalChoice!=='inherit') await db.query('insert into user_permission_overrides(tenant_id,user_id,permission_code,override_type) values($1,$2,$3,$4)',[id(1),id(101),code,globalChoice]);
      if(branchChoice!=='inherit') await db.query('insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values($1,$2,$3,$4,$5,$6)',[id(1),id(101),id(10),code,branchChoice,id(100)]);
      const expected=(await db.query('select public._staff_permission_at_scope($1,$2,$3) as ok',[id(101),code,id(10)])).rows[0].ok;
      const actual=(await db.query('select $1::uuid=any(public._staff_floor_readable_branches()) as ok',[id(10)])).rows[0].ok;
      assert.equal(actual,expected,`${code}: role=${roleGrant}, global=${globalChoice}, branch=${branchChoice}`);
    }
  await db.exec(`delete from role_permissions where role_id='${id(20)}' and permission_code=any(array['floor_plan.view','floor_plan.edit_branch','pos_fnb.send_kitchen','pos_fnb.checkout','pos_fnb.view_orders','pos_fnb.manage_tables']);
    delete from user_permission_overrides where user_id='${id(101)}' and permission_code=any(array['floor_plan.view','floor_plan.edit_branch','pos_fnb.send_kitchen','pos_fnb.checkout','pos_fnb.view_orders','pos_fnb.manage_tables']);
    delete from user_branch_permission_overrides where user_id='${id(101)}' and permission_code=any(array['floor_plan.view','floor_plan.edit_branch','pos_fnb.send_kitchen','pos_fnb.checkout','pos_fnb.view_orders','pos_fnb.manage_tables']);
    set role authenticated;`);
  await db.exec(`reset role; update profiles set is_active=false where id='${id(101)}'; set role authenticated;`);
  assert.deepEqual((await db.query('select id from restaurant_tables')).rows,[],'inactive user cannot read floor data');
  await db.exec('reset role');
  console.log(
    "PASS: floor RPC authorization, branch-isolated reads, direct DML denial, global editor/report scope and compatibility.",
  );
} finally {
  await db.close();
}
