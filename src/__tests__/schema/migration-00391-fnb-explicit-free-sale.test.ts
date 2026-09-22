import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/00391_fnb_explicit_free_sale.sql"),
  "utf8",
);

describe("00391 explicit FnB free sale", () => {
  it("defaults existing products to false and scopes the opt-in to direct FnB sale", () => {
    expect(migration).toContain("allow_free_sale boolean not null default false");
    expect(migration).toContain("product_type = 'sku'");
    expect(migration).toContain("channel = 'fnb'");
    expect(migration).toContain("allow_sale = true");
    expect(migration).toContain("is_fnb_stock_item");
  });
});
