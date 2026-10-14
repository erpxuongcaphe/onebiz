import { describe, expect, it } from "vitest";
import { summarizePhysicalStock } from "@/lib/physical-stock-summary";

describe("physical stock totals", () => {
  const products = [
    { stock: 1100, branchStock: 600, unit: "G", channel: "retail" as const, isFnbStockItem: true },
    { stock: 750, branchStock: 200, unit: "G", channel: "retail" as const, isFnbStockItem: true },
    { stock: 12, branchStock: 3, unit: "Túi", channel: "retail" as const, isFnbStockItem: false },
    { stock: 99, branchStock: 99, unit: "Ly", channel: "fnb" as const, isFnbStockItem: false },
  ];
  it("uses the selected branch and separates grams from packages", () => {
    expect(summarizePhysicalStock(products, true)).toEqual([
      { unit: "G", quantity: 800 }, { unit: "Túi", quantity: 3 },
    ]);
  });
  it("uses master stock only in whole-chain view", () => {
    expect(summarizePhysicalStock(products, false)).toEqual([
      { unit: "G", quantity: 1850 }, { unit: "Túi", quantity: 12 },
    ]);
  });
  it("does not fall back to another branch when prepared stock is absent", () => {
    expect(summarizePhysicalStock([{ ...products[0], branchStock: undefined }], true))
      .toEqual([{ unit: "G", quantity: 0 }]);
  });
});
