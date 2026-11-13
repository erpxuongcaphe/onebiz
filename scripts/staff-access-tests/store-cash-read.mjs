import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { functionFromMigration } from "./inventory.mjs";

export async function verifyStoreCashReads(db, id) {
  await db.exec(
    await functionFromMigration(
      "20261111094222_staff_branch_report_permissions.sql",
      "_staff_report_permission",
    ),
  );
  await db.exec(`
    insert into test_staff_permissions values ('finance.view_cash_book'),
      ('finance.view_cash_journal_company'),('pos_fnb.view_sales_summary'),
      ('reports.analytics'),('reports.view_all_branches') on conflict do nothing;
    delete from user_branch_permission_overrides where permission_code='finance.view_cash_book';
    insert into user_branch_permission_overrides values
      ('${id(2)}','${id(1)}','${id(3)}','finance.view_cash_book','revoke');
  `);
  const auditPath = process.env.ONEBIZ_CASH_AUDIT_FILE;
  if (auditPath) {
    const definitions = JSON.parse(await readFile(auditPath, "utf8"));
    for (const name of [
      "get_store_direct_bank_cash_links",
      "get_store_finance_reporting_source",
    ]) {
      const match = definitions.find((entry) => entry.proname === name);
      assert.ok(match, name);
      await db.exec(match.definition);
    }
  } else {
    // Minimal contracts keep private application SQL out of the public repository.
    await db.exec(`
      create table private.store_cash_handovers(id uuid,tenant_id uuid,receiving_branch_id uuid,amount numeric,received_date date);
      insert into private.store_cash_handovers values
        ('${id(790)}','${id(2)}','${id(3)}',100,current_date),
        ('${id(791)}','${id(2)}','${id(4)}',20,current_date);
      create function public.get_store_direct_bank_cash_links(p_cash_ids uuid[],p_export boolean default false)
      returns jsonb language plpgsql security definer set search_path='' as $$
      declare v_actor uuid:=auth.uid();v_tenant uuid:=public.get_user_tenant_id();
      begin
        if v_tenant is null or not coalesce(public.user_has_permission(v_actor, 'finance.view_cash_book'),false) then
          raise exception 'DIRECT_BANK_REPORT_DENIED';
        end if;
        return '[]';
      end$$;
      create function public.get_store_finance_reporting_source(p_mode text,p_from date,p_to date,
        p_branch uuid default null,p_legal_key text default null,p_export boolean default false)
      returns jsonb language plpgsql security definer set search_path='' as $$
      declare v_actor uuid:=auth.uid();v_tenant uuid:=public.get_user_tenant_id();v_allowed boolean;v_result jsonb;
      begin
        v_allowed:=case p_mode when 'journal' then true
          when 'fund' then public.user_has_permission(v_actor, 'finance.view_cash_book') else false end;
        if not coalesce(v_allowed,false) then raise exception 'STORE_FINANCE_REPORT_DENIED';end if;
        select coalesce(jsonb_agg(h.id),'[]') into v_result from private.store_cash_handovers h
          where p_mode in ('journal', 'fund') and h.tenant_id = v_tenant
            and (p_branch is null or h.receiving_branch_id=p_branch);
        return v_result;
      end$$;
    `);
  }
  await db.exec(
    await readFile(
      new URL(
        "../../supabase/migrations/20261112032100_staff_branch_store_cash_reads.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await assert.rejects(
    db.query("select get_store_direct_bank_cash_links('{}',false)"),
    /DIRECT_BANK_REPORT_DENIED/,
  );
  await assert.rejects(
    db.query(
      "select get_store_finance_reporting_source('fund',current_date,current_date,$1)",
      [id(3)],
    ),
    /STORE_FINANCE_REPORT_DENIED/,
  );
  if (!auditPath) {
    const result = (
      await db.query(
        "select get_store_finance_reporting_source('fund',current_date,current_date,null) result",
      )
    ).rows[0].result;
    assert.deepEqual(result, [id(791)]);
    const journal = (
      await db.query(
        "select get_store_finance_reporting_source('journal',current_date,current_date,null) result",
      )
    ).rows[0].result;
    assert.deepEqual(journal, [id(790), id(791)]);
  }
  console.log(
    "PASS store cash: company aggregate denial and fund branch scope, with journal scope preserved.",
  );
  const { verifyManagementFinanceScope } = await import(
    "./management-finance-read.mjs"
  );
  await verifyManagementFinanceScope(db, id);
}
