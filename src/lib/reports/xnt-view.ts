import type { XntReportResult, XntRow } from "@/lib/services/supabase/xnt-report";

export type XntRowFilter = "activity" | "closing-stock" | "all";

const QUANTITY_EPSILON = 1e-9;

function isNonZero(value: number): boolean {
  return Math.abs(value) > QUANTITY_EPSILON;
}

export function filterXntRows(
  rows: XntRow[],
  filter: XntRowFilter,
): XntRow[] {
  if (filter === "all") return rows;
  if (filter === "closing-stock") {
    return rows.filter((row) => isNonZero(row.closingQty));
  }

  return rows.filter((row) =>
    [row.openingQty, row.totalIn, row.totalOut, row.closingQty].some(isNonZero),
  );
}

export function sumXntRows(rows: XntRow[]): XntReportResult["subtotal"] {
  return rows.reduce<XntReportResult["subtotal"]>(
    (sum, row) => ({
      productCount: sum.productCount + 1,
      openingQty: sum.openingQty + row.openingQty,
      openingValue: sum.openingValue + row.openingValue,
      totalIn: sum.totalIn + row.totalIn,
      inValue: sum.inValue + row.inValue,
      totalOut: sum.totalOut + row.totalOut,
      outValue: sum.outValue + row.outValue,
      closingQty: sum.closingQty + row.closingQty,
      closingValue: sum.closingValue + row.closingValue,
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
    },
  );
}
