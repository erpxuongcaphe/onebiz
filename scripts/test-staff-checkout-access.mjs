// Isolated authorization tests: real public function bodies plus six explicitly marked private contract fixtures.
import { pathToFileURL } from "node:url";
const { PGlite } = await import(
  process.env.ONEBIZ_PGLITE_MODULE
    ? pathToFileURL(process.env.ONEBIZ_PGLITE_MODULE).href
    : "@electric-sql/pglite"
);
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { initializeStaffAccessFixture } from "./staff-access-tests/fixture.mjs";
const db = new PGlite();
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
let passed = 0;
try {
  await initializeStaffAccessFixture(db, id);
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/20261111052704_staff_branch_access.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(`create schema extensions;
 create table fnb_print_points(id uuid,tenant_id uuid,branch_id uuid,enabled boolean);
 create table fnb_print_jobs(id uuid);
 create table invoices(id uuid,code text,tenant_id uuid,branch_id uuid,customer_id uuid,customer_name text,status text,debt numeric,source text,shift_id uuid);
 create table invoice_items(id uuid,invoice_id uuid);
 create table cash_transactions(id uuid,reference_type text,reference_id uuid);
 create table shifts(id uuid default gen_random_uuid(),tenant_id uuid,branch_id uuid,cashier_id uuid,status text,starting_cash numeric,opened_at timestamptz default now());
 create function can_read_branch_document_00567(uuid,uuid) returns boolean language sql as $$select true$$;
 insert into role_permissions values('${id(20)}','pos_fnb.checkout');
 insert into user_branches values('${id(101)}','${id(11)}');
 insert into shifts(id,tenant_id,branch_id,cashier_id,status) values('${id(40)}','${id(1)}','${id(10)}','${id(101)}','open');
 insert into invoices values('${id(50)}','TEST','${id(1)}','${id(10)}',null,'Test','completed',0,'fnb','${id(40)}');
`);
  await (
    await import("./staff-access-tests/checkout-definitions.mjs")
  ).loadCheckoutDefinitions(db);
  if (process.env.ONEBIZ_FNB_PRINT_VIEW_AUDIT_FILE) {
    const definitions = JSON.parse(
      await readFile(process.env.ONEBIZ_FNB_PRINT_VIEW_AUDIT_FILE, "utf8"),
    );
    for (const name of ["_fnb_print_access_v1", "fnb_print_enqueue_v1"]) {
      const current = definitions.find((entry) => entry.proname === name);
      assert.ok(current, `${name} is available in the captured definitions`);
      await db.exec(current.definition);
    }
  }
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/20261111070229_staff_branch_checkout_permissions.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/20261112054235_staff_branch_fnb_print_view.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(`alter table fnb_print_points add column routes jsonb;
    alter table fnb_print_jobs add column tenant_id uuid,add column branch_id uuid,add column point_id uuid,
      add column actor_id uuid,add column actor_name text,add column label text,add column route_key text,
      add column route_label text,add column printer text,add column paper text,add column bytes_base64 text,
      add column payload_hash bytea,add column status text default 'queued';
    create function public.digest(bytea,text) returns bytea language sql immutable as $$select decode(md5(encode($1,'hex')),'hex')$$;
    insert into fnb_print_points values('${id(70)}','${id(1)}','${id(10)}',true,
      '[{"key":"cashier","paper":"80mm","printer":"Synthetic","label":"Cashier"}]');
    insert into staff_branch_permission_catalog values('pos_fnb.view_orders',1);
    select set_config('request.jwt.claim.sub','${id(101)}',false);
    insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values
    ('${id(1)}','${id(101)}','${id(10)}','pos_fnb.view_orders','revoke','${id(100)}');`);
  assert.equal(
    (await db.query(`select _fnb_print_access_v1('${id(10)}') value`)).rows[0]
      .value,
    id(1),
    "checkout independently retains print access",
  );
  await assert.rejects(
    db.query(
      `select fnb_print_enqueue_v1('${id(10)}',null,'cashier','Test','80mm','')`,
    ),
    /Thông tin phiếu không hợp lệ/,
  );
  const enqueue = (job) =>
    db.query(
      `select fnb_print_enqueue_v1('${id(10)}','${id(job)}','cashier','Test','80mm',encode(decode('1b401b6101' || repeat('00',20),'hex'),'base64'))`,
    );
  await enqueue(71);
  await enqueue(71);
  assert.equal(
    (await db.query("select count(*)::int n from fnb_print_jobs")).rows[0].n,
    1,
    "retry with the same job never creates a duplicate",
  );
  await db.exec(`insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values
    ('${id(1)}','${id(101)}','${id(10)}','pos_fnb.checkout','revoke','${id(100)}');
    update user_branch_permission_overrides set override_type='grant' where permission_code='pos_fnb.view_orders';`);
  assert.equal(
    (await db.query(`select _fnb_print_access_v1('${id(10)}') value`)).rows[0]
      .value,
    id(1),
    "branch-only order view independently retains print access",
  );
  await assert.rejects(
    db.query(
      `select fnb_print_enqueue_v1('${id(10)}',null,'cashier','Test','80mm','')`,
    ),
    /Thông tin phiếu không hợp lệ/,
  );
  await enqueue(72);
  await db.exec(
    `update user_branch_permission_overrides set override_type='revoke' where permission_code='pos_fnb.view_orders';`,
  );
  await assert.rejects(
    db.query(`select _fnb_print_access_v1('${id(10)}')`),
    /Không có quyền/,
  );
  await assert.rejects(
    db.query(
      `select fnb_print_enqueue_v1('${id(10)}',null,'cashier','Test','80mm','')`,
    ),
    /Không có quyền/,
  );
  await assert.rejects(enqueue(73), /Không có quyền/);
  assert.equal(
    (await db.query("select count(*)::int n from fnb_print_jobs")).rows[0].n,
    2,
    "denied print creates no job",
  );
  await db.exec(`delete from user_branch_permission_overrides where user_id='${id(101)}' and permission_code in ('pos_fnb.view_orders','pos_fnb.checkout');
    delete from staff_branch_permission_catalog where permission_code='pos_fnb.view_orders';`);
  console.log(
    "PASS: F&B print authorization preserves independent branch checkout/view rights and denies when neither applies",
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::integer n from staff_branch_permission_catalog where permission_code='pos_fnb.checkout'",
      )
    ).rows[0].n,
    1,
  );
  passed++;
  await db.exec(`
 insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values('${id(1)}','${id(101)}','${id(10)}','pos_fnb.checkout','revoke','${id(100)}');
 select set_config('request.jwt.claim.sub','${id(101)}',false);`);
  const calls = [
    [
      `select _create_sales_return_auth_impl_00244('${id(50)}','[]',0)`,
      /FNB_RETURN_CHECKOUT_DENIED/,
    ],
    [`select _fnb_print_access_v1('${id(10)}')`, /Không có quyền/],
    [
      `select _fnb_resolve_order_recipe_defaults_20261021('${id(30)}')`,
      /FNB_CHECKOUT_DENIED/,
    ],
    [`select fnb_buyer_lookup_v1('${id(10)}')`, /FNB_BUYER_PERMISSION_DENIED/],
    [
      `select fnb_complete_payment_atomic_v3('${id(30)}',null,'Test','cash',null,0,false)`,
      /FNB_CHECKOUT_DENIED/,
    ],
    [
      `select fnb_complete_payment_timed_v1('{"p_kitchen_order_id":"${id(30)}"}',now())`,
      /FNB_CHECKOUT_DENIED/,
    ],
    [`select fnb_open_shift_atomic('${id(10)}')`, /FNB_OPEN_SHIFT_DENIED/],
    [
      `select fnb_print_enqueue_v1('${id(10)}',null,'cashier','Test','80mm','')`,
      /Không có quyền/,
    ],
    [
      `select fnb_save_order_note_v1('${id(30)}','test','')`,
      /ORDER_NOTE_ACCESS_DENIED/,
    ],
    [
      `select fnb_select_order_customer_v1('${id(30)}',null)`,
      /CUSTOMER_SELECTION_PERMISSION_DENIED/,
    ],
    [
      `select get_document_payment_history_scoped('invoice','${id(50)}')`,
      /PAYMENT_HISTORY_DENIED/,
    ],
    [
      `select get_fnb_delivery_price_policy('${id(10)}')`,
      /DELIVERY_POLICY_PERMISSION_DENIED/,
    ],
    [`select get_open_shift_status_scoped('${id(10)}')`, /SHIFT_STATUS_DENIED/],
    [
      `select get_pos_customer_contacts_scoped('${id(10)}')`,
      /POS_CONTACT_PERMISSION_DENIED/,
    ],
    [
      `select get_pos_retail_customer_contacts_identity('${id(10)}')`,
      /POS_CONTACT_PERMISSION_DENIED/,
    ],
    [`select get_shift_context_scoped('${id(40)}')`, /SHIFT_CONTEXT_DENIED/],
    [
      `select get_shift_records_scoped('history','${id(10)}')`,
      /SHIFT_RECORDS_DENIED/,
    ],
    [`select open_shift_operational('${id(10)}')`, /SHIFT_OPEN_DENIED/],
    [
      `select fnb_complete_payment_atomic('${id(30)}',null,'Test','cash',null,0,0,null,'${id(101)}')`,
      /FNB_CHECKOUT_DENIED/,
    ],
    [
      `select fnb_complete_payment_atomic_v2('${id(30)}',null,'Test','cash',null,0,0,null,'${id(101)}')`,
      /FNB_CHECKOUT_DENIED/,
    ],
  ];
  for (const [sql, pattern] of calls) {
    try {
      await assert.rejects(db.query(sql), pattern);
      passed++;
    } catch (e) {
      console.error(sql);
      throw e;
    }
  }
  assert.equal(
    (await db.query(`select _fnb_print_access_v1('${id(11)}') value`)).rows[0]
      .value,
    id(1),
  );
  passed++;
  await db.exec(`delete from role_permissions where permission_code='pos_fnb.checkout';
 insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values('${id(1)}','${id(101)}','${id(11)}','pos_fnb.checkout','grant','${id(100)}');`);
  assert.equal(
    (await db.query(`select _fnb_print_access_v1('${id(11)}') value`)).rows[0]
      .value,
    id(1),
  );
  passed++;
  await db.query(`select fnb_open_shift_atomic('${id(11)}',0)`);
  assert.equal(
    (
      await db.query(
        `select count(*)::integer n from shifts where branch_id='${id(11)}' and cashier_id='${id(101)}'`,
      )
    ).rows[0].n,
    1,
  );
  passed++;
  // Exercise actual authenticated table writes, not only security-definer RPCs.
  await db.exec(`grant usage on schema public,auth to authenticated;
 grant select on profiles,user_branches,user_permission_overrides,role_permissions to authenticated;
 grant select,insert,update,delete on invoices,invoice_items,cash_transactions,shifts to authenticated;
 insert into invoices(id,tenant_id,branch_id,source) values('${id(51)}','${id(1)}','${id(11)}','fnb');
 insert into invoice_items values('${id(60)}','${id(50)}'),('${id(61)}','${id(51)}');
 insert into cash_transactions values('${id(70)}','invoice','${id(50)}'),('${id(71)}','invoice','${id(51)}');
 do $$declare t text;begin foreach t in array array['invoices','invoice_items','cash_transactions','shifts'] loop
 execute format('alter table %I enable row level security',t);
 execute format('create policy fixture_legacy_access on %I for all to authenticated using (true) with check (true)',t);
 end loop;end$$;
 set role authenticated;`);
  for (const sql of [
    `insert into invoices(id,tenant_id,branch_id,source) values('${id(52)}','${id(1)}','${id(10)}','fnb')`,
    `insert into invoice_items values('${id(62)}','${id(50)}')`,
    `insert into cash_transactions values('${id(72)}','invoice','${id(50)}')`,
    `insert into shifts(tenant_id,branch_id) values('${id(1)}','${id(10)}')`,
    `update invoices set branch_id='${id(10)}' where id='${id(51)}'`,
    `update invoice_items set invoice_id='${id(50)}' where id='${id(61)}'`,
    `update cash_transactions set reference_id='${id(50)}' where id='${id(71)}'`,
  ]) {
    await assert.rejects(db.query(sql), /row-level security/);
    passed++;
  }
  for (const [table, row] of [
    ["invoices", 50],
    ["invoice_items", 60],
    ["cash_transactions", 70],
    ["shifts", 40],
  ]) {
    assert.equal(
      (
        await db.query(
          `delete from ${table} where id='${id(row)}' returning id`,
        )
      ).rows.length,
      0,
    );
    passed++;
  }
  assert.equal(
    (
      await db.query(
        `update invoices set source='pos' where id='${id(50)}' returning id`,
      )
    ).rows.length,
    0,
  );
  passed++;
  await db.exec(`insert into invoices(id,tenant_id,branch_id,source) values('${id(53)}','${id(1)}','${id(11)}','fnb');
 insert into invoice_items values('${id(63)}','${id(53)}');
 insert into cash_transactions values('${id(73)}','invoice','${id(53)}');
 insert into shifts(tenant_id,branch_id) values('${id(1)}','${id(11)}');`);
  passed += 4;
  // Retail documents retain the original independent authorization behavior.
  await db.exec(`insert into invoices(id,tenant_id,branch_id,source) values('${id(54)}','${id(1)}','${id(10)}','pos');
 insert into invoice_items values('${id(64)}','${id(54)}');`);
  passed += 2;
  await db.exec(`reset role; delete from user_branch_permission_overrides where permission_code='pos_fnb.checkout'; set role authenticated;
 insert into invoices(id,tenant_id,branch_id,source) values('${id(55)}','${id(1)}','${id(10)}','fnb');`);
  passed++;
  await db.exec("reset role");
  console.log(
    `PASS ${passed} checkout authorization checks with real public functions and six private contract fixtures`,
  );
} catch (e) {
  console.error(e.message, e.where);
  process.exitCode = 1;
} finally {
  await db.close();
}
