import { describe, expect, it } from "vitest";
import { calculateRecipeDraftLineCost, calculateRecipePreview } from "@/lib/reports/recipe-cost-preview";
import { getRecipeQuantityInStockUnit } from "@/lib/format-uom";
import type { UOMConversion } from "@/lib/types";
const conversions = [{ fromUnit: "Hộp", toUnit: "G", factor: 454, isActive: true }] as UOMConversion[];
describe("F&B draft cost matches persisted stock quantity", () => {
  it("uses the same four-decimal converted quantity as the saved recipe", () => {
    const normalized = getRecipeQuantityInStockUnit(120, "Hộp", "G", conversions)!;
    const value = calculateRecipeDraftLineCost(120, "Hộp", "G", conversions, 31000)!;
    expect(normalized).toBe(0.2643);
    expect(value).toBe(8193.3);
    const saved = calculateRecipePreview("root", new Map([
      ["root", { unitPrice: null, recipe: { outputQuantity: 300, outputToStockFactor: 1, lines: [{ component: "raw", quantity: normalized, wastePercent: 0 }] } }],
      ["raw", { unitPrice: 31000 }],
    ]));
    expect(saved.value).toBeCloseTo(value / 300, 10);
  });
  it("keeps genuine zero, waste, and missing conversion distinct", () => {
    expect(calculateRecipeDraftLineCost(120, "Hộp", "G", conversions, 0)).toBe(0);
    expect(calculateRecipeDraftLineCost(120, "Hộp", "G", conversions, 31000, 10)).toBe(9012.63);
    expect(calculateRecipeDraftLineCost(120, "Hộp", "G", [], 31000)).toBeNull();
    expect(calculateRecipeDraftLineCost(120, "Hộp", "G", conversions, null)).toBeNull();
    expect(calculateRecipeDraftLineCost(120, "Hộp", "G", conversions, -1)).toBeNull();
  });
});
