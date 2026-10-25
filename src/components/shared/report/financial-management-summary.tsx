"use client";

import { KpiCard } from "@/app/(main)/phan-tich/_components";
import { formatCurrency, formatNumber } from "@/lib/format";
import { managementObservations, reportChange } from "@/lib/reports/management-review";
import type { ProfitAndLoss } from "@/lib/services/supabase/reports";
import { ManagementObservationItem } from "./management-observation-item";

export function FinancialManagementSummary({ current, previous, branchId, range, hasPermission }: {
  current: ProfitAndLoss;
  previous: ProfitAndLoss;
  branchId?: string;
  range: { from: string; to: string };
  hasPermission: (permission: string) => boolean;
}) {
  const complete = current.cogsComplete && previous.cogsComplete;
  const expenseComplete = current.operatingExpenseComplete !== false;
  const expenseComparisonComplete = expenseComplete && previous.operatingExpenseComplete !== false;
  const resultComplete = current.cogsComplete && expenseComplete;
  const metrics = [
    { label: "Doanh thu thuần", value: formatCurrency(current.goodsRevenue), change: reportChange(current.goodsRevenue, previous.goodsRevenue), positive: current.goodsRevenue >= previous.goodsRevenue, icon: "trending_up" },
    { label: "Lãi gộp", value: current.cogsComplete ? formatCurrency(current.grossProfit) : "Chưa đủ giá vốn", change: complete ? reportChange(current.grossProfit, previous.grossProfit) : "", positive: current.grossProfit >= previous.grossProfit, icon: "payments" },
    { label: "Chi phí vận hành", value: expenseComplete ? formatCurrency(current.operatingExpense) : "Chưa đủ chi phí", change: expenseComparisonComplete ? reportChange(current.operatingExpense, previous.operatingExpense) : "", positive: current.operatingExpense <= previous.operatingExpense, icon: "receipt_long" },
    { label: "Kết quả vận hành", value: resultComplete ? formatCurrency(current.netProfit) : current.cogsComplete ? "Chưa đủ chi phí" : "Chưa đủ giá vốn", change: complete && expenseComparisonComplete ? reportChange(current.netProfit, previous.netProfit) : "", positive: current.netProfit >= previous.netProfit, icon: "account_balance" },
  ];
  return (
    <section aria-label="Kết quả và việc cần xem" className="space-y-4 border-b pb-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(metric => <KpiCard key={metric.label} {...metric} bg="bg-primary-fixed" iconColor="text-primary" valueColor="text-foreground" />)}
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
        <span>Đơn vị: đồng</span>
        <span>Biên lãi gộp: <strong className="tabular-nums text-foreground">{current.cogsComplete ? `${formatNumber(current.grossMargin)}%` : "Chưa đủ giá vốn"}</strong></span>
        {complete && current.goodsRevenue > 0 && previous.goodsRevenue > 0 && <span>So với kỳ trước: <strong className="tabular-nums text-foreground">{formatNumber(current.grossMargin - previous.grossMargin)} điểm %</strong></span>}
        <span>Theo chứng từ đã ghi nhận. Lợi nhuận không phải dòng tiền.</span>
      </div>
      <h2 className="border-l-4 border-border bg-muted/50 px-3 py-3 text-base font-semibold">Biến động cần xem</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        {managementObservations(current, previous).map(item => <ManagementObservationItem key={item.id} observation={item} branchId={branchId} range={range} hasPermission={hasPermission} />)}
      </div>
    </section>
  );
}
