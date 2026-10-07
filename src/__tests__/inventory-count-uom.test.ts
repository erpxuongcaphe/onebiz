import { describe, expect, it } from "vitest";
import { inventoryCountFromStock, inventoryCountToStock } from "@/lib/inventory-count-uom";
import type { UOMConversion } from "@/lib/types";

const conversions = [
  { fromUnit: "Lon", toUnit: "G", factor: 1000, isActive: true },
  { fromUnit: "Thùng", toUnit: "Lon", factor: 12, isActive: true },
] as UOMConversion[];

describe("inventory count units", () => {
  it("posts grams and packaging to the same stock unit exactly once", () => {
    expect(inventoryCountToStock(500, "Lon", "G", conversions)).toBe(0.5);
    expect(inventoryCountToStock(2, "Lon", "Thùng", conversions)).toBe(24);
    expect(inventoryCountToStock(24, "Lon", "Lon", conversions)).toBe(24);
  });
  it("keeps the counted stock quantity when switching units", () => {
    const grams = inventoryCountFromStock(24.5, "Lon", "G", conversions)!;
    expect(grams).toBe(24500);
    expect(inventoryCountToStock(grams, "Lon", "G", conversions)).toBe(24.5);
    const boxes = inventoryCountFromStock(24.5, "Lon", "Thùng", conversions)!;
    expect(inventoryCountToStock(boxes, "Lon", "Thùng", conversions)).toBe(24.5);
  });
  it("keeps a Cold Brew batch at 750 grams, not 100 grams", () => {
    const batches = [{ fromUnit: "Mẻ/100g", toUnit: "G", factor: 750, isActive: true }] as UOMConversion[];
    expect(inventoryCountToStock(80, "Mẻ/100g", "G", batches)).toBe(0.1067);
    expect(inventoryCountToStock(750, "Mẻ/100g", "G", batches)).toBe(1);
    expect(inventoryCountFromStock(1, "Mẻ/100g", "G", batches)).toBe(750);
  });
  it("accepts a real zero and rejects invalid or missing conversions", () => {
    expect(inventoryCountToStock(0, "Lon", "G", conversions)).toBe(0);
    expect(inventoryCountToStock(-1, "Lon", "G", conversions)).toBeNull();
    expect(inventoryCountToStock(Infinity, "Lon", "G", conversions)).toBeNull();
    expect(inventoryCountToStock(1, "Lon", "ML", conversions)).toBeNull();
    expect(inventoryCountToStock(1, "Lon", "G", [...conversions, conversions[0]])).toBeNull();
    expect(inventoryCountToStock(1, "Lon", "G", [{ ...conversions[0], isActive: false }])).toBeNull();
  });
});
