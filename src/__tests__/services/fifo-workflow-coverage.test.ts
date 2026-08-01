import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/00287_complete_fifo_workflow_coverage.sql",
  ),
  "utf8",
);

describe("00287 complete FIFO workflow coverage", () => {
  it("does not write to real stock or the immutable stock ledger", () => {
    expect(migration).not.toMatch(/update\s+public\.branch_stock\s+set/i);
    expect(migration).not.toMatch(/update\s+public\.products\s+set/i);
    expect(migration).not.toMatch(/insert\s+into\s+public\.stock_movements/i);
    expect(migration).not.toMatch(/delete\s+from\s+public\.stock_movements/i);
  });

  it.each([
    "apply_manual_stock_movement_atomic",
    "create_sales_return_atomic",
    "create_internal_sale_atomic",
    "void_disposal_export_atomic",
    "void_internal_export_atomic",
  ])("wraps %s in the same database transaction", (functionName) => {
    expect(migration).toContain(functionName);
    expect(migration).toContain("_reconcile_product_lots_to_branch_00284");
  });

  it("keeps every preserved implementation private", () => {
    const privateFunctions = [
      "_apply_manual_stock_movement_auth_impl_00246",
      "_create_sales_return_auth_impl_00244",
      "_create_internal_sale_auth_impl_00243",
      "_void_disposal_export_auth_impl_00246",
      "_void_internal_export_auth_impl_00246",
    ];

    for (const functionName of privateFunctions) {
      expect(migration).toMatch(
        new RegExp(
          `revoke all on function public\\.${functionName}[\\s\\S]*?from public, anon, authenticated`,
          "i",
        ),
      );
    }
  });

  it("removes the brittle allocation source enum", () => {
    expect(migration).toContain(
      "drop constraint if exists lot_allocations_source_type_check",
    );
    expect(migration).not.toMatch(
      /add constraint\s+lot_allocations_source_type_check/i,
    );
  });
});
