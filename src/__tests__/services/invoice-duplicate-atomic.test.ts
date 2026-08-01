import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const service = readFileSync("src/lib/services/supabase/orders.ts", "utf8");
const migration = readFileSync(
  "supabase/migrations/00266_atomic_invoice_duplicate.sql",
  "utf8",
);

describe("atomic invoice duplication", () => {
  it("routes the active action through one server transaction", () => {
    const start = service.indexOf("export async function duplicateInvoice");
    const body = service.slice(start);
    expect(body).toContain('"duplicate_invoice_to_order_atomic"');
    expect(body).not.toMatch(/\.from\("invoices"\)[\s\S]{0,160}\.insert\(/);
    expect(body).not.toMatch(/\.from\("invoice_items"\)[\s\S]{0,160}\.insert\(/);
  });

  it("derives actor and tenant, validates branch, and never mutates stock or cash", () => {
    expect(migration).toContain("auth.uid()");
    expect(migration).toContain("user_has_permission(v_actor, 'orders.create')");
    expect(migration).toContain("user_has_branch_access(v_actor, p_target_branch_id)");
    expect(migration).toContain("SOURCE_INVOICE_HAS_NO_ITEMS");
    expect(migration).toContain("insert into public.audit_log");
    expect(migration).not.toContain("insert into public.stock_movements");
    expect(migration).not.toContain("insert into public.cash_transactions");
  });
});
