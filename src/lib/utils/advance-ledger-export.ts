import type { PartyAdvanceLedgerRow } from "@/lib/services/supabase/cash-book";
import { cashCategoryLabel } from "./cash-book-labels";

export function advanceLedgerExportRows(
  rows: PartyAdvanceLedgerRow[],
  party: string,
  mode: "supplier" | "customer",
) {
  return rows.flatMap((r) => {
    const details = [
      ...r.allocations.map((a) => ({
        document: a.documentCode,
        applied: a.amount,
        refundAmount: 0,
        allocationType: "Cấn tiền ứng",
        allocationNote: a.note,
        allocatedAt: a.createdAt,
        detailStatus: "Hoàn thành",
        cancellationReason: "",
      })),
      ...(r.refunds ?? []).map((a) => ({
        document: a.cashCode,
        applied: 0,
        refundAmount: a.amount,
        allocationType: cashCategoryLabel(`${mode}_advance_refund`),
        allocationNote: a.note,
        allocatedAt: a.date,
        detailStatus: a.status === "cancelled" ? "Đã hủy" : "Hoàn thành",
        cancellationReason: a.cancellationReason ?? "",
      })),
    ];
    if (!details.length)
      details.push({
        document: "",
        applied: 0,
        refundAmount: 0,
        allocationType: "Chưa phân bổ",
        allocationNote: "",
        allocatedAt: "",
        detailStatus: "",
        cancellationReason: "",
      });
    return details.map((detail, index) => ({
      ...detail,
      party,
      branch: r.branchName,
      cash: r.cashCode,
      date: r.date,
      note: r.note,
      operation: cashCategoryLabel(`${mode}_advance`),
      status:
        r.status === "cancelled"
          ? "Đã hủy"
          : r.status === "exhausted"
            ? "Không còn ứng"
            : "Còn hiệu lực",
      // Source totals occur once even when a source has many allocations/refunds.
      original: index === 0 ? r.originalAmount : null,
      remaining: index === 0 ? r.remainingAmount : null,
      refunded: index === 0 ? (r.refundedAmount ?? 0) : null,
    }));
  });
}
