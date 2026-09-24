import { describe, expect, it } from "vitest";
import { filterXntRows, sumXntRows } from "@/lib/reports/xnt-view";
import type { XntRow } from "@/lib/services/supabase/xnt-report";

function row(overrides: Partial<XntRow> = {}): XntRow {
  return {
    productId: "product-1",
    code: "SKU-001",
    name: "Mặt hàng",
    unit: "Cái",
    categoryName: null,
    openingQty: 0,
    openingValue: 0,
    inSupplier: 0,
    inCheck: 0,
    inReturn: 0,
    inTransfer: 0,
    inProduction: 0,
    outSale: 0,
    outDisposal: 0,
    outSupplierReturn: 0,
    outCheck: 0,
    outTransfer: 0,
    outProduction: 0,
    outInternal: 0,
    inOther: 0,
    outOther: 0,
    totalIn: 0,
    totalOut: 0,
    inValue: 0,
    outValue: 0,
    closingQty: 0,
    closingValue: 0,
    ...overrides,
  };
}

describe("XNT row view filters", () => {
  const inactive = row({ productId: "inactive" });
  const movementNetZero = row({
    productId: "movement",
    totalIn: 1.03,
    totalOut: 1.03,
    inValue: 51_231.9,
    outValue: 51_231.9,
  });
  const negativeClosing = row({ productId: "negative", closingQty: -2, closingValue: -500 });

  it("defaults operational view to rows with opening, movement, or closing stock", () => {
    expect(filterXntRows([inactive, movementNetZero, negativeClosing], "activity"))
      .toEqual([movementNetZero, negativeClosing]);
  });

  it("keeps negative stock visible in the closing-stock view", () => {
    expect(filterXntRows([inactive, movementNetZero, negativeClosing], "closing-stock"))
      .toEqual([negativeClosing]);
  });

  it("preserves the full catalog view", () => {
    expect(filterXntRows([inactive, movementNetZero], "all"))
      .toEqual([inactive, movementNetZero]);
  });

  it("recomputes subtotals from the displayed rows", () => {
    expect(sumXntRows([movementNetZero])).toMatchObject({
      productCount: 1,
      totalIn: 1.03,
      inValue: 51_231.9,
      totalOut: 1.03,
      outValue: 51_231.9,
      closingQty: 0,
    });
  });
});
