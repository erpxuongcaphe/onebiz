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

describe("00285 repair rerun guard", () => {
  it("stops before replacing previous evidence or backups", () => {
    expect(repair).toContain("FIFO_REPAIR_00285_ALREADY_RAN");
    expect(repair).toContain("Existing repair evidence and backups were preserved");
    expect(repair).not.toMatch(
      /drop table if exists public\.(fifo_repair_plan|product_lots_backup|lot_allocations_backup)_00285/i,
    );
  });
});
