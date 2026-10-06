import { describe, expect, it } from "vitest";
import { summarizeRecognition, validateRecognitionEvent, type RecognitionEvent, type RecognitionSettlement } from "@/lib/reports/management-recognition";

const event: RecognitionEvent = { id: "electricity", kind: "expense", categoryId: "utilities", recognitionDate: "2026-09-30", amount: 1000, status: "posted", allocations: [{ branchId: "xtb", amount: 600 }, { branchId: "retail", amount: 400 }] };
const payment: RecognitionSettlement = { id: "settlement-1", eventId: event.id, cashTransactionId: "cash-1", amount: 300, paymentDate: "2026-10-05", status: "completed" };
describe("management recognition, separate from cash", () => {
  it("recognizes September expense once even when paid in October", () => {
    expect(summarizeRecognition([event], [payment], { from: "2026-09-01", to: "2026-09-30" }))
      .toMatchObject({ expense: 1000, netResult: -1000, rows: [{ settledAmount: 0, outstandingAmount: 1000 }] });
    expect(summarizeRecognition([event], [payment], { from: "2026-10-01", to: "2026-10-31" }).expense).toBe(0);
  });
  it("branch allocations preserve the chain total without adding a second expense", () => {
    const range = { from: "2026-09-01", to: "2026-09-30" };
    expect(summarizeRecognition([event], [], { ...range, branchId: "xtb" }).expense).toBe(600);
    expect(summarizeRecognition([event], [], { ...range, branchId: "retail" }).expense).toBe(400);
    expect(summarizeRecognition([event], [], range).expense).toBe(1000);
  });
  it("supports partial/multiple payments and excludes cancelled settlement", () => {
    const payments = [payment, { ...payment, id: "2", cashTransactionId: "2", amount: 200 }, { ...payment, id: "3", cashTransactionId: "3", amount: 500, status: "cancelled" as const }];
    expect(summarizeRecognition([event], payments, { from: "2026-09-01", to: "2026-10-31" }).rows[0].outstandingAmount).toBe(500);
  });
  it("excludes non-P&L events from income and expense", () => {
    expect(summarizeRecognition([{ ...event, kind: "non_pnl" }], [], { from: "2026-09-01", to: "2026-09-30" }))
      .toMatchObject({ income: 0, expense: 0, netResult: 0 });
  });
  it("rejects unbalanced or duplicate branch allocation", () => {
    expect(() => validateRecognitionEvent({ ...event, allocations: [{ branchId: "xtb", amount: 900 }] })).toThrow("Tổng phân bổ");
    expect(() => validateRecognitionEvent({ ...event, allocations: [{ branchId: "xtb", amount: 600 }, { branchId: "xtb", amount: 400 }] })).toThrow("trùng");
  });
  it("does not hide overpayment, duplicate cash references or missing source", () => {
    const range = { from: "2026-09-01", to: "2026-09-30" };
    expect(() => summarizeRecognition([event], [{ ...payment, amount: 1001 }], range)).toThrow("vượt");
    expect(() => summarizeRecognition([event], [payment, { ...payment, id: "2" }], range)).toThrow("trùng");
    expect(() => summarizeRecognition([], [payment], range)).toThrow("Liên kết");
  });
  it("requires reversing active payments before cancelling an event", () => {
    expect(() => summarizeRecognition([{ ...event, status: "cancelled" }], [payment], { from: "2026-09-01", to: "2026-09-30" })).toThrow("chưa đảo");
  });
  it("rejects invalid dates and nonfinite amounts", () => {
    expect(() => validateRecognitionEvent({ ...event, recognitionDate: "2026-02-30" })).toThrow("Ngày");
    expect(() => validateRecognitionEvent({ ...event, amount: Number.NaN })).toThrow("Số tiền");
    expect(() => validateRecognitionEvent({ ...event, amount: 1000.001 })).toThrow("Số tiền");
  });
  it("recognizes income once regardless of number of receipts", () => {
    expect(summarizeRecognition([{ ...event, kind: "income" }], [payment, { ...payment, id: "2", cashTransactionId: "2", amount: 100 }],
      { from: "2026-09-01", to: "2026-10-31" })).toMatchObject({ income: 1000, expense: 0, netResult: 1000 });
  });
});
