import type { XntReportResult, XntRow } from "@/lib/services/supabase/xnt-report";

export type XntRowFilter = "activity" | "closing-stock" | "all";

const QUANTITY_EPSILON = 1e-9;

function isNonZero(value: number): boolean {
  return Math.abs(value) > QUANTITY_EPSILON;
}

export function filterXntRows(
  rows: XntRow[],
  filter: XntRowFilter,
  dimensions?: { categoryName?: string; unit?: string },
): XntRow[] {
  if (dimensions?.categoryName !== undefined || dimensions?.unit !== undefined) {
    rows = rows.filter((row) =>
      (dimensions.categoryName === undefined || (row.categoryName ?? "") === dimensions.categoryName)
      && (dimensions.unit === undefined || row.unit === dimensions.unit),
    );
  }
  if (filter === "all") return rows;
  if (filter === "closing-stock") {
    return rows.filter((row) => isNonZero(row.closingQty));
  }

  return rows.filter((row) =>
    [row.openingQty, row.totalIn, row.totalOut, row.closingQty].some(isNonZero),
  );
}

export const XNT_QUANTITY_KEYS = [
  "openingQty", "totalIn", "totalOut", "closingQty",
  "inSupplier", "inCheck", "inReturn", "inTransfer", "inProduction", "inOther",
  "outSale", "outDisposal", "outSupplierReturn", "outCheck", "outTransfer",
  "outProduction", "outInternal", "outOther",
] as const;

// Quantities with different units cannot form a meaningful aggregate.
export function sumXntQuantities(rows: XntRow[]): Record<typeof XNT_QUANTITY_KEYS[number], number | null> {
  const mixedUnits = new Set(rows.map((row) => row.unit)).size > 1
    || rows.some((row) => !row.unit.trim());
  return Object.fromEntries(XNT_QUANTITY_KEYS.map((key) => [
    key, mixedUnits ? null : rows.reduce((sum, row) => sum + row[key], 0),
  ])) as Record<typeof XNT_QUANTITY_KEYS[number], number | null>;
}

export function sumXntRows(rows: XntRow[]): XntReportResult["subtotal"] {
  return rows.reduce<XntReportResult["subtotal"]>(
    (sum, row) => ({
      productCount: sum.productCount + 1,
      openingQty: sum.openingQty + row.openingQty,
      openingValue:
        sum.openingValue === null || row.openingValue === null
          ? null
          : sum.openingValue + row.openingValue,
      totalIn: sum.totalIn + row.totalIn,
      inValue:
        sum.inValue === null || row.inValue === null
          ? null
          : sum.inValue + row.inValue,
      totalOut: sum.totalOut + row.totalOut,
      outValue:
        sum.outValue === null || row.outValue === null
          ? null
          : sum.outValue + row.outValue,
      closingQty: sum.closingQty + row.closingQty,
      closingValue:
        sum.closingValue === null || row.closingValue === null
          ? null
          : sum.closingValue + row.closingValue,
      valuedProductCount: sum.valuedProductCount + (row.valuationComplete ? 1 : 0),
      incompleteValuationCount:
        sum.incompleteValuationCount + (row.valuationComplete ? 0 : 1),
    }),
    {
      productCount: 0,
      openingQty: 0,
      openingValue: 0,
      totalIn: 0,
      inValue: 0,
      totalOut: 0,
      outValue: 0,
      closingQty: 0,
      closingValue: 0,
      valuedProductCount: 0,
      incompleteValuationCount: 0,
    },
  );
}
