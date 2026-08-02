import { describe, expect, it } from "vitest";
import {
  filterPosIntegrityRows,
  getPosIntegrityCounts,
  type PosInvoiceIntegrityRow,
} from "@/lib/services/supabase/pos-integrity";

function makeRow(
  invoiceCode: string,
  status: string,
): PosInvoiceIntegrityRow {
  return {
    invoiceId: invoiceCode,
    invoiceCode,
    branchId: "branch-1",
    status,
    createdAt: "2026-08-01T03:00:00.000Z",
    invoiceSubtotal: 100_000,
    detailSubtotal: 100_000,
    invoiceDiscount: 0,
    detailDiscount: 0,
    invoiceTotal: 110_000,
    formulaTotal: 100_000,
    largestDifference: 10_000,
    issueCodes: ["TOTAL_VS_FORMULA"],
  };
}

describe("POS integrity report classification", () => {
  const rows = [
    makeRow("HD-ACTIVE", "completed"),
    makeRow("NH-DRAFT", "draft"),
    makeRow("HD-CANCELLED", "cancelled"),
  ];

  it("counts actionable and cancelled invoices separately", () => {
    expect(getPosIntegrityCounts(rows)).toEqual({
      actionable: 2,
      cancelled: 1,
      all: 3,
    });
  });

  it("shows only active issues by default", () => {
    expect(
      filterPosIntegrityRows(rows, "actionable").map((row) => row.invoiceCode),
    ).toEqual(["HD-ACTIVE", "NH-DRAFT"]);
  });

  it("keeps cancelled invoices available as historical evidence", () => {
    expect(
      filterPosIntegrityRows(rows, "cancelled").map((row) => row.invoiceCode),
    ).toEqual(["HD-CANCELLED"]);
    expect(filterPosIntegrityRows(rows, "all")).toEqual(rows);
  });
});