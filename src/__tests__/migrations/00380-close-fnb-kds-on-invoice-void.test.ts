import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/00380_close_fnb_kitchen_order_on_invoice_void.sql",
  ),
  "utf8",
).toLowerCase();

describe("migration 00380 FnB invoice void closes KDS", () => {
  it("keeps the existing shared invoice void implementation private", () => {
    expect(migration).toContain(
      "rename to _void_completed_invoice_atomic_v2_impl_00250",
    );
    expect(migration).toContain(
      "_void_completed_invoice_atomic_v2_impl_00250(",
    );
    expect(migration).toContain(
      "revoke all on function public._void_completed_invoice_atomic_v2_impl_00250",
    );
  });

  it("closes kitchen orders only behind the FnB source boundary", () => {
    expect(migration).toContain("i.source = 'fnb'");
    expect(migration).toContain("i.status = 'cancelled'");
    expect(migration).toContain("ko.invoice_id");
    expect(migration).toContain("set status = 'cancelled'");
    expect(migration).toContain("fnb_kitchen_orders_cancelled");
  });

  it("does not recreate Retail stock, cash or invoice reversal logic", () => {
    expect(migration).not.toContain("insert into public.stock_movements");
    expect(migration).not.toContain("insert into public.cash_transactions");
    expect(migration).not.toContain("update public.invoices");
    expect(migration).not.toContain("pos_retail.void");
  });

  it("bounds and verifies the one-time reconciliation", () => {
    expect(migration).toContain("v_mismatch_count > 50");
    expect(migration).toContain("fnb_00380_unexpected_mismatch_count");
    expect(migration).toContain("fnb_00380_reconcile_failed");
  });
});
