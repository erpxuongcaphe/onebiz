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
const sqlFile = (name) =>
  readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
let checks = 0;
try {
  await initializeStaffAccessFixture(db, id);
  await db.exec(await sqlFile("20261111052704_staff_branch_access.sql"));
  await db.exec(
    await functionFromMigration(
      "20261111070229_staff_branch_checkout_permissions.sql",
      "_staff_permission_at_scope",
    ),
  );
  await db.exec(`alter table branches add column branch_type text default 'store',add column legal_tax_code text;
 create schema private;
 create function private.store_branch_legal_key(text) returns text language sql immutable as $$select $1$$;
 create function _can_read_branch_inventory_00476(p_user uuid,p_tenant uuid,p_branch uuid) returns boolean language sql as $$select public.user_has_branch_access(p_user,p_branch) or public.user_has_permission(p_user,'reports.view_all_branches')$$;
 create function can_read_branch_document_00567(p_tenant uuid,p_branch uuid) returns boolean language sql as $$select public._can_read_branch_inventory_00476(auth.uid(),p_tenant,p_branch)$$;
 insert into user_branches(user_id,branch_id) values('${id(101)}','${id(11)}');
 select set_config('request.jwt.claim.sub','${id(101)}',false);`);
  for (const [file, name] of [
    [
      "00513_inventory_operational_read_projections.sql",
      "assert_report_access",
    ],
    [
      "202610200007_operational_sales_dashboard.sql",
      "get_operational_sales_dashboard",
    ],
    [
      "202610200006_fnb_sales_summary_permission.sql",
      "get_fnb_day_sales_summary",
    ],
    ["00342_invoice_list_only_sales_documents.sql", "get_invoice_list_summary"],
    [
      "202610230005_fnb_invoice_service_filters.sql",
      "get_invoice_list_summary_fnb_context_20261023",
    ],
    [
      "202610230008_fnb_invoice_option_filters.sql",
      "get_invoice_list_summary_fnb_choices_20261023",
    ],
  ])
    await db.exec(await functionFromMigration(file, name));
  const summaryGuard = await sqlFile(
    "202610200006_fnb_sales_summary_permission.sql",
  );
  await db.exec(summaryGuard.slice(summaryGuard.indexOf("do $guard$")));
  await db.exec(
    await readFile(
      new URL(
        "./staff-access-tests/report-contract-fixtures.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  // Optional local private audit export; never checked into the public repository.
  if (process.env.ONEBIZ_REPORT_AUDIT_FILE) {
    const names = new Set([
      "assert_report_access",
      "get_operational_sales_dashboard",
      "report_cogs_by_bom",
      "get_delivery_invoice_management_v1",
      "get_store_direct_bank_cash_links",
      "get_store_finance_reporting_source",
      "get_company_cash_receipt_audit_v1",
      "get_store_sales_day_collections",
      "get_fnb_day_sales_summary",
      "get_invoice_list_summary",
      "get_invoice_list_summary_fnb_context_20261023",
      "get_invoice_list_summary_fnb_choices_20261023",
    ]);
    const rows = JSON.parse(
      await readFile(process.env.ONEBIZ_REPORT_AUDIT_FILE, "utf8"),
    ).filter((f) => names.has(f.proname));
    assert.equal(rows.length, names.size);
    for (const row of rows) await db.exec(row.definition + ";");
  }
  await db.exec(
    await sqlFile("20261111094222_staff_branch_report_permissions.sql"),
  );
  const codes = [
    "reports.dashboard",
    "reports.analytics",
    "reports.fnb",
    "reports.view_profit",
    "reports.view_detail",
    "reports.export",
    "reports.export_detail",
    "pos_fnb.view_sales_summary",
  ];
  await db.exec(
    `insert into role_permissions values('${id(20)}','reports.view_all_branches'),('${id(20)}','pos_fnb.view_sales_summary'),('${id(20)}','products.view_cost'),('${id(20)}','finance.view_cash_book'),('${id(20)}','finance.view_cash_journal_company');`,
  );
  for (const code of codes) {
    await db.query("insert into role_permissions values($1,$2)", [
      id(20),
      code,
    ]);
    await db.query("select assert_report_access($1,null)", [code]);
    checks++;
    await db.query(
      "insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values($1,$2,$3,$4,'revoke',$5)",
      [id(1), id(101), id(10), code, id(100)],
    );
    await assert.rejects(
      db.query("select assert_report_access($1,$2)", [code, id(10)]),
      /REPORT_PERMISSION_DENIED/,
    );
    checks++;
    await assert.rejects(
      db.query("select assert_report_access($1,null)", [code]),
      /REPORT_PERMISSION_DENIED/,
    );
    checks++;
    await db.query("select assert_report_access($1,$2)", [code, id(11)]);
    checks++;
    await db.query("delete from role_permissions where permission_code=$1", [
      code,
    ]);
    await db.query(
      "insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values($1,$2,$3,$4,'grant',$5)",
      [id(1), id(101), id(11), code, id(100)],
    );
    await db.query("select assert_report_access($1,$2)", [code, id(11)]);
    checks++;
    await assert.rejects(
      db.query("select assert_report_access($1,$2)", [code, id(12)]),
      /REPORT_(PERMISSION|BRANCH)_DENIED/,
    );
    checks++;
  }
  for (const sql of [
    `select get_operational_sales_dashboard('${id(10)}',null,null)`,
    `select get_delivery_invoice_management_v1('${id(10)}',current_date,current_date)`,
    `select get_store_direct_bank_cash_links('{}')`,
    `select get_store_finance_reporting_source('fund',current_date,current_date,'${id(10)}')`,
    `select get_company_cash_receipt_audit_v1('${id(10)}',current_date,current_date)`,
    `select get_store_sales_day_collections('${id(10)}',current_date)`,
    `select get_fnb_day_sales_summary('${id(10)}',current_date)`,
    `select get_invoice_list_summary('${id(10)}')`,
    `select get_invoice_list_summary_fnb_context_20261023('${id(10)}')`,
    `select get_invoice_list_summary_fnb_choices_20261023('${id(10)}')`,
    `select * from report_cogs_by_bom(current_date,current_date,'${id(10)}')`,
  ]) {
    await assert.rejects(db.query(sql), (e) => e.code === "42501");
    checks++;
  }
  await assert.rejects(
    db.query(`select get_operational_sales_dashboard('${id(11)}',null,null)`),
    /DASHBOARD_RANGE_INVALID/,
  );
  checks++;
  await db.exec(`create table invoices(id uuid,tenant_id uuid,branch_id uuid,source text,deleted_at timestamptz,status text,total numeric,ngay_chung_tu timestamptz);
 create table cash_transactions(tenant_id uuid,branch_id uuid,reference_id uuid,reference_type text,status text,type text,payment_method text,amount numeric,transaction_date date);
 alter table kitchen_orders add column status text,add column invoice_id uuid,add column merged_into_id uuid,add column created_at timestamptz;
 insert into invoices values('${id(80)}','${id(1)}','${id(10)}','fnb',null,'completed',999,current_timestamp),('${id(81)}','${id(1)}','${id(11)}','fnb',null,'completed',100,current_timestamp);`);
  const summary = (
    await db.query(
      `select get_fnb_day_sales_summary('${id(11)}',(now() at time zone 'Asia/Ho_Chi_Minh')::date) value`,
    )
  ).rows[0].value;
  assert.equal(summary.invoiceValue, 100);
  assert.equal(summary.completed, 1);
  checks += 2;
  await db.query(
    "insert into user_permission_overrides(tenant_id,user_id,permission_code,override_type) values($1,$2,'reports.analytics','revoke')",
    [id(1), id(101)],
  );
  await assert.rejects(
    db.query("select assert_report_access($1,$2)", [
      "reports.analytics",
      id(11),
    ]),
    /REPORT_PERMISSION_DENIED/,
  );
  checks++;
  console.log(
    `PASS ${checks} report scope checks (${process.env.ONEBIZ_REPORT_AUDIT_FILE ? "actual exported bodies" : "public bodies and six private contract fixtures"})`,
  );
} catch (e) {
  console.error(e.message, e.where);
  process.exitCode = 1;
} finally {
  await db.close();
}
