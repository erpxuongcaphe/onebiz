import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/00394_financial_reports_use_invoice_date.sql",
  "utf8",
);
const rollback = readFileSync(
  "supabase/migrations/00394_rollback_financial_reports_use_invoice_date.sql",
  "utf8",
);

describe("00394 financial report date and sales-return reconciliation", () => {
  it("aligns detailed sales with P&L issued_at while preserving return transaction dates", () => {
    expect(migration).toContain("get_financial_analysis_details_report");
    expect(migration).toContain("get_consolidated_profit_and_loss_report");
    expect(migration).toContain("i.issued_at as created_at");
    expect(migration).toContain("and i.issued_at >= p_date_from");
    expect(migration).toContain("and i.issued_at < p_date_to");
    expect(migration).toContain(
      "on i.issued_at >= p.date_from and i.issued_at < p.date_to",
    );
    expect(migration).toContain("sr.created_at");
  });

  it("returns gross sales, return and COGS bridge values from the same scoped rows", () => {
    expect(migration).toContain("'reconciliation', jsonb_build_object(");
    expect(migration).toContain("'invoice_count', (select count(*) from scoped_invoices)");
    expect(migration).toContain("'return_count', (select count(*) from scoped_returns)");
    expect(migration).toContain("sum(il.quantity * il.unit_cost)");
    expect(migration).toContain("sum(rl.quantity * rl.unit_cost)");
    expect(migration).toContain("'returned_cogs'");
  });

  it("guards the installed base and snapshots both exact function definitions", () => {
    expect(migration).toContain("ISSUED_AT_00335");
    expect(migration).toContain("public.rpc_backup_ngay_hoa_don");
    expect(migration).toContain("on conflict (migration, ham_oid) do nothing");
    expect(migration).toContain("expected 2 target report functions");
    expect(migration).toContain("financial-analysis function differs from reviewed shape");
    expect(migration).toContain("consolidated P&L differs from reviewed shape");
    expect(migration).toContain("rollback_snapshot_ok");
  });

  it("targets the complete scoped-invoice select and cannot rewrite si.created_at", () => {
    expect(migration).toContain("$old_scoped_invoice_select$");
    expect(migration).toContain("$new_scoped_invoice_select$");
    expect(migration).toContain("i.issued_at as created_at");
    expect(migration).not.toContain("replace(v_definition, 'i.created_at,'");
  });

  it("does not edit invoice, return, cash, or inventory data", () => {
    expect(migration).not.toMatch(/^\s*(update|delete\s+from)\s+public\.(invoices|sales_returns|cash_transactions|stock_movements)/im);
    expect(migration).not.toMatch(/^\s*insert\s+into\s+public\.(invoices|sales_returns|cash_transactions|stock_movements)/im);
    expect(migration).toContain("insert into public.rpc_backup_ngay_hoa_don");
  });

  it("rolls back only from both snapshots and refuses later function changes", () => {
    expect(rollback).toContain("where migration = '00394'");
    expect(rollback).toContain("expected 2 exact snapshots");
    expect(rollback).toContain("ISSUED_AT_REPORT_00394");
    expect(rollback).toContain("execute r.def_truoc");
    expect(rollback).toContain("is distinct from r.def_truoc");
  });
});
