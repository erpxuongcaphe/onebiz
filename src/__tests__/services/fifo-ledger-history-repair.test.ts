import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repair = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/00285_repair_fifo_ledger_without_stock_change.sql",
  ),
  "utf8",
);

describe("00285 FIFO history repair", () => {
  it("never changes real stock, movements, documents, cost, debt or cash", () => {
    expect(repair).not.toMatch(/update\s+public\.branch_stock\s+set/i);
    expect(repair).not.toMatch(/update\s+public\.products\s+set/i);
    expect(repair).not.toMatch(/(?:insert into|update|delete from)\s+public\.stock_movements/i);
    expect(repair).not.toMatch(/(?:insert into|update|delete from)\s+public\.invoices/i);
    expect(repair).not.toMatch(/(?:insert into|update|delete from)\s+public\.purchase_orders/i);
    expect(repair).not.toMatch(/(?:insert into|update|delete from)\s+public\.cash_transactions/i);
  });

  it("backs up affected lots and allocations before reconciliation", () => {
    expect(repair).toContain("product_lots_backup_00285");
    expect(repair).toContain("lot_allocations_backup_00285");
    expect(repair).toContain("enable row level security");
    expect(repair).toContain("revoke all");
  });

  it("fails closed when either real-stock invariant is already broken", () => {
    expect(repair).toContain("REAL_STOCK_INVARIANT_FAILED");
    expect(repair).toContain("POST_REPAIR_INVARIANT_FAILED");
    expect(repair).toContain("NEGATIVE_BRANCH_STOCK_REQUIRES_MANUAL_REVIEW");
  });

  it("reports zero writes to real stock and stock movements", () => {
    expect(repair).toContain("0 as real_stock_rows_changed");
    expect(repair).toContain("0 as stock_movement_rows_changed");
  });
});
