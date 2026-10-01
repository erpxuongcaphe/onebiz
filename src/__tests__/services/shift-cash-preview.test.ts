import { describe, expect, it } from "vitest";
import { summarizeShiftCashRows, type ShiftCashRow } from "@/lib/shift-cash-preview";

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
