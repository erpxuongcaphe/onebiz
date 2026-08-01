import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const service = readFileSync("src/lib/services/supabase/orders.ts", "utf8");
const migration = readFileSync(
  "supabase/migrations/00270_atomic_legacy_sales_order_state.sql",
  "utf8",
);

describe("legacy sales-order isolation", () => {
  it("prevents legacy completion from writing invoice, stock and cash in client steps", () => {
    expect(service).toContain('"complete_legacy_sales_order_atomic"');
    expect(service).toContain('"cancel_legacy_sales_order_atomic"');
    expect(service).not.toMatch(/completeSalesOrder[\s\S]{0,2600}\.from\("invoices"\)[\s\S]{0,160}\.insert\(/);
    expect(service).not.toMatch(/completeSalesOrder[\s\S]{0,2600}\.from\("invoice_items"\)[\s\S]{0,160}\.insert\(/);
  });

  it("locks the order and reuses the hardened POS checkout transaction", () => {
    expect(migration).toContain("for update");
    expect(migration).toContain("pos_prepare_retail_checkout");
    expect(migration).toContain("pos_complete_checkout_atomic_v3");
    expect(migration).toContain("pos_retail.checkout");
    expect(migration).toContain("orders.cancel");
    expect(migration).toContain("user_has_branch_access");
    expect(migration).toContain("SALES_ORDER_COMPLETION_INCONSISTENT");
    expect(migration).toContain("insert into public.audit_log");
  });
});
