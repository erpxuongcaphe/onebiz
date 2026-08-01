import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("durable opening debt balances", () => {
  const service = read("src/lib/services/supabase/excel-import.ts");
  const migration = read(
    "supabase/migrations/00290_atomic_debt_opening_and_aging.sql",
  );

  it("imports each opening balance through one server transaction", () => {
    const start = service.indexOf("export async function bulkImportDebtOpening");
    const end = service.indexOf("// Initial stock", start);
    const openingImport = service.slice(start, end);

    expect(openingImport).toContain('"upsert_debt_opening_balance_atomic"');
    expect(openingImport).toContain("p_branch_id: ctx.branchId");
    expect(openingImport).not.toMatch(/\.update\(\{\s*debt:/);
    expect(openingImport).not.toContain('from("audit_log").insert');
  });

  it("preserves legacy aggregate differences without changing documents", () => {
    expect(migration).toContain("create table if not exists public.debt_opening_balances");
    expect(migration).toContain("Existing aggregate-only");
    expect(migration).not.toMatch(
      /(?:update|delete from) public\.(?:invoices|purchase_orders|cash_transactions|stock_movements|branch_stock)/,
    );
  });

  it("keeps customer and supplier totals tied to documents plus ledgers", () => {
    expect(migration).toMatch(
      /create or replace function public\.recompute_customer_debt[\s\S]*?customer_debt_adjustments[\s\S]*?debt_opening_balances/,
    );
    expect(migration).toMatch(
      /create or replace function public\.recompute_supplier_debt[\s\S]*?purchase_orders[\s\S]*?debt_opening_balances/,
    );
    expect(migration).toContain("trg_debt_opening_balances_sync");
  });

  it("enforces effective permission and branch access in the RPC", () => {
    expect(migration).toContain("v_actor uuid := auth.uid()");
    expect(migration).toContain("customers.import");
    expect(migration).toContain("suppliers.import");
    expect(migration).toContain("public.user_has_branch_access");
    expect(migration).toContain("insert into public.audit_log");
    expect(migration).toContain(
      "revoke insert, update, delete on public.debt_opening_balances",
    );
  });

  it("includes opening balances and customer credits in aging reports", () => {
    expect(migration).toMatch(
      /get_receivable_aging_report[\s\S]*?debt_opening_balances[\s\S]*?customer_debt_adjustments/,
    );
    expect(migration).toMatch(
      /get_payable_aging_report[\s\S]*?debt_opening_balances/,
    );
    expect(migration).toContain("p_branch_id is null");
    expect(migration).toContain("o.branch_id = p_branch_id");
  });
});
