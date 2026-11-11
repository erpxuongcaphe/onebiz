import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { functionFromMigration } from "./inventory.mjs";
export async function verifyRetailCheckoutScope(db, { id, migration }) {
  await db.exec(`
 create table sales_orders(id uuid,tenant_id uuid,branch_id uuid);
 create table cash_transactions(id uuid,tenant_id uuid,branch_id uuid,reference_type text,reference_id uuid);
 create function can_write_branch_document_00567(uuid,uuid) returns boolean language sql as $$select public.user_has_branch_access(auth.uid(),$2)$$;
 insert into sales_orders values('${id(360)}','${id(1)}','${id(10)}');
 insert into shifts values('${id(361)}','${id(1)}','${id(10)}','${id(101)}');
 insert into role_permissions values('${id(20)}','pos_retail.checkout');
 `);
  const defs = [
    [
      "00381_allow_customer_credit_on_sales_return.sql",
      "_create_sales_return_auth_impl_00244",
    ],
    [
      "00244_atomic_sales_return.sql",
      "create_sales_return_atomic",
      "_create_sales_return_auth_impl_00244_pre_00381",
    ],
    [
      "20261027005706_internal_customer_canonical_identity.sql",
      "_pos_balance_before_identity_20261027",
    ],
    [
      "00254_harden_invoice_shipping_atomic.sql",
      "attach_invoice_shipment_atomic",
    ],
    ["00567_transaction_branch_boundaries.sql", "cleanup_expired_auto_drafts"],
    ["00203_pos_stock_integrity.sql", "complete_draft_atomic_v3"],
    ["00253_harden_retail_pos_pricing.sql", "complete_draft_atomic_v4"],
    ["00292_pos_draft_revision_guard.sql", "complete_draft_atomic_v5"],
    [
      "00270_atomic_legacy_sales_order_state.sql",
      "complete_legacy_sales_order_atomic",
    ],
    ["00331_child_sales_source_order.sql", "create_child_sale_from_order"],
    ["00537_walk_in_customer_identity.sql", "get_or_create_walk_in_customer"],
    [
      "20261027005706_internal_customer_canonical_identity.sql",
      "get_pos_retail_customer_contacts_identity",
    ],
    ["00374_split_retail_fnb_open_shift_permissions.sql", "open_shift_atomic"],
    ["00203_pos_stock_integrity.sql", "pos_complete_checkout_atomic_v2"],
    ["00253_harden_retail_pos_pricing.sql", "pos_complete_checkout_atomic_v3"],
    [
      "20261111070229_staff_branch_checkout_permissions.sql",
      "_staff_checkout_write_allowed",
    ],
    [
      "20261111095224_staff_branch_kitchen_permissions.sql",
      "_staff_permission_any_branch",
    ],
  ];
  for (const [file, name, renamed] of defs) {
    let sql = await functionFromMigration(file, name);
    if (renamed) sql = sql.replace(`public.${name}(`, `public.${renamed}(`);
    await db.exec(sql);
  }
  // Private readers: minimal published contracts, optionally replaced below
  // with private read-only exports. No private definitions are committed.
  await db.exec(`drop function get_document_payment_history_scoped(text,uuid,integer,integer);
 create function get_document_payment_history_scoped(p_reference_type text,p_reference_id uuid,p_offset integer default 0,p_limit integer default 500) returns jsonb language plpgsql as $$declare v_actor uuid:=auth.uid();v_branch uuid;begin select branch_id into v_branch from invoices where id=p_reference_id;if not public.user_has_permission(v_actor,'pos_retail.checkout') then raise exception 'PAYMENT_HISTORY_DENIED';end if;return '{}';end$$;
 create function get_open_shift_status_scoped(p_branch_id uuid) returns jsonb language plpgsql as $$begin if not public.user_has_permission(auth.uid(),'pos_retail.checkout') then raise exception 'SHIFT_STATUS_DENIED';end if;return '{}';end$$;
 create function get_pos_customer_contacts_scoped(p_branch_id uuid,p_search text default null,p_customer_id uuid default null,p_internal boolean default false,p_limit integer default 10) returns jsonb language plpgsql as $$begin if not public.user_has_permission(auth.uid(),'pos_retail.checkout') then raise exception 'POS_CONTACT_PERMISSION_DENIED';end if;return '[]';end$$;
 create function get_shift_context_scoped(p_shift_id uuid) returns jsonb language plpgsql as $$declare v_actor uuid:=auth.uid();v_shift shifts;begin select * into v_shift from shifts where id=p_shift_id;if not public.user_has_permission(v_actor,'pos_retail.checkout') then raise exception 'SHIFT_CONTEXT_DENIED';end if;return '{}';end$$;
 create function get_shift_records_scoped(p_kind text,p_branch_id uuid default null,p_offset integer default 0,p_limit integer default 200) returns jsonb language plpgsql as $$begin if not public.user_has_permission(auth.uid(),'pos_retail.checkout') then raise exception 'SHIFT_RECORDS_DENIED';end if;return '{}';end$$;
 create function open_shift_operational(p_branch_id uuid,p_starting_cash numeric default 0,p_channel text default 'fnb') returns jsonb language plpgsql as $$declare v_actor uuid:=auth.uid();begin if not (case p_channel when 'fnb' then public._staff_permission_at_scope(v_actor,'pos_fnb.checkout',p_branch_id) else public.user_has_permission(v_actor,'pos_retail.checkout') end) then raise exception 'SHIFT_OPEN_DENIED';end if;return public.open_shift_atomic(p_branch_id,p_starting_cash);end$$;
 create function request_manager_approval_00566(p_action text,p_meta jsonb,p_reason text) returns jsonb language plpgsql as $$declare a uuid:=auth.uid();b uuid;view_perm text;required text;begin if not public._staff_permission_at_scope(a,view_perm,b) and not public._staff_permission_at_scope(a,required,b) then raise exception 'APPROVAL_PERMISSION_DENIED';end if;return '{}';end$$;`);
  if (process.env.ONEBIZ_RETAIL_CHECKOUT_AUDIT_FILE) {
    const actual = JSON.parse(
      await readFile(process.env.ONEBIZ_RETAIL_CHECKOUT_AUDIT_FILE, "utf8"),
    );
    const privateNames = [
      "get_document_payment_history_scoped",
      "get_open_shift_status_scoped",
      "get_pos_customer_contacts_scoped",
      "get_shift_context_scoped",
      "get_shift_records_scoped",
      "open_shift_operational",
    ];
    for (const name of [
      ...defs
        .filter((x) => !x[0].startsWith("202611"))
        .map((x) => x[2] ?? x[1]),
      ...privateNames,
    ]) {
      const f = actual.find((x) => x.proname === name);
      assert.ok(f, name);
      let sql = f.definition;
      if (name === "open_shift_operational")
        sql = sql.replace(
          "public.user_has_permission(v_actor,case p_channel when 'fnb' then 'pos_fnb.checkout' else 'pos_retail.checkout' end)",
          "(case p_channel when 'fnb' then public._staff_permission_at_scope(v_actor,'pos_fnb.checkout',p_branch_id) else public.user_has_permission(v_actor,'pos_retail.checkout') end)",
        );
      await db.exec(sql);
    }
  }
  await db.exec(
    await migration("20261111144638_staff_branch_retail_checkout.sql"),
  );
  await db.exec(`insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values
 ('${id(1)}','${id(101)}','${id(10)}','pos_retail.checkout','revoke','${id(100)}'),
 ('${id(1)}','${id(101)}','${id(11)}','pos_retail.checkout','grant','${id(100)}');`);
  const q = (sql, args) => () => db.query(sql, args);
  const calls = [
    q("select _create_sales_return_auth_impl_00244($1,'[]',0)", [id(302)]),
    q("select _create_sales_return_auth_impl_00244_pre_00381($1,'[]',0)", [
      id(302),
    ]),
    q("select _pos_balance_before_identity_20261027($1,$2)", [id(400), id(10)]),
    q("select attach_invoice_shipment_atomic($1,0)", [id(302)]),
    q("select complete_draft_atomic_v3($1,'cash',0)", [id(300)]),
    q("select complete_draft_atomic_v4($1,null,'[]','cash',0)", [id(300)]),
    q("select complete_draft_atomic_v5($1,null,'[]','cash',0)", [id(300)]),
    q("select complete_legacy_sales_order_atomic($1)", [id(360)]),
    q("select create_child_sale_from_order($1)", [id(300)]),
    q("select get_document_payment_history_scoped('invoice',$1)", [id(302)]),
    q("select get_open_shift_status_scoped($1)", [id(10)]),
    q("select get_pos_customer_contacts_scoped($1)", [id(10)]),
    q("select get_pos_retail_customer_contacts_identity($1)", [id(10)]),
    q("select get_shift_context_scoped($1)", [id(361)]),
    q("select get_shift_records_scoped('history',$1)", [id(10)]),
    q("select open_shift_atomic($1,0)", [id(10)]),
    q("select open_shift_operational($1,0,'retail')", [id(10)]),
    q("select pos_complete_checkout_atomic_v2($1)", [id(10)]),
    q("select pos_complete_checkout_atomic_v3($1)", [id(10)]),
  ];
  for (const call of calls)
    await assert.rejects(
      call(),
      /DENIED|INSUFFICIENT_PERMISSION|khong co quyen/,
    );
  // Actual bulk cleanup must affect only the permitted branch, even though the
  // account has legacy global checkout. Removing that global right still works.
  await db.exec(`update invoices set updated_at=now()-interval '45 days' where id='${id(300)}';
 insert into invoices(id,tenant_id,branch_id,status,source,auto_saved,updated_at) values('${id(370)}','${id(1)}','${id(11)}','draft','pos',true,now()-interval '45 days');`);
  assert.equal(
    (await db.query("select cleanup_expired_auto_drafts($1,30) n", [id(1)]))
      .rows[0].n,
    1,
  );
  assert.equal(
    (await db.query("select deleted_at from invoices where id=$1", [id(300)]))
      .rows[0].deleted_at,
    null,
  );
  await db.exec(
    "delete from role_permissions where permission_code='pos_retail.checkout'",
  );
  // Explicit boundary sentinel: exercises the real v2 wrapper with a local-only
  // grant, without claiming that this sentinel validates cash/stock accounting.
  await db.exec(`create table retail_delegate_calls(branch_id uuid);
 create function assert_pos_stock_available(uuid,uuid,jsonb,boolean) returns void language sql as $$select$$;
 create function pos_complete_checkout_atomic(uuid,uuid,uuid,uuid,text,jsonb,text,jsonb,numeric,numeric,numeric,numeric,text,text,uuid,uuid,numeric,numeric,text)
 returns jsonb language plpgsql as $$begin insert into public.retail_delegate_calls values($2);return jsonb_build_object('branch_id',$2);end$$;`);
  assert.equal(
    (
      await db.query("select pos_complete_checkout_atomic_v2($1) result", [
        id(11),
      ])
    ).rows[0].result.branch_id,
    id(11),
  );
  await assert.rejects(
    db.query("select pos_complete_checkout_atomic_v2($1)", [id(10)]),
    /DENIED/,
  );
  assert.equal(
    (await db.query("select count(*)::int n from retail_delegate_calls"))
      .rows[0].n,
    1,
  );
  assert.equal(
    (await db.query("select cleanup_expired_auto_drafts($1,30) n", [id(1)]))
      .rows[0].n,
    0,
  );
  await db.exec(
    `insert into user_permission_overrides(tenant_id,user_id,permission_code,override_type) values('${id(1)}','${id(101)}','pos_retail.checkout','revoke');`,
  );
  await assert.rejects(
    db.query("select cleanup_expired_auto_drafts($1,30)", [id(1)]),
    /DENIED/,
  );
  await assert.rejects(
    db.query("select pos_complete_checkout_atomic_v2($1)", [id(11)]),
    /DENIED/,
  );
  assert.equal(
    (await db.query("select count(*)::int n from retail_delegate_calls"))
      .rows[0].n,
    1,
  );
  for (const table of ["cash_transactions", "shifts"])
    await db.exec(
      `alter table ${table} enable row level security;create policy legacy_test on ${table} to authenticated using(true) with check(true);grant select,insert,update,delete on ${table} to authenticated;`,
    );
  await db.query(
    "insert into cash_transactions(id,reference_type) values($1,'invoice')",
    [id(372)],
  );
  await db.exec("set role authenticated");
  await assert.rejects(
    db.query("insert into invoices(id) values($1)", [id(371)]),
    /row-level security/,
  );
  await assert.rejects(
    db.query(
      "insert into cash_transactions(id,reference_type) values($1,'invoice')",
      [id(373)],
    ),
    /row-level security/,
  );
  await assert.rejects(
    db.query("insert into shifts(id) values($1)", [id(374)]),
    /row-level security/,
  );
  assert.equal(
    (await db.query("update cash_transactions set id=id returning id")).rows
      .length,
    0,
  );
  assert.equal(
    (await db.query("delete from cash_transactions returning id")).rows.length,
    0,
  );
  assert.equal(
    (await db.query("update shifts set id=id returning id")).rows.length,
    0,
  );
  assert.equal(
    (await db.query("delete from shifts returning id")).rows.length,
    0,
  );
  await db.exec("reset role");
  console.log(
    "Retail checkout: 19 consumer denials, source-document scope, real per-row draft cleanup, local-only grant/global deny, and direct invoice write guard passed. Core cash/stock posting remains unchanged and separately tested.",
  );
}
