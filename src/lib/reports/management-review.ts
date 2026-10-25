import type { BranchPnLRow, ProfitAndLoss } from "@/lib/services/supabase/reports";
import { sortReportRows } from "./table-sort";
import { toCreatedAtRangeWindow } from "@/lib/utils/list-date-preset-range";
import { cashBookDate } from "@/lib/cash-time";

export function managementComparisonRange(range: { from: string; to: string }) {
  const window = toCreatedAtRangeWindow(range);
  if (!window) return null;
  const start = Date.parse(window.start);
  const duration = Date.parse(window.end) - start;
  return {
    from: cashBookDate(new Date(start - duration).toISOString()),
    to: cashBookDate(new Date(start - 1).toISOString()),
  };
}

export function sortManagementBranches(rows: BranchPnLRow[], sort: { id: string; direction: "asc" | "desc" } | null): BranchPnLRow[] {
  if (!sort) return rows;
  return sortReportRows(rows, row => {
    if (["cogs", "grossProfit", "netProfit"].includes(sort.id) && !row.cogsComplete) return null;
    return row[sort.id as keyof BranchPnLRow];
  }, sort.direction);
}

export function reportChange(current: number, previous: number): string {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return "Chưa đủ dữ liệu";
  if (previous === 0) return current === 0 ? "Không phát sinh" : "Phát sinh mới";
  const percent = ((current - previous) / Math.abs(previous)) * 100;
  return `${percent > 0 ? "+" : ""}${percent.toFixed(1)}%`;
}

export function managementReportLink(path: string, branchId: string | undefined, range: { from: string; to: string }): string {
  const params = new URLSearchParams({ branch: branchId ?? "all", preset: "custom", from: range.from, to: range.to, view: "table" });
  return `${path}?${params}`;
}

export interface ManagementObservation {
  id: string;
  title: string;
  detail: string;
  action: string;
  path: string;
  severity: "warning" | "info";
  kind: "data-quality" | "variance" | "review";
  evidence: { metric: string; current: number | null; previous: number | null; difference: number | null; unit: "money" | "count" }[];
}

export function managementObservations(current: ProfitAndLoss, previous: ProfitAndLoss): ManagementObservation[] {
  const results: ManagementObservation[] = [];
  const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
  const evidence = (metric: string, currentValue: unknown, previousValue: unknown, unit: "money" | "count" = "money"): ManagementObservation["evidence"][number] => {
    const current = finite(currentValue), previous = finite(previousValue);
    return { metric, current, previous, difference: current === null || previous === null ? null : current - previous, unit };
  };
  const revenueKnown = finite(current.goodsRevenue) !== null && finite(previous.goodsRevenue) !== null;
  const profitKnown = finite(current.grossProfit) !== null && finite(previous.grossProfit) !== null;
  if (!current.cogsComplete || !previous.cogsComplete) {
    const expenseMissing = (current.missingExpenseCostLines ?? 0) + (previous.missingExpenseCostLines ?? 0);
    results.push(expenseMissing > 0
      ? {id:"cost-incomplete",title:"Chưa đủ giá vốn nguồn",detail:`${expenseMissing} dòng vật tư nội bộ chưa đủ căn cứ hợp nhất.`,action:"Đối chiếu chi phí nội bộ",path:"/tai-chinh/thu-nhap-chi-phi",severity:"warning",kind:"data-quality",evidence:[evidence("Dòng thiếu giá vốn nguồn",current.missingExpenseCostLines,previous.missingExpenseCostLines,"count")]}
      : { id: "cost-incomplete", title: "Chưa đủ giá vốn", detail: "Chưa kết luận biến động lợi nhuận.", action: "Đối chiếu giá vốn", path: "/phan-tich/bao-cao-tai-chinh", severity: "warning", kind: "data-quality", evidence: [evidence("Dòng thiếu giá vốn", current.missingCostLines, previous.missingCostLines, "count")] });
  } else if (revenueKnown && profitKnown && current.goodsRevenue > previous.goodsRevenue && current.grossProfit < previous.grossProfit) {
    results.push({ id: "margin-pressure", title: "Doanh thu tăng, lãi gộp giảm", detail: "Kiểm tra giá bán, chiết khấu, cơ cấu mặt hàng và giá vốn.", action: "Hiệu quả mặt hàng", path: "/phan-tich/sku-chi-tiet", severity: "warning", kind: "variance", evidence: [evidence("Doanh thu thuần", current.goodsRevenue, previous.goodsRevenue), evidence("Lãi gộp", current.grossProfit, previous.grossProfit)] });
  } else if (revenueKnown && current.goodsRevenue < previous.goodsRevenue) {
    results.push({ id: "sales-decline", title: "Doanh thu giảm", detail: "Đối chiếu số hóa đơn, giá trị đơn và hàng trả.", action: "Chi tiết bán hàng", path: "/phan-tich/ban-hang", severity: "info", kind: "variance", evidence: [evidence("Doanh thu thuần", current.goodsRevenue, previous.goodsRevenue)] });
  }
  if (current.operatingExpenseComplete === false || previous.operatingExpenseComplete === false) {
    if (!results.some(item => item.id === "cost-incomplete" && item.path === "/tai-chinh/thu-nhap-chi-phi")) {
      results.unshift({ id: "expense-incomplete", title: "Chưa đủ chi phí", detail: "Chưa kết luận biến động chi phí và kết quả vận hành.", action: "Đối chiếu chi phí", path: "/tai-chinh/thu-nhap-chi-phi", severity: "warning", kind: "data-quality", evidence: [evidence("Chi phí vận hành", current.operatingExpenseComplete === false ? null : current.operatingExpense, previous.operatingExpenseComplete === false ? null : previous.operatingExpense)] });
    }
  } else if (finite(current.operatingExpense) !== null && finite(previous.operatingExpense) !== null && current.operatingExpense > previous.operatingExpense) {
    results.push({ id: "expense-increase", title: "Chi phí vận hành tăng", detail: "Đối chiếu khoản mục, ngày ghi nhận và chi nhánh.", action: "Chi tiết chi phí", path: "/tai-chinh/thu-nhap-chi-phi", severity: "info", kind: "variance", evidence: [evidence("Chi phí vận hành", current.operatingExpense, previous.operatingExpense)] });
  }
  if (results.length === 0) {
    results.push({ id: "review-period", title: "Đối chiếu cuối kỳ", detail: "Kiểm tra chi phí đã ghi nhận trước khi chốt kỳ.", action: "Kết quả kinh doanh", path: "/phan-tich/bao-cao-tai-chinh", severity: "info", kind: "review", evidence: [evidence("Doanh thu thuần", current.goodsRevenue, previous.goodsRevenue)] });
  }
  return results;
}

export function managementFinancialRows(current: ProfitAndLoss, previous: ProfitAndLoss) {
  return [
    { metric: "Doanh thu thuần", current: current.goodsRevenue, previous: previous.goodsRevenue },
    { metric: "Giá vốn", current: current.cogsComplete ? current.cogs : null, previous: previous.cogsComplete ? previous.cogs : null },
    { metric: "Lãi gộp", current: current.cogsComplete ? current.grossProfit : null, previous: previous.cogsComplete ? previous.grossProfit : null },
    { metric: "Thu nhập khác", current: current.otherIncome ?? 0, previous: previous.otherIncome ?? 0 },
    { metric: "Chi phí vận hành", current: current.operatingExpenseComplete === false ? null : current.operatingExpense, previous: previous.operatingExpenseComplete === false ? null : previous.operatingExpense },
    { metric: "Kết quả vận hành", current: current.cogsComplete && current.operatingExpenseComplete !== false ? current.netProfit : null, previous: previous.cogsComplete && previous.operatingExpenseComplete !== false ? previous.netProfit : null },
  ].map(row => ({ ...row, difference: row.current === null || row.previous === null ? null : row.current - row.previous }));
}
