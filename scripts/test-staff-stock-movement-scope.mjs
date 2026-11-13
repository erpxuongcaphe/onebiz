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
const file = (name) =>
  readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
try {
  await initializeStaffAccessFixture(db, id);
  await db.exec(await file("20261111052704_staff_branch_access.sql"));
  for (const [migration, name] of [
    [
      "20261111070229_staff_branch_checkout_permissions.sql",
      "_staff_permission_at_scope",
    ],
    [
      "20261112011209_staff_branch_inventory_lot_read.sql",
      "_staff_inventory_row_visible",
    ],
  ])
    await db.exec(await functionFromMigration(migration, name));
  await db.exec(`alter function public.get_user_tenant_id() security definer;
  alter function public.user_has_permission(uuid,text) security definer;
  alter function public.user_has_branch_access(uuid,uuid) security definer;
  create table stock_movements(id uuid,tenant_id uuid,branch_id uuid,unit_cost numeric);
  insert into stock_movements values ('${id(40)}','${id(1)}','${id(10)}',100),('${id(41)}','${id(1)}','${id(11)}',200),('${id(42)}','${id(2)}','${id(12)}',300);
  insert into user_branches values('${id(101)}','${id(11)}',null);
  insert into role_permissions values('${id(20)}','inventory.view');
  insert into staff_branch_permission_catalog values('inventory.view',1),('reports.analytics',1);
  create function public._can_read_branch_inventory_00476(p_user uuid,p_tenant uuid,p_branch uuid) returns boolean language sql stable security definer set search_path=public as $$
   select p_tenant=get_user_tenant_id() and (user_has_branch_access(p_user,p_branch) or user_has_permission(p_user,'reports.view_all_branches')) $$;
  create view stock_movements_scoped with (security_barrier=true) as
   with _request_branch_candidates_20261029 as materialized (
    select distinct stock_movements.tenant_id,stock_movements.branch_id from stock_movements where tenant_id=(select get_user_tenant_id())
   ), _request_allowed_branches_20261029 as materialized (
    select _request_branch_candidates_20261029.tenant_id,_request_branch_candidates_20261029.branch_id
    from _request_branch_candidates_20261029 where _can_read_branch_inventory_00476((select auth.uid() as uid),_request_branch_candidates_20261029.tenant_id,_request_branch_candidates_20261029.branch_id)
   ) select t.id,t.tenant_id,t.branch_id,case when (select user_has_permission(auth.uid(),'products.view_cost')) then t.unit_cost else 0::numeric end unit_cost
    from stock_movements t where exists(select 1 from _request_allowed_branches_20261029 access where access.tenant_id=t.tenant_id and access.branch_id is not distinct from t.branch_id);
  alter table stock_movements enable row level security;
  create policy legacy_movement on stock_movements for select to authenticated using
    (tenant_id=get_user_tenant_id() and _can_read_branch_inventory_00476(auth.uid(),tenant_id,branch_id));
  grant usage on schema public,auth to authenticated;grant select on stock_movements_scoped to authenticated;
  grant select(id,tenant_id,branch_id) on stock_movements to authenticated;
  select set_config('request.jwt.claim.sub','${id(101)}',false);`);
  await db.exec(
    await file("20261112104123_staff_inventory_direct_stock_scope.sql"),
  );
  for (const name of ['_staff_lot_has_no_view_exception','_staff_inventory_row_visible'])
    await db.exec(await functionFromMigration('20261112121837_staff_inventory_global_revoke_guard.sql',name));
  await db.exec(await file('20261113063835_staff_stock_movements_direct_scope.sql'));
  await db.exec("set role authenticated");
  const read = async () =>
    (
      await db.query(
        "select id,unit_cost from stock_movements_scoped order by id",
      )
    ).rows;
  const readDirect = async () => (await db.query('select id from stock_movements order by id')).rows.map(row=>row.id);
  assert.deepEqual(await readDirect(),[id(40),id(41)],'existing column grants keep their old branch scope');
  assert.deepEqual(await read(), [
    { id: id(40), unit_cost: "0" },
    { id: id(41), unit_cost: "0" },
  ]);
  await db.exec(`reset role; insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values
  ('${id(1)}','${id(101)}','${id(10)}','inventory.view','revoke','${id(100)}'); set role authenticated;`);
  assert.deepEqual(await read(), [{ id: id(41), unit_cost: "0" }]);
  assert.deepEqual(await readDirect(),[id(41)],'raw column access respects the denied branch');
  await db.exec(
    `reset role; insert into role_permissions values('${id(20)}','reports.analytics'); set role authenticated;`,
  );
  assert.deepEqual(
    await read(),
    [
      { id: id(40), unit_cost: "0" },
      { id: id(41), unit_cost: "0" },
    ],
    "independent reporting retains its branch data without revealing costs",
  );
  assert.deepEqual(await readDirect(),[id(40),id(41)],'independent reporting scope is preserved on direct reads');
  await db.exec(`reset role; insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values
  ('${id(1)}','${id(101)}','${id(10)}','reports.analytics','revoke','${id(100)}'); set role authenticated;`);
  assert.deepEqual(await read(), [{ id: id(41), unit_cost: "0" }]);
  await db.exec(
    `reset role; insert into role_permissions values('${id(20)}','products.view_cost'); set role authenticated;`,
  );
  assert.deepEqual(
    await read(),
    [{ id: id(41), unit_cost: "0" }],
    "global cost denial remains stronger than a role grant",
  );
  await db.exec(
    `reset role; delete from user_permission_overrides where user_id='${id(101)}' and permission_code='products.view_cost'; set role authenticated;`,
  );
  assert.deepEqual(
    await read(),
    [{ id: id(41), unit_cost: "200" }],
    "cost permission remains independent of the branch filter",
  );
  await db.exec(`reset role; delete from role_permissions where permission_code in ('reports.analytics','inventory.view');
    delete from user_branch_permission_overrides where permission_code in ('reports.analytics','inventory.view');
    insert into user_permission_overrides(tenant_id,user_id,permission_code,override_type,created_by)
      values ('${id(1)}','${id(101)}','inventory.view','revoke','${id(100)}'); set role authenticated;`);
  assert.deepEqual(await readDirect(),[],'global inventory revoke cannot use the legacy direct read path');
  await assert.rejects(
    db.query("select * from stock_movements"),
    /permission denied/,
  );
  console.log(
    "PASS owner-backed stock movement view: scoped branches, independent reports, cost masking and raw table protection",
  );
} catch (e) {
  console.error(e.message, e.where ?? "");
  process.exitCode = 1;
} finally {
  await db.close();
}
