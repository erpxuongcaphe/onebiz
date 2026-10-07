import { describe, expect, it } from "vitest";
import { isFnbMenuSaleItem, matchesFnbMenuSearch } from "@/lib/fnb-menu-search";

describe("F&B menu search", () => {
  it("keeps a packaged retail menu SKU but rejects input stock and unclassified legacy cache", () => {
    expect(isFnbMenuSaleItem({ inventory_role: "fnb_menu_item", is_fnb_stock_item: false })).toBe(true);
    expect(isFnbMenuSaleItem({ inventory_role: "stock_item", is_fnb_stock_item: true })).toBe(false);
    expect(isFnbMenuSaleItem({ inventory_role: "fnb_menu_item", is_fnb_stock_item: true })).toBe(false);
    expect(isFnbMenuSaleItem({})).toBe(false);
  });
  it("finds the same menu with accented text, plain typing or exact SKU", () => {
    const product = { name: "Xưởng Gu Việt - Phin Sữa", code: "SKU-CAP-013" };
    expect(matchesFnbMenuSearch(product, "xưởng gu việt")).toBe(true);
    expect(matchesFnbMenuSearch(product, "  xuong gu viet  ")).toBe(true);
    expect(matchesFnbMenuSearch(product, "sku-cap-013")).toBe(true);
    expect(matchesFnbMenuSearch(product, "gu matcha")).toBe(false);
  });
});
