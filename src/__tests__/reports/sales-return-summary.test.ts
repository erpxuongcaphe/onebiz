import { describe, expect, it } from "vitest";
import { summarizeSalesReturns } from "@/lib/reports/sales-return-summary";
import type { SalesReturnRow } from "@/lib/services/supabase/sales-reports";

function row(overrides: Partial<SalesReturnRow>): SalesReturnRow {
  return {
    returnId: "ret-1",
    returnCode: "TH001",
    returnDate: "2026-09-22T03:00:00Z",
    branchId: "branch-1",
    branchName: "Quán A",
    invoiceId: "inv-1",
    invoiceCode: "HD001",
    customerName: "Khách A",
    reason: "Đổi hàng",
    status: "completed",
    createdBy: "staff-1",
    createdByName: "Trang",
    productId: "sku-1",
    productName: "Món 1",
    quantity: 1,
    unitPrice: 100,
    returnValue: 100,
    ...overrides,
  };
}

describe("sales return report summaries", () => {
  it("counts each return document once across item, reason, staff and day views", () => {
    const summary = summarizeSalesReturns([
      row({}),
      row({ productId: "sku-2", productName: "Món 2", returnValue: 50 }),
      row({ returnId: "ret-2", returnCode: "TH002", returnDate: "2026-09-22T11:00:00Z", returnValue: 30 }),
    ]);

    expect(summary).toMatchObject({ totalValue: 180, totalQty: 3, returnCount: 2, productCount: 2 });
    expect(summary.byDay[0]).toMatchObject({ date: "2026-09-22", returnCount: 2, productLines: 3, value: 180 });
    expect(summary.byDocument.map((document) => [document.code, document.productLines, document.value]))
      .toEqual([["TH002", 1, 30], ["TH001", 2, 150]]);
    expect(summary.byReason[0]).toMatchObject({ count: 2, qty: 3, value: 180 });
    expect(summary.byStaff[0]).toMatchObject({ count: 2, value: 180 });
  });

  it("uses Vietnam business date across UTC midnight and respects filtered rows", () => {
    const summary = summarizeSalesReturns([
      row({ returnDate: "2026-09-21T18:00:00Z", reason: "Sai món" }),
    ]);
    expect(summary.byDay[0].date).toBe("2026-09-22");
    expect(summary.byReason.map((reason) => reason.reason)).toEqual(["Sai món"]);
    expect(summarizeSalesReturns([])).toMatchObject({ returnCount: 0, totalValue: 0, byDay: [] });
  });
});
