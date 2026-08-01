import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/00286_stock_invariant_physical_lot_scope.sql",
  ),
  "utf8",
);

describe("00286 physical lot invariant", () => {
  it("counts active and expired lots as physical stock", () => {
    expect(migration).toContain("status in ('active', 'expired')");
    expect(migration).toContain("active + expired");
  });

  it("keeps consumed-only tracked pairs visible", () => {
    expect(migration).toContain("tracked_pairs");
    expect(migration).toMatch(/select distinct tenant_id, branch_id, product_id/i);
  });

  it("does not change business data", () => {
    expect(migration).not.toMatch(/insert\s+into\s+public\./i);
    expect(migration).not.toMatch(/update\s+public\./i);
    expect(migration).not.toMatch(/delete\s+from\s+public\./i);
  });
});
