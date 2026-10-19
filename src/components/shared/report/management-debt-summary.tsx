import Link from "next/link";
import { formatCurrency, formatNumber } from "@/lib/format";
import { debtCapitalRows, debtCapitalTotals } from "@/lib/reports/debt-capital";
import type { DebtWorkspace } from "@/lib/services/supabase/debt-workspace";

export function managementDebtSnapshot(workspace: DebtWorkspace) {
  return {
    receivable: debtCapitalTotals(debtCapitalRows(workspace.receivables)),
    payable: debtCapitalTotals(debtCapitalRows(workspace.payables)),
  };
}

export function managementDebtLink(branchId: string | undefined, mode: "receivable" | "payable", review = "all") {
  return `/phan-tich/cong-no-aging?${new URLSearchParams({ branch: branchId ?? "all", debtMode: mode, debtReview: review, view: "table" })}`;
}

export function ManagementDebtSummary({ workspace, error, branchId }: {
  workspace: DebtWorkspace | null;
  error: string | null;
  branchId?: string;
}) {
  const snapshot = workspace ? managementDebtSnapshot(workspace) : null;
  return <section aria-label="Công nợ hiện tại" className="border-y border-border py-4">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-base font-semibold">Công nợ hiện tại</h2>
      <Link href={managementDebtLink(branchId, "receivable")} className="inline-flex min-h-10 items-center text-sm text-primary">Chi tiết công nợ</Link>
    </div>
    {!snapshot || error ? <p role="alert" className="text-sm text-status-error">Chưa tải đủ công nợ và tiền ứng. Không dùng số dư tạm tính.</p> : <>
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Phải thu khách hàng", value: snapshot.receivable.debt, mode: "receivable" as const, review: "debt" },
          { label: "Phải trả nhà cung cấp", value: snapshot.payable.debt, mode: "payable" as const, review: "debt" },
          { label: "Khách ứng trước", value: snapshot.receivable.advance, mode: "receivable" as const, review: "advance" },
          { label: "Ứng trước nhà cung cấp", value: snapshot.payable.advance, mode: "payable" as const, review: "advance" },
        ].map(item => <div key={item.label} className="min-w-0 border-l-2 border-primary/30 pl-3">
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd className="mt-1 break-words text-lg font-semibold tabular-nums"><Link className="underline-offset-4 hover:underline" href={managementDebtLink(branchId, item.mode, item.review)}>{formatCurrency(item.value)}đ</Link></dd>
        </div>)}
      </dl>
      <div className="mt-4 grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
        {(["receivable", "payable"] as const).map(mode => {
          const totals = snapshot[mode];
          return <div key={mode} className="min-w-0 text-sm">
            <p className="font-medium">{mode === "receivable" ? "Thu hồi công nợ" : "Đối chiếu nhà cung cấp"}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{formatNumber(totals.documentCount)} chứng từ còn nợ · {totals.bucket91Plus === null ? "Chưa đủ phân tuổi" : `Trên 90 ngày: ${formatCurrency(totals.bucket91Plus)}đ`}</p>
            {totals.availableOffset > 0 && <Link href={managementDebtLink(branchId, mode, "both")} className="mt-1 inline-flex min-h-10 items-center text-primary">Đối chiếu tiền ứng · {formatCurrency(totals.availableOffset)}đ</Link>}
          </div>;
        })}
      </div>
    </>}
    <p className="mt-3 text-xs leading-5 text-muted-foreground">Số dư hiện tại, không phải cuối kỳ đã chọn. Nợ chứng từ chưa trừ tiền ứng; tuổi nợ không đồng nghĩa quá hạn.</p>
  </section>;
}
