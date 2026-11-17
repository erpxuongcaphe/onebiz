import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const migration = new URL("../supabase/migrations/20261117044054_retail_draft_recovery.sql", import.meta.url);

try {
  // The fixture supplies the existing authorization and child-creation contracts.
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create schema private;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table profiles(id uuid primary key, tenant_id uuid, is_active boolean);
    create table invoices(id uuid primary key, tenant_id uuid, branch_id uuid, code text,
      source text, status text, deleted_at timestamptz, source_order_id uuid,
      client_session_id uuid, draft_revision integer default 0);
    create table invoice_items(id uuid primary key, invoice_id uuid, product_id uuid, variant_id uuid,
      product_name text, unit text, quantity numeric, unit_price numeric, discount numeric,
      total numeric, note text, transaction_unit text, transaction_quantity numeric,
      transaction_unit_price numeric);
    create function get_user_tenant_id() returns uuid language sql stable as
      $$ select tenant_id from public.profiles where id = auth.uid() $$;
    create function _can_read_branch_inventory_00476(actor uuid, tenant uuid, branch uuid)
    returns boolean language sql stable as $$ select actor = '${id(1)}' AND branch = '${id(10)}' $$;
    create function _staff_invoice_item_legacy_scope() returns boolean language sql stable as $$ select false $$;
    create function _staff_invoice_item_read(uuid, uuid, text) returns boolean language sql stable as
      $$ select $2 = '${id(10)}' and $3 = 'pos' $$;
    create function user_has_branch_access(uuid, uuid) returns boolean language sql stable as
      $$ select $1 = '${id(1)}' and $2 = '${id(10)}' $$;
    create function _staff_permission_at_scope(uuid, text, uuid) returns boolean language sql stable as
      $$ select public.user_has_branch_access($1, $3) and $2 = 'pos_retail.checkout' $$;
    create function _staff_order_owner_unrestricted() returns boolean language sql stable as $$ select false $$;
    create function _staff_order_target_visible(uuid) returns boolean language sql stable as
      $$ select $1 = '${id(20)}' and auth.uid() = '${id(1)}' $$;

    insert into profiles values ('${id(1)}','${id(100)}',true), ('${id(2)}','${id(100)}',true),
      ('${id(3)}','${id(101)}',true);
    insert into invoices (id, tenant_id, branch_id, code, source, status) values
      ('${id(20)}', '${id(100)}', '${id(10)}', 'DH-TEST', 'order', 'draft');

    create function create_child_sale_from_order(p_order_id uuid) returns jsonb language plpgsql as $$
    declare child uuid := gen_random_uuid(); session uuid := gen_random_uuid();
    begin
      insert into public.invoices (id, tenant_id, branch_id, code, source, status, source_order_id, client_session_id)
      select child, i.tenant_id, i.branch_id, 'NH-TEST', 'pos', 'draft', i.id, session
      from public.invoices i where i.id = p_order_id;
      insert into public.invoice_items (id, invoice_id, product_name, quantity, transaction_unit, transaction_quantity)
      values (gen_random_uuid(), child, 'Hàng thử', 24, 'Thùng', 1);
      return jsonb_build_object('child_id', child, 'child_code', 'NH-TEST', 'client_session_id', session,
        'draft_revision', 0, 'item_count', 1, 'source_order_id', p_order_id, 'source_order_code', 'DH-TEST');
    end $$;
  `);
  await db.exec(await readFile(migration, "utf8"));

  const actAs = async (actor) => {
    await db.exec(`reset role; set request.jwt.claim.sub = '${actor}'; set role authenticated;`);
  };
  const open = async (request) => (await db.query(
    "select open_retail_order_draft($1, $2) as draft", [id(20), request],
  )).rows[0].draft;
  const read = (draft, branch = id(10)) => db.query(
    "select product_name, quantity, transaction_unit, transaction_quantity from read_retail_draft_lines($1, $2)",
    [draft, branch],
  );

  await actAs(id(1));
  const original = await open(id(31));
  const retried = await open(id(31));
  assert.deepEqual(retried, original);
  const nextDelivery = await open(id(32));
  assert.notEqual(nextDelivery.child_id, original.child_id);
  assert.deepEqual((await read(original.child_id)).rows, [{
    product_name: "Hàng thử", quantity: "24", transaction_unit: "Thùng", transaction_quantity: "1",
  }]);
  await assert.rejects(read(original.child_id, id(11)), { code: "42501" });
  await assert.rejects(read(id(20)), { code: "42501" });

  await actAs(id(2));
  await assert.rejects(read(original.child_id), { code: "42501" });
  await assert.rejects(open(id(31)), { code: "42501" });
  await actAs(id(3));
  await assert.rejects(read(original.child_id), { code: "42501" });
  await assert.rejects(open(id(31)), { code: "42501" });
  await db.exec("reset role; set role anon");
  await assert.rejects(read(original.child_id), { code: "42501" });
  await assert.rejects(open(id(31)), { code: "42501" });

  await db.exec("reset role");
  await db.query("update invoices set deleted_at = now() where id = $1", [original.child_id]);
  await actAs(id(1));
  await assert.rejects(open(id(31)), { code: "P0002" });
  await db.exec("reset role");
  assert.equal((await db.query("select count(*)::int as n from invoices where source = 'pos'")).rows[0].n, 2);
  console.log("Retail draft recovery: retry, separate delivery, quantity/UOM, branch/tenant/anon, deleted draft");
} finally {
  await db.close();
}
