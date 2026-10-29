import { expect, it } from "vitest";
import { currentUnitRules, recordedCountUnits } from "@/lib/reports/stock-unit-context";
import type { UOMConversion } from "@/lib/types";
const conversion = (factor = 50, isActive = true): UOMConversion => ({ id: "u", tenantId: "t", productId: "p", fromUnit: "Cây", toUnit: "Cái", factor, isActive, createdAt: "" });
it("uses only the product's configured direct conversions, including inverse and fractional units", () => {
  expect(currentUnitRules("Cái", [conversion()])).toBe("1 Cây = 50 Cái");
  expect(currentUnitRules("Cây", [conversion()])).toBe("1 Cái = 0.02 Cây");
  expect(currentUnitRules("Cái", [])).toBe("");
  expect(currentUnitRules("Cái", [conversion(0.000001)])).toBe("1 Cây = 0.000001 Cái");
});
it("does not guess conflicting, inactive, invalid or unrelated package sizes", () => {
  expect(currentUnitRules("Cái", [conversion(50), conversion(100)])).toBe("");
  expect(currentUnitRules("Cái", [conversion(50, false), conversion(Infinity), conversion(0)])).toBe("");
  expect(currentUnitRules("G", [conversion()])).toBe("");
});
it("preserves the historical entry even when current packaging later changes", () => {
  const snapshot = { stockUnit: "Cái", stockQuantity: 100, inputUnit: "Cây", inputQuantity: 2, conversionFactor: 50 };
  expect(recordedCountUnits(snapshot, 100)).toEqual({ recordedUnit: "Cái", recordedCount: "2 Cây", recordedConversion: "1 Cây = 50 Cái" });
  expect(currentUnitRules("Cái", [conversion(100)])).toBe("1 Cây = 100 Cái");
  expect(recordedCountUnits({ ...snapshot, parts: [{ quantity: 1, unit: "Cây" }, { quantity: 50, unit: "Cái" }] }, 100).recordedCount).toBe("1 Cây + 50 Cái");
});
it.each([null, {}, { stockUnit: "Cái", stockQuantity: 100, inputUnit: "Cây", inputQuantity: 2, conversionFactor: 100 }, { stockUnit: "Cái", stockQuantity: 100, inputUnit: "Cây", inputQuantity: null, conversionFactor: 50 }])("does not fabricate a unit or input count from an invalid snapshot", value => {
  expect(recordedCountUnits(value, 100)).toEqual({ recordedUnit: null, recordedCount: null, recordedConversion: null });
});
it("rejects a stale snapshot after the count was amended and permits a genuine zero count", () => {
  const snapshot = { stockUnit: "Cái", stockQuantity: 100, inputUnit: "Cây", inputQuantity: 2, conversionFactor: 50 };
  expect(recordedCountUnits(snapshot, 99).recordedCount).toBeNull();
  expect(recordedCountUnits(snapshot, NaN).recordedCount).toBeNull();
  expect(recordedCountUnits({ ...snapshot, stockQuantity: 0, inputQuantity: 0 }, 0).recordedCount).toBe("0 Cây");
});
