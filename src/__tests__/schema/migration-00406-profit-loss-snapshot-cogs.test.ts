import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/00406_profit_loss_snapshot_cogs.sql",
  "utf8",
);

describe("snapshot-only profit and loss COGS", () => {
  it("never falls back to the current product cost", () => {
    expect(sql).not.toMatch(/products\.cost_price/i);
    expect(sql).not.toMatch(/coalesce\s*\(\s*ii\.unit_cost\s*,/i);
    expect(sql).toContain("missing_sales_cost_lines");
    expect(sql).toContain("missing_return_cost_lines");
    expect(sql).toContain("else null");
  });

  it("resolves returns conservatively and prioritizes the exact source FK", () => {
    expect(sql).toContain("exact_invoice_item_id");
    expect(sql).toContain("'exact_id'::text");
    expect(sql).toContain("'name_and_price'");
    expect(sql).toContain("'single_product_line'");
    expect(sql).toContain("order by c.priority");
  });

  it("is read-only with respect to business rows", () => {
    expect(sql).not.toMatch(/\b(update|delete)\s+public\./i);
    expect(sql).not.toMatch(/insert\s+into\s+public\./i);
  });
});
