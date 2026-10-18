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
}

export function managementObservations(current: ProfitAndLoss, previous: ProfitAndLoss): ManagementObservation[] {
  const results: ManagementObservation[] = [];
  if (!current.cogsComplete || !previous.cogsComplete) {
    results.push({ id: "cost-incomplete", title: "Chưa đủ giá vốn", detail: `Thiếu giá vốn: kỳ này ${current.missingCostLines} dòng, kỳ trước ${previous.missingCostLines} dòng.`, action: "Đối chiếu giá vốn", path: "/phan-tich/bao-cao-tai-chinh", severity: "warning" });
  } else if (current.goodsRevenue > previous.goodsRevenue && current.grossProfit < previous.grossProfit) {
    results.push({ id: "margin-pressure", title: "Doanh thu tăng, lãi gộp giảm", detail: "Kiểm tra giá bán, chiết khấu, cơ cấu mặt hàng và giá vốn.", action: "Hiệu quả mặt hàng", path: "/phan-tich/sku-chi-tiet", severity: "warning" });
  } else if (current.goodsRevenue < previous.goodsRevenue) {
    results.push({ id: "sales-decline", title: "Doanh thu giảm", detail: "Đối chiếu số hóa đơn, giá trị đơn và hàng trả.", action: "Chi tiết bán hàng", path: "/phan-tich/ban-hang", severity: "info" });
  }
  if (current.operatingExpense > previous.operatingExpense) {
    results.push({ id: "expense-increase", title: "Chi phí vận hành tăng", detail: "Đối chiếu khoản mục, ngày ghi nhận và chi nhánh.", action: "Chi tiết chi phí", path: "/tai-chinh/thu-nhap-chi-phi", severity: "info" });
  }
  if (results.length === 0) {
    results.push({ id: "review-period", title: "Đối chiếu cuối kỳ", detail: "Kiểm tra chi phí đã ghi nhận trước khi chốt kỳ.", action: "Kết quả kinh doanh", path: "/phan-tich/bao-cao-tai-chinh", severity: "info" });
  }
  return results;
}

export function managementFinancialRows(current: ProfitAndLoss, previous: ProfitAndLoss) {
  return [
    { metric: "Doanh thu thuần", current: current.goodsRevenue, previous: previous.goodsRevenue },
    { metric: "Giá vốn", current: current.cogsComplete ? current.cogs : null, previous: previous.cogsComplete ? previous.cogs : null },
    { metric: "Lãi gộp", current: current.cogsComplete ? current.grossProfit : null, previous: previous.cogsComplete ? previous.grossProfit : null },
    { metric: "Thu nhập khác", current: current.otherIncome ?? 0, previous: previous.otherIncome ?? 0 },
    { metric: "Chi phí vận hành", current: current.operatingExpense, previous: previous.operatingExpense },
    { metric: "Kết quả vận hành", current: current.cogsComplete ? current.netProfit : null, previous: previous.cogsComplete ? previous.netProfit : null },
  ].map(row => ({ ...row, difference: row.current === null || row.previous === null ? null : row.current - row.previous }));
}
