import { describe, expect, it } from "vitest";
import { historicalUnitValue, withXntUnitValues, XNT_SUMMARY_COLUMN_GROUPS, XNT_SUMMARY_EXCEL_COLUMNS, expandXntExcelColumns, xntMovementValueTotals, XNT_DETAIL_COLUMN_GROUPS } from "@/lib/reports/xnt-unit-values";
import type { XntRow } from "@/lib/services/supabase/xnt-report";

describe("XNT historical average unit values", () => {
  it("preserves bucket values even when opening valuation is unknown", () => {
    const row = withXntUnitValues({ openingQty: 2, openingValue: null, inSupplier: 3, outSale: 1, inOther: 0,
      movementValues: { inSupplier: 90, outSale: null }, totalIn: 3, totalOut: 1 } as XntRow);
    expect(row).toMatchObject({ inSupplierValue: 90, inSupplierUnitValue: 30, outSaleValue: null, inOtherValue: 0, inOtherUnitValue: null });
    expect(xntMovementValueTotals([row])).toMatchObject({ inSupplierValue: 90, outSaleValue: null, inOtherValue: 0 });
  });
  it("expands every movement into quantity, unit price and amount for Excel", () => {
    const columns = expandXntExcelColumns([{ key: "code", label: "Mã", width: 18 }, { key: "inSupplier", label: "NCC", width: 16 }]);
    expect(columns.map(c => c.key)).toEqual(["code", "inSupplier", "inSupplierUnitValue", "inSupplierValue"]);
    expect(XNT_DETAIL_COLUMN_GROUPS.reduce((sum, group) => sum + group.span, 0)).toBe(49);
  });
  it("uses the historical amount per quantity without rounding the input", () => {
    expect(historicalUnitValue(750, 41000)).toBeCloseTo(54.6666666667);
    expect(historicalUnitValue(0.005, 13.333)).toBeCloseTo(2666.6);
    expect(historicalUnitValue(2, 0)).toBe(0);
  });
  it("does not invent a price for zero quantities, missing history or invalid numbers", () => {
    expect(historicalUnitValue(0, 0)).toBeNull();
    expect(historicalUnitValue(0, 500)).toBeNull();
    expect(historicalUnitValue(1, null)).toBeNull();
    expect(historicalUnitValue(NaN, 5)).toBeNull();
    expect(historicalUnitValue(1, Infinity)).toBeNull();
  });
  it("preserves negative stock rather than hiding its valuation", () => {
    expect(historicalUnitValue(-2, -100)).toBe(50);
  });
  it("keeps independent period prices and source values unchanged", () => {
    const row = { openingQty: 2, openingValue: null, totalIn: 3, inValue: 90, totalOut: 1, outValue: 20, closingQty: 4, closingValue: null } as XntRow;
    expect(withXntUnitValues(row)).toMatchObject({ openingUnitValue: null, inUnitValue: 30, outUnitValue: 20, closingUnitValue: null });
    expect(row).not.toHaveProperty("inUnitValue");
  });
  it("places codes vertically first and has four three-column value groups", () => {
    expect(XNT_SUMMARY_EXCEL_COLUMNS).toHaveLength(15);
    expect(XNT_SUMMARY_EXCEL_COLUMNS[0]).toMatchObject({ key: "code", hideable: false });
    expect(XNT_SUMMARY_COLUMN_GROUPS.reduce((n, g) => n + g.span, 0)).toBe(15);
    expect(XNT_SUMMARY_EXCEL_COLUMNS.filter(c => "format" in c && c.format === "number")).toHaveLength(8);
  });
});
