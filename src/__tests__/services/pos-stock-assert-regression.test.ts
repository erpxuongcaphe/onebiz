import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const repairMigration = readFileSync(
  "supabase/migrations/00295_restore_pos_stock_assert_is_active.sql",
  "utf8",
);
const pricingMigration = readFileSync(
  "supabase/migrations/00253_harden_retail_pos_pricing.sql",
  "utf8",
);
const revisionMigration = readFileSync(
  "supabase/migrations/00292_pos_draft_revision_guard.sql",
  "utf8",
);

const repairedFunction = repairMigration.slice(
  repairMigration.indexOf(
    "create or replace function public.assert_pos_stock_available",
  ),
  repairMigration.indexOf(
    "revoke all on function public.assert_pos_stock_available",
  ),
);

describe("POS stock assertion regression", () => {
  it("uses products.is_active instead of the removed products.status column", () => {
    expect(repairedFunction).toContain("p.is_active");
    expect(repairedFunction).not.toContain("p.status");
    expect(repairedFunction).toContain("if v_item.is_active is false");
  });

  it("keeps the repair schema-only and leaves stock and invoices untouched", () => {
    expect(repairedFunction).not.toMatch(/\binsert\s+into\b/i);
    expect(repairedFunction).not.toMatch(/\bupdate\s+public\./i);
    expect(repairedFunction).not.toMatch(/\bdelete\s+from\b/i);
  });

  it("covers the active checkout chain from v5 through the stock assertion", () => {
    expect(revisionMigration).toContain(
      "v_result := public.complete_draft_atomic_v4(",
    );
    expect(pricingMigration).toContain(
      "v_result := public.complete_draft_atomic_v3(",
    );
    expect(pricingMigration).toContain(
      "perform public.assert_pos_stock_available(",
    );
  });

  it("returns explicit installation checks after the SQL is run", () => {
    expect(repairMigration).toContain("pos_stock_assert_ok");
    expect(repairMigration).toContain("legacy_product_status_removed");
    expect(repairMigration).toContain("product_is_active_ok");
  });
});
