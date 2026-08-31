import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/00362_decouple_sugar_labels_from_stock_rules.sql",
  ),
  "utf8",
);

describe("00362 sugar label independence", () => {
  it("removes the conflicting direct stock link", () => {
    expect(migration).toContain("set linked_product_id = null");
    expect(migration).toContain("sugar.code = 'SKU-BOT-009'");
    expect(migration).toContain("o.scale_factor is not null");
  });

  it("repairs the known legacy factors once", () => {
    expect(migration).toContain("when '100%' then 1");
    expect(migration).toContain("when '120%' then 1.2");
  });

  it("does not treat display labels as business keys", () => {
    expect(migration).not.toMatch(/set\s+is_default\s*=/i);
    expect(migration).not.toMatch(/set\s+label\s*=/i);
    expect(migration).not.toContain("btrim(o.label) = '100%'");
  });

  it("does not modify exact BOM quantities", () => {
    expect(migration).not.toMatch(/update\s+public\.bom_items/i);
    expect(migration).not.toMatch(/update\s+public\.bom_modifier_option_quantities/i);
  });
});
