import { describe, expect, it } from "vitest";
import { advanceLedgerExportRows } from "@/lib/utils/advance-ledger-export";
import { cashCategoryLabel } from "@/lib/utils/cash-book-labels";
describe("advance refund source export", () => {
  it("includes allocations, completed/cancelled refunds and source totals only once", () => {
    const rows = advanceLedgerExportRows(
      [
        {
          id: "advance",
          branchId: "branch",
          branchName: "Kho Tổng",
          cashCode: "PC1",
          date: "2026-10-01",
          note: "Ứng mua nguyên liệu",
          originalAmount: 1000,
          remainingAmount: 500,
          status: "active",
          appliedAmount: 300,
          refundedAmount: 200,
          allocations: [
            {
              documentCode: "PO1",
              amount: 300,
              note: "Cấn PO1",
              createdAt: "2026-10-02",
            },
          ],
          refunds: [
            {
              cashId: "r1",
              cashCode: "PT1",
              amount: 200,
              date: "2026-10-03",
              note: "NCC hoàn phần dư",
              status: "completed",
              cancellationReason: null,
            },
            {
              cashId: "r2",
              cashCode: "PT2",
              amount: 50,
              date: "2026-10-03",
              note: "Phiếu hoàn nhầm",
              status: "cancelled",
              cancellationReason: "Nhập trùng",
            },
          ],
        },
      ],
      "NCC thử",
      "supplier",
    );
    expect(rows).toHaveLength(3);
    expect(rows.reduce((sum, r) => sum + (r.original ?? 0), 0)).toBe(1000);
    expect(rows.reduce((sum, r) => sum + (r.refunded ?? 0), 0)).toBe(200);
    expect(rows[2]).toMatchObject({
      detailStatus: "Đã hủy",
      cancellationReason: "Nhập trùng",
      refundAmount: 50,
    });
    expect(rows[1].allocationType).toBe(
      cashCategoryLabel("supplier_advance_refund"),
    );
  });
});
