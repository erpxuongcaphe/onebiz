import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/00388_close_fnb_kitchen_order_on_full_sales_return.sql",
  ),
  "utf8",
).toLowerCase();

describe("migration 00388 full FnB return closes KDS", () => {
  it("keeps the deployed atomic return implementation private and callable", () => {
    expect(migration).toContain(
      "rename to _create_sales_return_atomic_impl_00376",
    );
    expect(migration).toContain("_create_sales_return_atomic_impl_00376(");
    expect(migration).toContain(
      "revoke all on function public._create_sales_return_atomic_impl_00376",
    );
  });

  it("closes only active FnB KDS rows after every invoice line is returned", () => {
    expect(migration).toContain("i.source = 'fnb'");
    expect(migration).toContain("coalesce(ii.returned_qty, 0) < ii.quantity");
    expect(migration).toContain(
      "ko.status not in ('cancelled', 'completed', 'served')",
    );
    expect(migration).toContain("set status = 'cancelled'");
    expect(migration).toContain("full_sales_return");
  });

  it("does not duplicate return, stock, cash, invoice or Retail logic", () => {
    expect(migration).not.toContain("insert into public.sales_returns");
    expect(migration).not.toContain("insert into public.return_items");
    expect(migration).not.toContain("insert into public.stock_movements");
    expect(migration).not.toContain("insert into public.cash_transactions");
    expect(migration).not.toContain("update public.invoices");
    expect(migration).not.toContain("pos_retail");
  });

  it("bounds, audits and verifies the historical reconciliation", () => {
    expect(migration).toContain("v_mismatch_count > 50");
    expect(migration).toContain("fnb_00388_unexpected_mismatch_count");
    expect(migration).toContain("full_sales_return_reconcile");
    expect(migration).toContain("fnb_00388_reconcile_failed");
  });
});
