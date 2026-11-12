import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { functionFromMigration } from "./inventory.mjs";

export async function verifyManagementFinanceScope(db, id) {
  await db.exec(`
    create table internal_receipt_expense_sources(
      id uuid, tenant_id uuid, event_id uuid, sale_id uuid, receipt_id uuid,
      sale_item_id uuid, quantity numeric, consolidated_amount numeric
    );
    create table internal_sale_items(
      id uuid, internal_sale_id uuid, product_code text, product_name text,
      quantity numeric, unit text, unit_price numeric
    );
    alter table internal_sales add column code text;
    insert into management_finance_events
      (id,tenant_id,code,request_id,request_payload,category_id,category_code,category_name,
       kind,business_date,amount,counterparty,created_by)
    select '${id(850)}','${id(2)}','SCOPE-A','${id(860)}','{}',id,code,name,
      'income','2035-01-01',100,'Test','${id(1)}'
      from management_finance_categories where tenant_id='${id(2)}' limit 1;
    insert into management_finance_events
      (id,tenant_id,code,request_id,request_payload,category_id,category_code,category_name,
       kind,business_date,amount,counterparty,created_by)
    select '${id(851)}','${id(2)}','SCOPE-B','${id(861)}','{}',id,code,name,
      'income','2035-01-01',20,'Test','${id(1)}'
      from management_finance_categories where tenant_id='${id(2)}' limit 1;
    insert into management_finance_allocations(event_id,branch_id,recognition_date,amount) values
      ('${id(850)}','${id(3)}','2035-01-01',100),
      ('${id(851)}','${id(4)}','2035-01-01',20);
  `);
  const auditPath = process.env.ONEBIZ_CASH_AUDIT_FILE;
  let definition;
  if (auditPath) {
    const definitions = JSON.parse(await readFile(auditPath, "utf8"));
    definition = definitions.find(
      (entry) => entry.proname === "get_management_finance_workspace",
    )?.definition;
    assert.ok(definition);
  } else {
    definition = await functionFromMigration(
      "00438_management_income_expense_ledger.sql",
      "get_management_finance_workspace",
    );
  }
  await db.exec(
    definition.replace(/^create function/i, "create or replace function"),
  );
  for (const [file, name] of [
    [
      "00438_management_income_expense_ledger.sql",
      "get_management_finance_categories",
    ],
    [
      "00440_management_finance_cash_flow_sources.sql",
      "get_management_finance_cash_links",
    ],
  ]) {
    const source = await functionFromMigration(file, name);
    await db.exec(
      source.replace(/^create function/i, "create or replace function"),
    );
  }
  await db.exec(`
    create function public.get_journal_finance_categories_v1(p_branch_id uuid)
    returns jsonb language plpgsql security definer set search_path='' as $$
    declare v_tenant uuid := public.management_finance_actor('finance.view_cash_book');
    begin
      if p_branch_id is null or not public.can_read_branch_document_00567(v_tenant,p_branch_id)
        then raise exception 'JOURNAL_CATALOG_BRANCH_DENIED';end if;
      return '[]';
    end$$;
  `);
  await db.exec(
    await readFile(
      new URL(
        "../../supabase/migrations/20261112032246_staff_branch_management_finance_read.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const report = async (branch = null) =>
    (
      await db.query(
        "select get_management_finance_workspace('2035-01-01','2035-01-01',$1) result",
        [branch],
      )
    ).rows[0].result;
  assert.equal((await report()).summary.income, 20);
  assert.equal((await report(id(4))).summary.income, 20);
  await assert.rejects(report(id(3)), /MANAGEMENT_FINANCE_DENIED/);
  await assert.rejects(
    db.query("select get_journal_finance_categories_v1($1)", [id(3)]),
    /MANAGEMENT_FINANCE_DENIED/,
  );
  await db.query("select get_journal_finance_categories_v1($1)", [id(4)]);
  await db.query("select get_management_finance_categories()");
  await assert.rejects(
    db.query(
      "select get_management_finance_cash_links('2035-01-01','2035-01-01',$1)",
      [id(3)],
    ),
    /MANAGEMENT_FINANCE_DENIED/,
  );
  await db.exec(`
    insert into management_finance_allocations(event_id,branch_id,recognition_date,amount)
      values ('${id(850)}','${id(4)}','2035-01-01',10);
    insert into management_finance_settlements(event_id,cash_transaction_id,request_id,request_payload,created_by)
      values ('${id(851)}','${id(705)}','${id(862)}','{}','${id(1)}');
  `);
  assert.equal((await report()).summary.income, 0);
  console.log(
    "PASS management finance: other-branch allocations excluded from event details and totals.",
  );
}
