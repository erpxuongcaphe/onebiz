import { describe, expect, it } from "vitest";
import { filterXntRows, sumXntQuantities, sumXntRows, XNT_QUANTITY_KEYS } from "@/lib/reports/xnt-view";
import type { XntRow } from "@/lib/services/supabase/xnt-report";

function row(overrides: Partial<XntRow> = {}): XntRow {
  return {
    ...Object.fromEntries(XNT_QUANTITY_KEYS.map((key) => [key, 0])),
    productId: "p1", code: "NVL-001", name: "Ingredient", unit: "G", categoryName: "Coffee",
    openingValue: 0, inValue: 0, outValue: 0, closingValue: 0,
    valuedMovementCount: 0, missingCostMovementCount: 0, valuationComplete: true,
    ...overrides,
  } as XntRow;
}

describe("XNT dimension filters and meaningful totals", () => {
  it("combines category, unit and activity filters without changing source rows", () => {
    const rows = [row({ closingQty: 2 }), row({ productId: "p2", unit: "Bottle", closingQty: 5 }), row({ productId: "p3", categoryName: null, closingQty: 8 })];
    expect(filterXntRows(rows, "closing-stock", { categoryName: "Coffee", unit: "G" })).toEqual([rows[0]]);
    expect(filterXntRows(rows, "all", { categoryName: "" })).toEqual([rows[2]]);
    expect(rows).toHaveLength(3);
  });

  it("never adds different units, while preserving monetary totals", () => {
    const rows = [row({ closingQty: 200, closingValue: 400 }), row({ unit: "Bottle", closingQty: 2, closingValue: 600 })];
    expect(Object.values(sumXntQuantities(rows)).every((value) => value === null)).toBe(true);
    expect(sumXntRows(rows).closingValue).toBe(1000);
  });

  it("totals every movement bucket for the same unit", () => {
    const rows = [row({ outInternal: 3, inOther: 8, closingQty: 5 }), row({ outInternal: 2, inOther: 6, closingQty: 4 })];
    expect(sumXntQuantities(rows)).toMatchObject({ outInternal: 5, inOther: 14, closingQty: 9 });
  });

  it("keeps empty totals finite and unknown monetary values unknown", () => {
    expect(Object.values(sumXntQuantities([])).every((value) => value === 0)).toBe(true);
    expect(sumXntRows([row({ openingValue: null, valuationComplete: false })]).openingValue).toBeNull();
    expect(filterXntRows([row()], "activity", { unit: "G" })).toEqual([]);
  });

  it("does not publish a quantity aggregate without a known unit", () => {
    expect(sumXntQuantities([row({ unit: "", closingQty: 7 })]).closingQty).toBeNull();
  });
});
