import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/00361_repair_legacy_sugar_modifier_stock_effect.sql",
  ),
  "utf8",
);

describe("00361 legacy sugar modifier repair", () => {
  it("removes direct stock consumption while retaining BOM fallback factors", () => {
    expect(migration).toContain("set linked_product_id = null");
    expect(migration).toContain("when '100%' then 1");
    expect(migration).toContain("when '120%' then 1.2");
    expect(migration).toContain("sugar.code = 'SKU-BOT-009'");
  });

  it("sets 100 percent as the single shared default", () => {
    expect(migration).toContain("set is_default = false");
    expect(migration).toContain("set is_default = true");
    expect(migration).toContain("btrim(o.label) = '100%'");
  });

  it("does not modify exact per-BOM quantity tables", () => {
    expect(migration).not.toMatch(/update\s+public\.bom_items/i);
    expect(migration).not.toMatch(/update\s+public\.bom_modifier_option_quantities/i);
  });
});
