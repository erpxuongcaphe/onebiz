import { describe, expect, it } from "vitest";
import { shiftSalesEmptyMessage, summarizeShiftCashRows, type ShiftCashRow } from "@/lib/shift-cash-preview";

const row = (changes: Partial<ShiftCashRow>): ShiftCashRow => ({
  code: "PT001",
  type: "receipt",
  amount: 0,
  payment_method: "cash",
  status: "completed",
  reference_type: "invoice",
  reference_id: "invoice-1",
  category: "Bán hàng",
  note: null,
  created_at: "2026-09-15T08:00:00Z",
  ...changes,
});

describe("shift cash preview", () => {
  it("does not call a fully refunded shift empty", () => {
    const preview = summarizeShiftCashRows([
      row({ amount: 20000 }),
      row({ code: "PC001", type: "payment", amount: 10000, reference_type: "sales_return" }),
      row({ code: "PC002", type: "payment", amount: 10000, reference_type: "sales_return" }),
    ], 0, new Set());
    expect(preview).toMatchObject({ cashIn: 20000, cashOut: 20000, totalSales: 0, salesByMethod: {} });
    expect(preview.cashEntries).toHaveLength(3);
    expect(shiftSalesEmptyMessage({ ...preview, totalOrders: 1 })).toBe("Doanh thu ròng bằng 0");
  });

  it("recognizes zero-price sales even without cash movement", () => {
    expect(shiftSalesEmptyMessage({ totalOrders: 1, totalSales: 0, cashIn: 0, cashOut: 0 }))
      .toBe("Doanh thu ròng bằng 0");
  });

  it("does not label non-sales cash receipts as no transactions", () => {
    expect(shiftSalesEmptyMessage({ totalOrders: 0, totalSales: 0, cashIn: 50000, cashOut: 0 }))
      .toBe("Chưa có doanh thu bán hàng theo phương thức");
    expect(shiftSalesEmptyMessage({ totalOrders: 0, totalSales: 0, cashIn: 0, cashOut: 50000 }))
      .toBe("Chưa có doanh thu bán hàng theo phương thức");
  });

  it("describes an empty shift without claiming knowledge of non-cash transactions", () => {
    expect(shiftSalesEmptyMessage({ totalOrders: 0, totalSales: 0, cashIn: 0, cashOut: 0 }))
      .toBe("Chưa có doanh thu bán hàng");
  });

  it("shows a negative drawer when refunds exceed the cash in that shift", () => {
    const result = summarizeShiftCashRows([
      row({ code: "PT001", amount: 52000 }),
      row({
        code: "PC001", type: "payment", amount: 153000,
        reference_type: "sales_return", note: "Hoàn đơn ca trước",
      }),
    ], 0, new Set());

    expect(result).toMatchObject({ cashIn: 52000, cashOut: 153000, expectedCash: -101000 });
    expect(result.cashEntries.map((entry) => entry.code)).toEqual(["PT001", "PC001"]);
  });

  it("omits cancelled and non-cash rows from the drawer, but keeps other payment methods in sales", () => {
    const result = summarizeShiftCashRows([
      row({ code: "PT-CANCEL", amount: 10000, status: "cancelled" }),
      row({ code: "PT-CARD", amount: 20000, payment_method: "card" }),
      row({ code: "PT-CASH", amount: 30000 }),
    ], 5000, new Set());

    expect(result).toMatchObject({
      cashIn: 30000, cashOut: 0, expectedCash: 35000,
      totalSales: 50000, salesByMethod: { card: 20000, cash: 30000 },
    });
    expect(result.cashEntries.map((entry) => entry.code)).toEqual(["PT-CASH"]);
  });

  it("recognizes only F&B invoice voids as sales reversals", () => {
    const rows = [
      row({ code: "PT001", amount: 79000 }),
      row({
        code: "PC001", type: "payment", amount: 79000,
        reference_type: "invoice_void", reference_id: "invoice-1",
      }),
    ];
    expect(summarizeShiftCashRows(rows, 0, new Set(["invoice-1"])).totalSales).toBe(0);
    expect(summarizeShiftCashRows(rows, 0, new Set()).totalSales).toBe(79000);
  });
});
