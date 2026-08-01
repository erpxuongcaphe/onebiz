import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/00284_fifo_ledger_transaction_alignment.sql",
  ),
  "utf8",
);

describe("00284 FIFO ledger transaction alignment", () => {
  it("does not write to real stock snapshots or business documents", () => {
    expect(migration).not.toMatch(/update\s+public\.branch_stock\s+set/i);
    expect(migration).not.toMatch(/update\s+public\.products\s+set/i);
    expect(migration).not.toMatch(/insert\s+into\s+public\.stock_movements/i);
    expect(migration).not.toMatch(/delete\s+from\s+public\.stock_movements/i);
  });

  it("uses branch stock only as the locked reconciliation target", () => {
    expect(migration).toContain("_reconcile_product_lots_to_branch_00284");
    expect(migration).toMatch(/from public\.branch_stock bs[\s\S]*for update/i);
    expect(migration).toContain("insert into public.lot_allocations");
    expect(migration).toContain("'lot_reconcile'");
  });

  it("covers workflows that caused or can cause FIFO drift", () => {
    expect(migration).toContain("apply_inventory_check_atomic");
    expect(migration).toContain("complete_stock_transfer_atomic");
    expect(migration).toContain("complete_production_atomic");
    expect(migration).toContain("revert_production_materials");
    expect(migration).toContain("revert_received_purchase_order_atomic");
  });

  it("keeps the low-level reconciliation helper server-only", () => {
    expect(migration).toMatch(
      /revoke all on function public\._reconcile_product_lots_to_branch_00284[\s\S]*from public, anon, authenticated/i,
    );
    expect(migration).toMatch(
      /grant execute on function public\._reconcile_product_lots_to_branch_00284[\s\S]*to service_role/i,
    );
  });
});
