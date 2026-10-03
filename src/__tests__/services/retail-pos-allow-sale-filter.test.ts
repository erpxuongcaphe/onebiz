import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const products = readFileSync("src/lib/services/supabase/products.ts", "utf8");
const grid = readFileSync("src/app/pos/components/product-grid.tsx", "utf8");
const pos = readFileSync("src/app/pos/page.tsx", "utf8");
const checkout = readFileSync("supabase/migrations/00253_harden_retail_pos_pricing.sql", "utf8");

describe("Retail POS excludes non-sellable stock items", () => {
  it("filters catalog and barcode search without changing general product lists", () => {
    expect(products).toContain('if (params.filters?.allowSale === "true")');
    expect(products).toContain('query = query.eq("allow_sale", true)');
    expect(grid).toContain('allowSale: "true"');
    expect(pos).toContain('filters: { status: "active", channel: "retail", productType: "sku", allowSale: "true" }');
  });

  it("keeps the server-side sale guard", () => {
    expect(checkout).toContain("and p.allow_sale = true");
  });
});
