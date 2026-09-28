import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  summarizeReconciledShiftDetail,
  type ReconciledShiftCashDetail,
  type ReconciledShiftInvoiceDetail,
} from "@/lib/services/supabase/shifts";

const invoice = (
  overrides: Partial<ReconciledShiftInvoiceDetail>,
): ReconciledShiftInvoiceDetail => ({
  id: "invoice-1",
  code: "HD000001",
  customerName: "Khách lẻ",
  status: "completed",
  total: 100_000,
  paid: 100_000,
  paymentMethod: "cash",
  source: "fnb",
  createdAt: "2026-09-28T10:00:00Z",
  voidReason: null,
  ...overrides,
});

const transaction = (
  overrides: Partial<ReconciledShiftCashDetail>,
): ReconciledShiftCashDetail => ({
  id: "cash-1",
  code: "PT000001",
  type: "receipt",
  category: "Bán hàng",
  amount: 100_000,
  paymentMethod: "cash",
  status: "completed",
  referenceType: "invoice",
  referenceId: "invoice-1",
  note: null,
  transactionDate: "2026-09-28T10:00:00Z",
  ...overrides,
});

describe("shift reconciliation document drill-down", () => {
  it("separates effective and cancelled invoices", () => {
    const summary = summarizeReconciledShiftDetail(
      [
        invoice({ id: "invoice-1", total: 100_000 }),
        invoice({ id: "invoice-2", status: "cancelled", total: 40_000 }),
      ],
      [],
    );

    expect(summary.completedInvoiceCount).toBe(1);
    expect(summary.cancelledInvoiceCount).toBe(1);
    expect(summary.completedSales).toBe(100_000);
  });

  it("nets a completed cash refund against its original receipt", () => {
    const summary = summarizeReconciledShiftDetail(
      [],
      [
        transaction({ id: "receipt", amount: 79_000 }),
        transaction({
          id: "refund",
          code: "PC000001",
          type: "payment",
          category: "Hoàn tiền hủy đơn",
          amount: 79_000,
          referenceType: "invoice_void",
        }),
      ],
    );

    expect(summary.cashReceipts).toBe(79_000);
    expect(summary.cashPayments).toBe(79_000);
    expect(summary.netCashMovement).toBe(0);
  });

  it("excludes cancelled cash rows and keeps non-cash out of expected cash", () => {
    const summary = summarizeReconciledShiftDetail(
      [],
      [
        transaction({ id: "transfer", paymentMethod: "transfer", amount: 120_000 }),
        transaction({ id: "cancelled", status: "cancelled", amount: 50_000 }),
      ],
    );

    expect(summary.ledgerReceipts).toBe(120_000);
    expect(summary.cashReceipts).toBe(0);
    expect(summary.netCashMovement).toBe(0);
  });

  it("loads both sources by exact shift id and exposes the report action", () => {
    const service = readFileSync("src/lib/services/supabase/shifts.ts", "utf8");
    const page = readFileSync(
      "src/app/(main)/phan-tich/doi-chieu-ca/page.tsx",
      "utf8",
    );

    expect(service.match(/\.eq\("shift_id", shiftId\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(service).toContain("Promise.all");
    expect(page).toContain("Đối soát chứng từ trong ca");
    expect(page).toContain("Dự kiến từ sổ");
    expect(page).toContain("Phiếu thu chi trong ca");
  });
});
