import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/00376_round_sales_return_refund_amount.sql",
  "utf8",
).toLowerCase();

describe("migration 00376 sales-return money", () => {
  it("normalizes refund precision before the existing atomic implementation", () => {
    expect(migration).toContain("else round(coalesce(p_refund_amount, 0), 2)");
    expect(migration).toContain("when coalesce(p_refund_amount, 0) < 0 then p_refund_amount");
    expect(migration).toContain("_create_sales_return_auth_impl_00244");
  });

  it("preserves FIFO reconciliation and browser grants", () => {
    expect(migration).toContain("_reconcile_product_lots_to_branch_00284");
    expect(migration).toContain("to authenticated");
    expect(migration).toContain("from public, anon");
  });

  it("contains no data migration statements", () => {
    expect(migration).not.toMatch(/update public\.(invoices|invoice_items|products|branch_stock)/);
    expect(migration).not.toMatch(/insert into public\.(sales_returns|return_items|stock_movements|cash_transactions)/);
  });
});
