import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { functionFromMigration } from "./inventory.mjs";
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
export async function verifyCashScope(db) {
  await db.exec(`
 alter table profiles add column role text default 'staff';
 create table user_permission_overrides(tenant_id uuid,user_id uuid,permission_code text,override_type text);
 create table user_branch_permission_overrides(tenant_id uuid,user_id uuid,branch_id uuid,permission_code text,override_type text);
 create table staff_branch_permission_catalog(permission_code text primary key,enforcement_version integer);
 create table test_staff_permissions(code text primary key);
 insert into test_staff_permissions values('finance.create_transaction'),('finance.void_transaction'),('finance.view_cash_book'),('finance.view_cash_journal_company'),('customers.view_debt'),('suppliers.view_debt'),('inventory.internal_return_settle');
 create or replace function user_has_permission(uuid,text) returns boolean language sql stable as $$select exists(select 1 from public.test_staff_permissions where code=$2) and not exists(select 1 from public.user_permission_overrides where user_id=$1 and permission_code=$2 and override_type='revoke')$$;
 create or replace function user_has_branch_access(uuid,uuid) returns boolean language sql stable as $$select $1=public.test_id(1) and $2 in (public.test_id(3),public.test_id(4))$$;
 create function can_write_branch_document_00567(uuid,uuid) returns boolean language sql as $$select $1=public.get_user_tenant_id() and public.user_has_branch_access(auth.uid(),$2)$$;
 create function can_read_branch_document_00567(uuid,uuid) returns boolean language sql as $$select public.can_write_branch_document_00567($1,$2)$$;
 create schema if not exists private;
 create table private.cash_journal_post_requests(id uuid);
 create table cod_settlement_requests_v1(id uuid);
 create table internal_stock_returns(id uuid,tenant_id uuid,from_branch_id uuid,to_branch_id uuid,sale_id uuid);
 create table internal_stock_return_events(id uuid,return_id uuid,action text,refund_pending numeric,created_at timestamptz);
 create table internal_stock_return_requests(tenant_id uuid,request_id uuid,payload jsonb,result jsonb);
 create table internal_return_settlements(id uuid,event_id uuid,amount numeric,kind text,note text,created_at timestamptz,actor_id uuid,invoice_id uuid,cash_id uuid);
 create table internal_sales(id uuid,tenant_id uuid,from_branch_id uuid,to_branch_id uuid,status text,invoice_id uuid);
 insert into internal_stock_returns values('${id(710)}','${id(2)}','${id(4)}','${id(3)}',null);
 insert into internal_stock_return_events values('${id(711)}','${id(710)}','received',100,now());
 insert into invoices(id,tenant_id,branch_id,code,customer_id,customer_name,status,total,paid,debt) values('${id(700)}','${id(2)}','${id(3)}','Scoped-A','${id(5)}','Customer','completed',1000,0,1000),('${id(701)}','${id(2)}','${id(4)}','Scoped-B','${id(5)}','Customer','completed',1000,0,1000);
 insert into purchase_orders(id,tenant_id,branch_id,code,supplier_id,supplier_name,status,total,paid,debt) values('${id(702)}','${id(2)}','${id(3)}','Scoped-PO','${id(6)}','Supplier','completed',1000,0,1000);
 insert into cash_transactions(id,tenant_id,branch_id,code,status,type,amount) values('${id(703)}','${id(2)}','${id(3)}','Scoped-Cash','completed','receipt',100);
 insert into party_advance_refunds(tenant_id,request_id,branch_id,mode,party_id,advance_id,source_cash_id,cash_id,amount,request_payload,created_by) values('${id(2)}','${id(740)}','${id(3)}','customer','${id(5)}','${id(741)}','${id(703)}','${id(703)}',100,'{}','${id(1)}');
 create table shipping_settlements(id uuid,tenant_id uuid,code text,partner_id uuid,payment_method text,note text,created_by uuid,branch_id uuid,total_cod numeric,total_partner_fee numeric,net_amount numeric,fee_cash_tx_id uuid);
 create table shipping_orders(id uuid,tenant_id uuid,status text,code text,settlement_id uuid,partner_id uuid,invoice_id uuid,cod_amount numeric,cod_collected_at timestamptz,partner_fee numeric,updated_at timestamptz);
 insert into shipping_orders(id,tenant_id,status,code,invoice_id,cod_amount) values('${id(750)}','${id(2)}','delivered','COD-A','${id(700)}',50),('${id(751)}','${id(2)}','delivered','COD-B','${id(701)}',50);
 select set_config('test.actor','${id(1)}',false);select set_config('test.denied','',false);select set_config('test.branch_denied','',false);
 `);
  const defs = [
    ["20261111052704_staff_branch_access.sql", "user_has_permission_at_branch"],
    [
      "20261111070229_staff_branch_checkout_permissions.sql",
      "_staff_permission_at_scope",
    ],
    [
      "20261111095224_staff_branch_kitchen_permissions.sql",
      "_staff_permission_any_branch",
    ],
    ["00430_cod_cash_business_date.sql", "settle_cod_atomic"],
    [
      "20261110160400_internal_returns_two_party.sql",
      "get_internal_return_finance",
    ],
    [
      "20261110160400_internal_returns_two_party.sql",
      "settle_internal_return_credit",
    ],
    ["20261102045002_money_account_edit_delete.sql", "save_money_account"],
    ["20261102045002_money_account_edit_delete.sql", "delete_money_account"],
  ];
  for (const [file, name] of defs)
    await db.exec(await functionFromMigration(file, name));
  // Published authorization contracts for private journal/COD entry points;
  // local audit runs additionally load their actual exported definitions.
  await db.exec(`
 create function get_cash_journal_catalog_v1(p_branch_id uuid default null) returns jsonb language plpgsql as $$begin if not public.user_has_permission(auth.uid(),'finance.create_transaction') then raise exception 'JOURNAL_CATALOG_DENIED';end if;return '{}';end$$;
 create function get_cash_journal_operation_templates_v1(p_branch_id uuid) returns jsonb language plpgsql as $$begin if not public.user_has_permission(auth.uid(),'finance.create_transaction') then raise exception 'JOURNAL_TEMPLATE_DENIED';end if;return '{}';end$$;
 create function post_cash_journal_request(p_request_id uuid,p_branch_id uuid,p_operation text,p_payload jsonb,p_occurred_at timestamptz,p_transaction_date date,p_time_reason text default null,p_money_account_id uuid default null,p_performed_by uuid default null) returns jsonb language plpgsql as $$begin if not public.user_has_permission(auth.uid(),'finance.create_transaction') then raise exception 'JOURNAL_CASH_POST_DENIED';end if;return '{}';end$$;
 create function settle_cod_scoped_v1(p_request_id uuid,p_branch_id uuid,p_money_account_id uuid,p_partner_id uuid,p_items jsonb,p_payment_method text,p_note text default null) returns jsonb language plpgsql as $$begin if not public.user_has_permission(auth.uid(),'finance.create_transaction') then raise exception 'COD_DENIED';end if;return '{}';end$$;
 `);
  const sql = await readFile(
    new URL(
      "../../supabase/migrations/20261111145250_staff_branch_cash_permissions.sql",
      import.meta.url,
    ),
    "utf8",
  );
  if (process.env.ONEBIZ_CASH_AUDIT_FILE) {
    const actual = JSON.parse(
      await readFile(process.env.ONEBIZ_CASH_AUDIT_FILE, "utf8"),
    );
    const names = [...sql.matchAll(/\('([a-z_0-9]+)','/g)]
      .map((x) => x[1])
      .filter((x) => !x.startsWith("finance."));
    for (const name of new Set([
      ...names,
      "get_cash_journal_catalog_v1",
      "settle_cod_atomic",
      "save_money_account",
      "delete_money_account",
    ])) {
      const f = actual.find((x) => x.proname === name);
      assert.ok(f, name);
      await db.exec(f.definition);
    }
  }
  await db.exec(sql);
  for (const code of ["finance.create_transaction", "finance.void_transaction"])
    await db.query(
      "insert into user_branch_permission_overrides values($1,$2,$3,$4,'revoke'),($1,$2,$5,$4,'grant')",
      [id(2), id(1), id(3), code, id(4)],
    );
  const q =
    (sql, args = []) =>
    () =>
      db.query(sql, args);
  const payload = {
    branchId: id(4),
    referenceId: id(700),
    amount: 100,
    paymentMethod: "cash",
    note: "Scoped payment",
  };
  const calls = [
    q("select amend_party_cash($1,now(),$2,'{}','test reason')", [
      id(703),
      id(720),
    ]),
    q("select cancel_cash_transaction($1,'test reason')", [id(703)]),
    q("select cancel_party_advance_refund($1,'test reason')", [id(703)]),
    q("select apply_customer_advance_to_invoice($1,100,'test reason')", [
      id(700),
    ]),
    q("select apply_supplier_advance_to_purchase_order($1,100,'test reason')", [
      id(702),
    ]),
    q(
      "select create_manual_cash_transaction_atomic(null,$1,'receipt','other',100,'Test','cash','test reason',current_date)",
      [id(3)],
    ),
    q("select get_cash_journal_operation_templates_v1($1)", [id(3)]),
    q("select get_cash_performers($1)", [id(3)]),
    q(
      "select post_cash_journal_request($1,$2,'invoice',$3,now(),current_date)",
      [id(720), id(3), payload],
    ),
    q(
      "select record_cash_transaction_context('invoice',$1,$2,now(),current_date)",
      [payload, id(1)],
    ),
    q("select record_cash_transaction_timed('invoice',$1,now(),current_date)", [
      payload,
    ]),
    q("select record_cash_with_account('invoice',$1,null)", [payload]),
    q("select record_customer_advance($1,100,'cash','test reason',$2)", [
      id(5),
      id(3),
    ]),
    q("select record_supplier_advance($1,100,'cash','test reason',$2)", [
      id(6),
      id(3),
    ]),
    q("select record_invoice_payment($1,100,'cash','test reason',$2)", [
      id(700),
      id(4),
    ]),
    q("select record_purchase_payment($1,100,'cash','test reason',$2)", [
      id(702),
      id(4),
    ]),
    q("select refund_party_advance($1,$2)", [
      id(720),
      { mode: "customer", branchId: id(3), partyId: id(5), amount: 100 },
    ]),
    q("select settle_cod_scoped_v1($1,$2,null,null,'[]','cash')", [
      id(720),
      id(3),
    ]),
    q(
      "select settle_internal_return_credit($1,'refund',100,null,'test reason',$2)",
      [id(711), id(720)],
    ),
    q("select settle_party_documents_atomic($1,$2)", [
      id(720),
      { mode: "customer", branchId: id(3), partyId: id(5) },
    ]),
    q("select get_cash_journal_catalog_v1($1)", [id(3)]),
  ];
  const before = (
    await db.query("select count(*)::int n from cash_transactions")
  ).rows[0].n;
  for (const call of calls)
    await assert.rejects(call(), /DENIED|INSUFFICIENT_PERMISSION/);
  assert.equal(
    (await db.query("select count(*)::int n from cash_transactions")).rows[0].n,
    before,
  );
  assert.equal(
    (await db.query("select paid from invoices where id=$1", [id(700)])).rows[0]
      .paid,
    "0",
  );
  assert.equal(
    (await db.query("select get_internal_return_finance($1) r", [id(710)]))
      .rows[0].r.accounts.length,
    0,
  );
  // B is processed first, then A is denied: the entire batch must roll back.
  await assert.rejects(
    db.query("select settle_cod_atomic(null,$1,'cash')", [
      [{ shipment_id: id(751) }, { shipment_id: id(750) }],
    ]),
    /BRANCH_ACCESS_DENIED/,
  );
  assert.equal(
    (await db.query("select count(*)::int n from shipping_settlements")).rows[0]
      .n,
    0,
  );
  assert.equal(
    Number(
      (await db.query("select paid from invoices where id=$1", [id(701)]))
        .rows[0].paid,
    ),
    0,
  );
  assert.equal(
    (await db.query("select count(*)::int n from cash_transactions")).rows[0].n,
    before,
  );
  await db.exec(
    "delete from test_staff_permissions where code in ('finance.create_transaction','finance.void_transaction')",
  );
  // Real payment + cash + debt update with only a local grant, then real void.
  const result = (
    await db.query(
      "select record_invoice_payment($1,100,'cash','test reason') r",
      [id(701)],
    )
  ).rows[0].r;
  const cash = (
    await db.query(
      "select * from cash_transactions where reference_id=$1 order by created_at desc limit 1",
      [id(701)],
    )
  ).rows[0];
  assert.ok(cash, result);
  assert.equal(cash.branch_id, id(4));
  assert.equal(Number(cash.amount), 100);
  assert.equal(
    Number(
      (await db.query("select paid from invoices where id=$1", [id(701)]))
        .rows[0].paid,
    ),
    100,
  );
  await db.query("select cancel_cash_transaction($1,'test reversal')", [
    cash.id,
  ]);
  assert.equal(
    Number(
      (await db.query("select paid from invoices where id=$1", [id(701)]))
        .rows[0].paid,
    ),
    0,
  );
  // Local transaction grants do not authorize shared account configuration.
  await assert.rejects(
    db.query("select save_money_account(null,null,'{}','test reason')"),
    /DENIED/,
  );
  await assert.rejects(
    db.query("select delete_money_account($1,0,'test reason')", [id(799)]),
    /DENIED/,
  );
  await db.query(
    "insert into user_permission_overrides values($1,$2,'finance.create_transaction','revoke')",
    [id(2), id(1)],
  );
  await assert.rejects(
    db.query("select record_invoice_payment($1,100,'cash','test reason')", [
      id(701),
    ]),
    /INSUFFICIENT_PERMISSION/,
  );
  await db.exec(
    "alter table cash_transactions enable row level security;create policy staff_test_legacy on cash_transactions to authenticated using(true) with check(true);grant select,insert,update,delete on cash_transactions to authenticated;set role authenticated",
  );
  await assert.rejects(
    db.query("insert into cash_transactions(id) values($1)", [id(730)]),
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
  await db.exec("reset role");
  console.log(
    "PASS cash scope: denied branch/document/payload paths unchanged, actual local-only invoice payment and reversal preserve cash/debt, global denial wins, shared accounts not granted and direct cash DML blocked.",
  );
}
