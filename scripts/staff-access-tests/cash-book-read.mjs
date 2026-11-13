import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { functionFromMigration } from "./inventory.mjs";

export async function verifyCashBookReadScope(db, id) {
  await db.exec(`
    create function public.get_user_accessible_branches(uuid) returns table(branch_id uuid)
    language sql stable set search_path=public
    as $$select id from public.branches where public.user_has_branch_access($1,id)$$;
    grant usage on schema auth to authenticated;
    grant select on profiles,branches,invoices,purchase_orders,test_staff_permissions,user_permission_overrides to authenticated;
    insert into cash_transactions(id,tenant_id,branch_id,code,status,type,amount,transaction_date,category)
      values ('${id(705)}','${id(2)}','${id(3)}','Scope-A','completed','receipt',100,current_date,'synthetic-scope'),
        ('${id(704)}','${id(2)}','${id(4)}','Scope-B','completed','receipt',20,current_date,'synthetic-scope');
  `);
  for (const [file, name] of [
    ["00311_cash_book_list_workspace.sql", "get_cash_book_list_workspace"],
    ["00523_party_cash_history_sources.sql", "get_party_cash_history_sources"],
    ["00553_party_cash_amendments.sql", "get_cash_amendment_history"],
    ["00552_money_account_register.sql", "get_money_account_workspace"],
    ["00522_party_debt_movement_report.sql", "get_party_debt_movements"],
  ]) {
    const definition = await functionFromMigration(file, name);
    await db.exec(
      definition.replace(/^create function/i, "create or replace function"),
    );
  }
  await db.exec(`
    create or replace function public.get_cash_journal_operation_templates_v1(p_branch_id uuid)
    returns jsonb language plpgsql as $$begin
      if not public.user_has_permission(auth.uid(), 'finance.view_cash_book') then raise exception 'DENIED'; end if;
      return '{}';
    end$$;
  `);
  if (process.env.ONEBIZ_CASH_AUDIT_FILE) {
    const definitions = JSON.parse(
      await readFile(process.env.ONEBIZ_CASH_AUDIT_FILE, "utf8"),
    );
    for (const name of [
      "get_cash_book_list_workspace",
      "get_party_cash_history_sources",
      "get_cash_amendment_history",
      "get_money_account_workspace",
      "get_party_debt_movements",
      "get_cash_journal_operation_templates_v1",
    ]) {
      const match = definitions.find((entry) => entry.proname === name);
      assert.ok(match, name);
      await db.exec(match.definition);
    }
  }
  await db.exec(
    await readFile(
      new URL(
        "../../supabase/migrations/20261112030753_staff_branch_cash_book_read.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(await readFile(new URL('../../supabase/migrations/20261113062219_staff_cash_direct_read_scope.sql', import.meta.url), 'utf8'));
  const directCount = async () => Number((await db.query("select count(*) n from cash_transactions where category='synthetic-scope'")).rows[0].n);
  await db.exec('set role authenticated');
  assert.equal(await directCount(), 2, 'no branch exception preserves legacy direct reads');
  await db.exec(`reset role;
    insert into user_branch_permission_overrides values
      ('${id(2)}','${id(1)}','${id(3)}','finance.view_cash_book','revoke');
    set role authenticated;`);
  assert.equal(await directCount(), 1, 'direct REST table read hides the denied branch');
  await db.exec(`reset role; insert into test_staff_permissions values ('reports.dashboard'); set role authenticated;`);
  assert.equal(await directCount(), 2, 'independent dashboard permission remains effective');
  await db.exec(`reset role; delete from test_staff_permissions where code in ('reports.dashboard','finance.view_cash_book');
    update user_branch_permission_overrides set branch_id='${id(4)}',override_type='grant'
      where permission_code='finance.view_cash_book'; set role authenticated;`);
  assert.equal(await directCount(), 1, 'branch-only cash grant exposes just its selected branch');
  await db.exec(`reset role; insert into user_permission_overrides values ('${id(2)}','${id(1)}','finance.view_cash_book','revoke'); set role authenticated;`);
  assert.equal(await directCount(), 0, 'global cash-view denial wins over a branch grant');
  await db.exec(`reset role; delete from user_permission_overrides where permission_code='finance.view_cash_book';
    insert into test_staff_permissions values ('finance.view_cash_book');
    delete from user_branch_permission_overrides where permission_code='finance.view_cash_book';`);
  // Real payment writer stays usable when cash-book viewing is independently
  // denied. The transaction is rolled back so later fixture tests stay stable.
  await db.exec(`begin;
    delete from user_permission_overrides where permission_code='finance.create_transaction';
    insert into user_branch_permission_overrides values
      ('${id(2)}','${id(1)}','${id(4)}','finance.view_cash_book','revoke');
    set local role authenticated;`);
  await db.query("select record_invoice_payment($1,100,'cash','synthetic')", [id(701)]);
  await db.exec('rollback');
  const list = async (branch = null) =>
    (
      await db.query(
        "select get_cash_book_list_workspace(p_branch_id=>$1,p_categories=>array['synthetic-scope']) result",
        [branch],
      )
    ).rows[0].result;
  await db.exec("set role authenticated");
  assert.equal((await list()).summary.totalReceipt, 120);
  await db.exec(`reset role;
    insert into user_branch_permission_overrides values
      ('${id(2)}','${id(1)}','${id(3)}','finance.view_cash_book','revoke');
    set role authenticated;`);
  assert.equal((await list()).summary.totalReceipt, 20);
  await assert.rejects(list(id(3)), /CASH_BOOK_PERMISSION_DENIED/);
  await assert.rejects(
    db.query(
      "select get_money_account_workspace($1,current_date,current_date)",
      [id(3)],
    ),
    /MONEY_ACCOUNT_READ_DENIED/,
  );
  await assert.rejects(
    db.query("select get_party_cash_history_sources('customer',$1,$2)", [
      id(5),
      id(3),
    ]),
    /PARTY_CASH_HISTORY_DENIED/,
  );
  await db.exec(`reset role;
    delete from test_staff_permissions where code='finance.view_cash_book';
    update user_branch_permission_overrides set branch_id='${id(4)}',override_type='grant'
      where permission_code='finance.view_cash_book';
    set role authenticated;`);
  assert.equal((await list()).summary.totalReceipt, 20);
  assert.equal((await list(id(4))).summary.totalReceipt, 20);
  await assert.rejects(list(id(3)), /CASH_BOOK_PERMISSION_DENIED/);
  await assert.rejects(
    db.query("select get_cash_amendment_history($1)", [id(703)]),
    /CASH_HISTORY_DENIED/,
  );
  console.log(
    "PASS cash book: local grants and denials constrain branch lists and receipt totals.",
  );
  await db.exec("reset role");
  const { verifyCashDocumentReads } = await import("./cash-document-read.mjs");
  await verifyCashDocumentReads(db, id);
  const { verifyCashRefundView } = await import("./cash-refund-view.mjs");
  await verifyCashRefundView(db, id);
  const { verifyManagementFinanceActions } = await import(
    "./management-finance-actions.mjs"
  );
  await verifyManagementFinanceActions(db, id);
}
