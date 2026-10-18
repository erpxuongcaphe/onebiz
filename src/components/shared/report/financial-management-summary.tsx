"use client";

import Link from "next/link";
import { KpiCard } from "@/app/(main)/phan-tich/_components";
import { Icon } from "@/components/ui/icon";
import { formatCurrency, formatNumber } from "@/lib/format";
import { managementObservations, managementReportLink, reportChange } from "@/lib/reports/management-review";
import type { ProfitAndLoss } from "@/lib/services/supabase/reports";

export function FinancialManagementSummary({ current, previous, branchId, range }: {
  current: ProfitAndLoss;
  previous: ProfitAndLoss;
  branchId?: string;
  range: { from: string; to: string };
}) {
  const complete = current.cogsComplete && previous.cogsComplete;
  const metrics = [
    { label: "Doanh thu thuần", value: formatCurrency(current.goodsRevenue), change: reportChange(current.goodsRevenue, previous.goodsRevenue), positive: current.goodsRevenue >= previous.goodsRevenue, icon: "trending_up" },
    { label: "Lãi gộp", value: current.cogsComplete ? formatCurrency(current.grossProfit) : "Chưa đủ giá vốn", change: complete ? reportChange(current.grossProfit, previous.grossProfit) : "", positive: current.grossProfit >= previous.grossProfit, icon: "payments" },
    { label: "Chi phí vận hành", value: formatCurrency(current.operatingExpense), change: reportChange(current.operatingExpense, previous.operatingExpense), positive: current.operatingExpense <= previous.operatingExpense, icon: "receipt_long" },
    { label: "Kết quả vận hành", value: current.cogsComplete ? formatCurrency(current.netProfit) : "Chưa đủ giá vốn", change: complete ? reportChange(current.netProfit, previous.netProfit) : "", positive: current.netProfit >= previous.netProfit, icon: "account_balance" },
  ];
  return (
    <section aria-label="Kết quả và việc cần xem" className="space-y-4 border-b pb-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(metric => <KpiCard key={metric.label} {...metric} bg="bg-primary-fixed" iconColor="text-primary" valueColor="text-foreground" />)}
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
        <span>Đơn vị: đồng</span>
        <span>Biên lãi gộp: <strong className="tabular-nums text-foreground">{current.cogsComplete ? `${formatNumber(current.grossMargin)}%` : "Chưa đủ giá vốn"}</strong></span>
        {complete && <span>So với kỳ trước: <strong className="tabular-nums text-foreground">{formatNumber(current.grossMargin - previous.grossMargin)} điểm %</strong></span>}
        <span>Theo chứng từ đã ghi nhận. Lợi nhuận không phải dòng tiền.</span>
      </div>
      <h2 className="text-sm font-semibold">Biến động cần xem</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        {managementObservations(current, previous).map(item => (
          <article key={item.id} className="flex min-w-0 gap-2 border-l-2 border-border pl-3">
            <Icon name={item.severity === "warning" ? "warning" : "info"} size={18} className={item.severity === "warning" ? "shrink-0 text-status-warning" : "shrink-0 text-primary"} />
            <div className="min-w-0">
              <h3 className="text-sm font-medium">{item.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{item.detail}</p>
              <Link href={managementReportLink(item.path, branchId, range)} className="inline-flex min-h-9 items-center gap-1 text-sm text-primary">{item.action}<Icon name="arrow_forward" size={16} /></Link>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
