import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/00389_fnb_prepared_stock_items.sql",
  "utf8",
);

describe("00389 F&B prepared stock", () => {
  it("is opt-in and preserves every existing product by default", () => {
    expect(migration).toContain(
      "is_fnb_stock_item boolean not null default false",
    );
    expect(migration).not.toMatch(/update\s+public\.products\s+set\s+is_fnb_stock_item/i);
  });

  it("keeps prepared stock hidden from POS and assigns an explicit role", () => {
    expect(migration).toContain("products_fnb_stock_item_shape_check");
    expect(migration).toContain("and allow_sale = false");
    expect(migration).toContain(
      "when is_fnb_stock_item then 'fnb_stock_item'",
    );
  });
});
