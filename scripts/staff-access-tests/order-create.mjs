import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { functionFromMigration } from "./inventory.mjs";

export async function verifyOrderCreate(db, id) {
  await db.exec(`reset role;
    alter table invoices alter column id set default gen_random_uuid(),
      add column source text default 'order', add column fulfilled_by_id uuid, add column source_order_id uuid,
      add column customer_id uuid, add column customer_name text, add column subtotal numeric, add column discount_amount numeric,
      add column tax_amount numeric, add column delivery_fee numeric, add column total numeric,
      add column payment_method text, add column created_by uuid, add column auto_saved boolean;
    alter table shipping_orders add column created_at timestamptz default now(), add column shipping_fee numeric, add column cod_amount numeric,
      add column receiver_name text, add column receiver_phone text, add column receiver_address text, add column note text;
    alter table delivery_partners add column tenant_id uuid, add column is_active boolean;
    create table products(id uuid primary key,tenant_id uuid,name text,unit text,is_active boolean,product_type text);
    create table invoice_items(id uuid primary key default gen_random_uuid(),invoice_id uuid,product_id uuid,product_name text,unit text,
      quantity numeric,unit_price numeric,discount numeric,total numeric,note text,transaction_quantity numeric,transaction_unit text,transaction_unit_price numeric,conversion_factor numeric);
    create function resolve_product_uom_factor(uuid,uuid,text) returns numeric language sql as $$select 1::numeric$$;
    insert into products values ('${id(600)}','${id(1)}','Test product','Cái',true,'sku');
    create table sales_order_processing_closures(order_id uuid,closed_at timestamptz);
    create function can_read_branch_document_00567(uuid,uuid) returns boolean language sql stable as $$select $1=public.get_user_tenant_id() and public.user_has_branch_access(auth.uid(),$2)$$;
    insert into invoices(id,tenant_id,branch_id,code,status,paid,debt) values
      ('${id(214)}','${id(1)}','${id(11)}','B3','draft',0,0),
      ('${id(215)}','${id(1)}','${id(10)}','A3','draft',0,0),
      ('${id(216)}','${id(1)}','${id(13)}','C3','draft',0,0);
    insert into branches(id,tenant_id,name) values ('${id(13)}','${id(1)}','Other');
    delete from user_permission_overrides where permission_code='orders.cancel';
    delete from user_branch_permission_overrides;
    insert into staff_branch_permission_catalog values ('orders.create',1);
  `);
  await db.exec(
    await functionFromMigration(
      "20261111095224_staff_branch_kitchen_permissions.sql",
      "_staff_permission_any_branch",
    ),
  );
  const names = [
    [
      "00254_harden_invoice_shipping_atomic.sql",
      "attach_invoice_shipment_atomic",
    ],
    [
      "20261030092555_sales_order_processing_closure.sql",
      "close_sales_order_processing",
    ],
    [
      "20261030161847_sales_order_processing_bulk_close.sql",
      "close_sales_orders_processing",
    ],
    [
      "00270_atomic_legacy_sales_order_state.sql",
      "complete_legacy_sales_order_atomic",
    ],
    ["00334_child_sale_permission_scope.sql", "create_child_sale_from_order"],
    ["00266_atomic_invoice_duplicate.sql", "duplicate_invoice_to_order_atomic"],
    ["00358_order_finalization_audit.sql", "mark_order_processed"],
    [
      "20261030092555_sales_order_processing_closure.sql",
      "reopen_sales_order_processing",
    ],
    [
      "00294_fix_sales_order_receiver_validation.sql",
      "save_sales_order_atomic",
    ],
    [
      "00271_atomic_draft_invoice_edit_cancel.sql",
      "update_draft_invoice_atomic",
    ],
  ];
  const actual = process.env.ONEBIZ_ORDER_CANCEL_AUDIT_FILE
    ? JSON.parse(
        await readFile(process.env.ONEBIZ_ORDER_CANCEL_AUDIT_FILE, "utf8"),
      )
    : [];
  for (const [file, name] of names) {
    let source = actual.find((entry) => entry.proname === name)?.definition;
    if (process.env.ONEBIZ_ORDER_CANCEL_AUDIT_FILE) assert.ok(source, name);
    source ??= await functionFromMigration(file, name);
    if (
      name === "duplicate_invoice_to_order_atomic" &&
      !source.includes("if v_source.source='internal'")
    )
      source = source.replace(
        "select count(*)::integer into v_item_count",
        "if v_source.source='internal' and v_source.source_order_id is not null then raise exception 'INTERNAL_SOURCE'; end if; select count(*)::integer into v_item_count",
      );
    // Apply the already accepted Retail checkout prerequisite to shared RPCs.
    if (
      [
        "attach_invoice_shipment_atomic",
        "create_child_sale_from_order",
        "complete_legacy_sales_order_atomic",
      ].includes(name)
    ) {
      const key =
        name === "attach_invoice_shipment_atomic"
          ? "p_invoice_id"
          : "p_order_id";
      const table =
        name === "complete_legacy_sales_order_atomic"
          ? "sales_orders"
          : "invoices";
      source = source.replace(
        /user_has_permission\(v_actor,\s*'pos_retail\.checkout'\)/g,
        `_staff_permission_at_scope(v_actor,'pos_retail.checkout',(select i.branch_id from public.${table} i where i.id=${key} and i.tenant_id=public.get_user_tenant_id()))`,
      );
    }
    await db.exec(source);
  }
  await db.exec(
    await readFile(
      new URL(
        "../../supabase/migrations/20261112035730_staff_branch_order_create.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  for (const name of ["_staff_order_owner_unrestricted", "_staff_order_independent_branches"]) {
    await db.exec(await functionFromMigration("20261113004524_staff_own_order_scope.sql", name));
  }
  await db.exec(await readFile(new URL("../../supabase/migrations/20261113005650_staff_own_order_action_scope.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../../supabase/migrations/20261113012350_staff_legacy_order_owner_guard.sql", import.meta.url), "utf8"));
  const invoke =
    (sql, args = []) =>
    () =>
      db.query(sql, args);
  // Source documents are branch-protected even when no exception is configured.
  await assert.rejects(
    invoke("select duplicate_invoice_to_order_atomic($1,$2)", [id(216), id(11)]),
    /SOURCE_INVOICE_BRANCH_DENIED/,
  );
  await db.exec(`insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values
    ('${id(1)}','${id(101)}','${id(10)}','orders.create','revoke','${id(100)}');`);
  for (const [sql, args] of [
    [
      "select attach_invoice_shipment_atomic($1,-1,null,null,null,null,null)",
      [id(210)],
    ],
    ["select close_sales_order_processing($1,'test reason')", [id(215)]],
    ["select complete_legacy_sales_order_atomic($1)", [id(220)]],
    ["select create_child_sale_from_order($1)", [id(215)]],
    ["select duplicate_invoice_to_order_atomic($1,$2)", [id(214), id(10)]],
    ["select mark_order_processed($1,null)", [id(215)]],
    ["select reopen_sales_order_processing($1)", [id(215)]],
    [
      "select save_sales_order_atomic(null,null,$1,null,'[]',0,null,null,null,null,null)",
      [id(10)],
    ],
    ["select update_draft_invoice_atomic($1,'{}')", [id(210)]],
    [
      "select update_shipping_order_status_atomic($1,'in_transit',null)",
      [id(230)],
    ],
  ])
    await assert.rejects(invoke(sql, args), { code: "42501" });
  await assert.rejects(
    invoke("select close_sales_orders_processing($1,null,false)", [
      [id(214), id(215)],
    ]),
    { code: "42501" },
  );
  const b = (
    await db.query(
      "select close_sales_orders_processing($1,null,false) result",
      [[id(214)]],
    )
  ).rows[0].result;
  assert.equal(b.selected_count, 1);
  // Retail checkout is an independently authorized path to attach a shipment.
  await db.exec(
    `insert into role_permissions values ('${id(20)}','pos_retail.checkout');`,
  );
  await assert.rejects(
    invoke(
      "select attach_invoice_shipment_atomic($1,-1,null,null,null,null,null)",
      [id(210)],
    ),
    /SHIPMENT_FEE_INVALID/,
  );
  await db.exec(`delete from role_permissions where permission_code in ('orders.create','pos_retail.checkout');
    update user_branch_permission_overrides set branch_id='${id(11)}',override_type='grant' where permission_code='orders.create';`);
  const created = (
    await db.query(
      "select save_sales_order_atomic(null,'TEST-ORDER',$1,null,$2,0,null,null,null,null,null) result",
      [id(11), [{ product_id: id(600), quantity: 2, unit_price: 10000 }]],
    )
  ).rows[0].result;
  assert.equal(
    Number(
      (
        await db.query("select total from invoices where id=$1", [
          created.order_id,
        ])
      ).rows[0].total,
    ),
    20000,
  );
  assert.equal(
    Number(
      (
        await db.query(
          "select quantity from invoice_items where invoice_id=$1",
          [created.order_id],
        )
      ).rows[0].quantity,
    ),
    2,
  );
  assert.equal(
    (
      await db.query(
        "select close_sales_orders_processing($1,null,false) result",
        [[id(214)]],
      )
    ).rows[0].result.selected_count,
    1,
  );
  await assert.rejects(
    invoke("select close_sales_orders_processing($1,null,false)", [[id(215)]]),
    { code: "42501" },
  );
  await assert.rejects(
    invoke("select duplicate_invoice_to_order_atomic($1,$2)", [
      id(216),
      id(11),
    ]),
    /SOURCE_INVOICE_BRANCH_DENIED/,
  );
  await db.exec(
    `insert into user_permission_overrides(tenant_id,user_id,permission_code,override_type) values ('${id(1)}','${id(101)}','orders.create','revoke');`,
  );
  await assert.rejects(
    invoke("select close_sales_orders_processing($1,null,false)", [[id(214)]]),
    { code: "42501" },
  );
  assert.equal(
    (await db.query("select status from invoices where id=$1", [id(215)]))
      .rows[0].status,
    "draft",
  );
  await db.exec(`delete from user_permission_overrides where permission_code='orders.create';
    delete from user_branch_permission_overrides where permission_code='orders.create';
    delete from role_permissions where permission_code in ('orders.create','pos_retail.checkout','invoices.view');
    insert into role_permissions values ('${id(20)}','orders.create'),('${id(20)}','orders.view_own_only');
    update invoices set created_by='${id(101)}' where id='${id(214)}';
    update invoices set created_by='${id(100)}' where id='${id(215)}';`);
  await assert.rejects(invoke("select close_sales_orders_processing($1,null,false)", [[id(214),id(215)]]), /STAFF_OWN_ORDER_ACTION_DENIED/);
  assert.equal((await db.query("select close_sales_orders_processing($1,null,false) result", [[id(214)]])).rows[0].result.selected_count,1,'own order remains operable');
  await db.exec(`delete from user_permission_overrides where permission_code='orders.cancel';
    delete from user_branch_permission_overrides where permission_code='orders.cancel';
    insert into role_permissions values ('${id(20)}','orders.cancel');
    insert into sales_orders(id,tenant_id,branch_id,code,status,created_by) values
      ('${id(222)}','${id(1)}','${id(10)}','OWN','new','${id(101)}'),
      ('${id(223)}','${id(1)}','${id(10)}','OTHER','new','${id(100)}');`);
  await assert.rejects(invoke("select cancel_legacy_sales_order_atomic($1,'test reason')",[id(223)]), /STAFF_OWN_ORDER_ACTION_DENIED/);
  assert.equal((await db.query("select status from sales_orders where id=$1",[id(223)])).rows[0].status,"new",'denied cancellation has no effect');
  await db.query("select cancel_legacy_sales_order_atomic($1,'test reason')",[id(222)]);
  await db.exec(`insert into role_permissions values ('${id(20)}','pos_retail.checkout');`);
  await db.query("select cancel_legacy_sales_order_atomic($1,'test reason')",[id(223)]);
  assert.equal((await db.query("select close_sales_orders_processing($1,null,false) result", [[id(215)]])).rows[0].result.selected_count,1,'independent checkout preserves actual order flow');
  console.log(
    "PASS order create: all entry guards, independent retail path, mixed-branch batch and local-only grant.",
  );
}
