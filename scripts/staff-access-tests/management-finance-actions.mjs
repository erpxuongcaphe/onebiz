import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { functionFromMigration } from "./inventory.mjs";

export async function verifyManagementFinanceActions(db, id) {
  await db.exec(`reset role;
    create table private.cash_journal_template_reviews(tenant_id uuid,request_id uuid,branch_id uuid,submitted_by uuid,reviewer_id uuid,status text,event_id uuid,payload jsonb);
    create table private.cash_journal_operation_templates(id uuid,tenant_id uuid,branch_id uuid,is_active boolean,version numeric,reviewer_id uuid,kind text,require_evidence_ref boolean,require_description boolean,name text);
    create function private.can_review_cash_journal_template(uuid,uuid,uuid) returns boolean language sql as $$select false$$;
    create table if not exists management_finance_import_sources(tenant_id uuid,source_system text,source_code text,branch_id uuid,request_payload jsonb,result jsonb);
    insert into private.cash_journal_template_reviews values ('${id(2)}','${id(890)}','${id(3)}','${id(1)}','${id(5)}','pending',null,'{}'),('${id(2)}','${id(891)}','${id(4)}','${id(1)}','${id(5)}','pending',null,'{}');
    insert into management_finance_events(id,tenant_id,code,request_id,request_payload,category_id,category_code,category_name,kind,business_date,amount,counterparty,created_by)
      select '${id(898)}',tenant_id,'NO-ALLOCATION','${id(898)}','{}',category_id,category_code,category_name,kind,business_date,amount,counterparty,created_by
      from management_finance_events where id='${id(851)}';
    delete from user_branch_permission_overrides where permission_code in ('finance.view_cash_book','finance.create_transaction','finance.void_transaction');
    delete from user_permission_overrides where permission_code in ('finance.view_cash_book','finance.create_transaction','finance.void_transaction');
    insert into test_staff_permissions values ('finance.create_transaction'),('finance.void_transaction'),('finance.view_cash_book'),('finance.view_cash_journal_company') on conflict do nothing;
  `);
  const definitions = process.env.ONEBIZ_MANAGEMENT_AUDIT_FILE
    ? JSON.parse(
        await readFile(process.env.ONEBIZ_MANAGEMENT_AUDIT_FILE, "utf8"),
      )
    : [];
  for (const [file, name] of [
    [
      "00438_management_income_expense_ledger.sql",
      "post_management_finance_event",
    ],
    [
      "00438_management_income_expense_ledger.sql",
      "settle_management_finance_event",
    ],
    [
      "00438_management_income_expense_ledger.sql",
      "cancel_management_finance_event",
    ],
    [
      "00521_management_finance_external_import.sql",
      "preview_management_finance_import",
    ],
    [
      "00521_management_finance_external_import.sql",
      "commit_management_finance_import",
    ],
  ]) {
    let source = definitions.find(
      (entry) => entry.proname === name,
    )?.definition;
    if (process.env.ONEBIZ_MANAGEMENT_AUDIT_FILE) assert.ok(source, name);
    source ??= await functionFromMigration(file, name);
    await db.exec(
      source.replace(/^create function/i, "create or replace function"),
    );
  }
  if (process.env.ONEBIZ_MANAGEMENT_AUDIT_FILE) {
    for (const name of [
      "submit_cash_journal_template_review_v1",
      "post_cash_journal_template_review_v1",
    ]) {
      const source = definitions.find(
        (entry) => entry.proname === name,
      )?.definition;
      assert.ok(source, name);
      await db.exec(source);
    }
  } else {
    await db.exec(`
      create function public.submit_cash_journal_template_review_v1(p_request_id uuid,p_payload jsonb) returns text language plpgsql security definer set search_path='' as $$
      declare v_tenant uuid := public.management_finance_actor('finance.create_transaction');
        v_branch uuid := (p_payload#>>'{journalTemplate,branchId}')::uuid;
      begin perform public.management_finance_actor('finance.view_cash_book');
        if p_request_id is null or not coalesce(public.can_write_branch_document_00567(v_tenant, v_branch), false) then raise exception 'JOURNAL_TEMPLATE_REVIEW_DENIED'; end if;
        raise exception 'JOURNAL_TEMPLATE_STALE'; end$$;
      create function public.post_cash_journal_template_review_v1(p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
      declare v_tenant uuid := public.management_finance_actor('finance.create_transaction'); v_review private.cash_journal_template_reviews;
      begin perform public.management_finance_actor('finance.view_cash_book');
        select * into v_review from private.cash_journal_template_reviews where tenant_id=v_tenant and request_id=p_request_id;
        if not found or not coalesce(public.can_write_branch_document_00567(v_tenant,v_review.branch_id),false) then raise exception 'JOURNAL_TEMPLATE_REVIEW_DENIED'; end if;
        if v_review.status = 'posted' then return '{}'; end if;
        raise exception 'JOURNAL_TEMPLATE_REVIEW_REQUIRED'; end$$;
    `);
  }
  await db.exec(
    await readFile(
      new URL(
        "../../supabase/migrations/20261112034118_staff_branch_management_finance_mutations.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const category = (
    await db.query(
      "select id from management_finance_categories where tenant_id=$1 and is_active and not is_group limit 1",
      [id(2)],
    )
  ).rows[0].id;
  const payload = (branches) => ({
    categoryId: category,
    amount: branches.length * 10,
    businessDate: "2020-01-01",
    counterparty: "Test",
    allocations: branches.map((b) => ({
      branchId: id(b),
      recognitionDate: "2020-01-01",
      amount: 10,
    })),
  });
  const post = (request, branches) =>
    db.query("select post_management_finance_event($1,$2)", [
      id(request),
      payload(branches),
    ]);
  const cancel = (event) =>
    db.query("select cancel_management_finance_event($1,'test reason')", [
      id(event),
    ]);
  const submit = (branch) =>
    db.query("select submit_cash_journal_template_review_v1($1,$2)", [
      id(892),
      { journalTemplate: { branchId: id(branch), version: 1 } },
    ]);
  const review = (request) =>
    db.query("select post_cash_journal_template_review_v1($1)", [id(request)]);
  const settle = (event) =>
    db.query("select settle_management_finance_event($1,$2,'{}')", [
      id(event),
      id(899),
    ]);
  const preview = (branch) =>
    db.query("select preview_management_finance_import($1)", [
      [
        {
          branchId: id(branch),
          sourceSystem: "TEST",
          sourceCode: "1",
          operation: "unknown",
        },
      ],
    ]);
  await db.exec(`insert into user_branch_permission_overrides values
    ('${id(2)}','${id(1)}','${id(3)}','finance.create_transaction','revoke'),
    ('${id(2)}','${id(1)}','${id(3)}','finance.void_transaction','revoke'),
    ('${id(2)}','${id(1)}','${id(3)}','finance.view_cash_book','revoke');`);
  await assert.rejects(post(893, [4, 3]), /FINANCE_BRANCH_DENIED/);
  assert.equal(
    Number(
      (
        await db.query(
          "select count(*) n from management_finance_events where request_id=$1",
          [id(893)],
        )
      ).rows[0].n,
    ),
    0,
  );
  await assert.rejects(cancel(850), /FINANCE_EVENT_DENIED/);
  await assert.rejects(settle(850), /FINANCE_EVENT_DENIED/);
  await assert.rejects(cancel(898), /FINANCE_EVENT_DENIED/);
  await assert.rejects(settle(898), /FINANCE_EVENT_DENIED/);
  await assert.rejects(
    db.query("select post_management_finance_event($1,'{}')", [id(898)]),
    /FINANCE_EVENT_DENIED/,
  );
  await assert.rejects(preview(3), /FINANCE_IMPORT_BRANCH_DENIED/);
  await assert.rejects(preview(4), /FINANCE_IMPORT_OPERATION_INVALID/);
  await assert.rejects(
    submit(3),
    /MANAGEMENT_FINANCE_DENIED|JOURNAL_TEMPLATE_REVIEW_DENIED/,
  );
  await assert.rejects(review(890), /JOURNAL_TEMPLATE_REVIEW_DENIED/);
  await assert.rejects(review(891), /JOURNAL_TEMPLATE_REVIEW_REQUIRED/);
  await db.exec(
    `update user_branch_permission_overrides set branch_id='${id(4)}' where permission_code='finance.view_cash_book';`,
  );
  await assert.rejects(review(891), /MANAGEMENT_FINANCE_DENIED/);
  await assert.rejects(submit(4), /MANAGEMENT_FINANCE_DENIED/);
  await db.exec(
    `delete from user_branch_permission_overrides where permission_code='finance.view_cash_book';`,
  );
  const ok = await post(894, [4]);
  assert.ok(ok.rows[0]);
  await db.exec(`delete from test_staff_permissions where code='finance.create_transaction';
    update user_branch_permission_overrides set branch_id='${id(4)}',override_type='grant' where permission_code='finance.create_transaction';`);
  const local = await post(895, [4]);
  assert.ok(local.rows[0]);
  await assert.rejects(post(896, [3]), /FINANCE_BRANCH_DENIED/);
  await db.exec(
    `insert into user_permission_overrides values ('${id(2)}','${id(1)}','finance.create_transaction','revoke');`,
  );
  await assert.rejects(post(897, [4]), /MANAGEMENT_FINANCE_DENIED/);
  console.log(
    "PASS management finance actions: mixed-branch rollback, refund review scope and local-only posting.",
  );
}
