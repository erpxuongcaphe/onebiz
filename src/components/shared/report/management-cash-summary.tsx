import Link from "next/link";
import { formatCurrency } from "@/lib/format";
import type { CashFlowDetailedRow } from "@/lib/services/supabase/analytics";
import { managementReportLink } from "@/lib/reports/management-review";
import { Icon } from "@/components/ui/icon";

export function cashMovementSummary(rows: CashFlowDetailedRow[]) {
  const receipts = rows.reduce((sum, row) => sum + row.totalReceipt, 0);
  const payments = rows.reduce((sum, row) => sum + row.totalPayment, 0);
  return { receipts, payments, net: receipts - payments };
}

export function ManagementCashSummary({ rows, error, branchId, range }: {
  rows: CashFlowDetailedRow[];
  error: string | null;
  branchId?: string;
  range: { from: string; to: string };
}) {
  const totals = cashMovementSummary(rows);
  return (
    <section aria-label="Thu chi trong kỳ" className="border-y border-border py-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Thu chi trong kỳ</h2>
        <Link href={managementReportLink("/phan-tich/luong-tien", branchId, range)} className="inline-flex min-h-9 items-center gap-1 text-sm text-primary">Dòng tiền<Icon name="arrow_forward" size={16} /></Link>
      </div>
      {error ? <p role="alert" className="text-sm text-status-error">Chưa tải được thu chi. Mở báo cáo dòng tiền để kiểm tra.</p> : (
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            { label: "Tổng thu", value: totals.receipts },
            { label: "Tổng chi", value: totals.payments },
            { label: "Thu − chi", value: totals.net },
          ].map(item => <div key={item.label} className="min-w-0"><dt className="text-xs text-muted-foreground">{item.label}</dt><dd className="mt-1 break-words text-lg font-semibold tabular-nums">{formatCurrency(item.value)}đ</dd></div>)}
        </dl>
      )}
      <p className="mt-3 text-xs text-muted-foreground">Theo ngày phiếu · gồm nội bộ · không phải số dư quỹ.</p>
    </section>
  );
}
