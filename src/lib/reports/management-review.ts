import type { BranchPnLRow, ProfitAndLoss } from "@/lib/services/supabase/reports";
import { sortReportRows } from "./table-sort";

export function sortManagementBranches(rows: BranchPnLRow[], sort: { id: string; direction: "asc" | "desc" } | null): BranchPnLRow[] {
  if (!sort) return rows;
  return sortReportRows(rows, row => {
    if (["cogs", "grossProfit", "netProfit"].includes(sort.id) && !row.cogsComplete) return null;
    return row[sort.id as keyof BranchPnLRow];
  }, sort.direction);
}

export function reportChange(current: number, previous: number): string {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return "Chưa đủ dữ liệu so sánh";
  if (previous === 0) return current === 0 ? "Không phát sinh ở cả hai kỳ" : "Phát sinh mới · kỳ trước bằng 0";
  const percent = ((current - previous) / Math.abs(previous)) * 100;
  return `${percent > 0 ? "+" : ""}${percent.toFixed(1)}% so với kỳ trước`;
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
    results.push({ id: "cost-incomplete", title: "Chưa đủ cơ sở kết luận lợi nhuận", detail: `Kỳ hiện tại thiếu giá vốn ${current.missingCostLines} dòng; kỳ trước ${previous.missingCostLines} dòng. Không thay bằng giá hiện tại hoặc coi phần thiếu bằng 0.`, action: "Kiểm tra giá vốn", path: "/phan-tich/bao-cao-tai-chinh", severity: "warning" });
  } else if (current.goodsRevenue > previous.goodsRevenue && current.grossProfit < previous.grossProfit) {
    results.push({ id: "margin-pressure", title: "Doanh thu tăng nhưng lãi gộp giảm", detail: "Giá vốn tăng nhiều hơn phần doanh thu tăng. Cần đối chiếu giá thực bán, giảm giá, cơ cấu SKU và giá vốn lịch sử trước khi kết luận nguyên nhân.", action: "Xem hiệu quả SKU", path: "/phan-tich/sku-chi-tiet", severity: "warning" });
  } else if (current.goodsRevenue < previous.goodsRevenue) {
    results.push({ id: "sales-decline", title: "Doanh thu hàng hóa giảm so với kỳ trước", detail: "Đối chiếu số hóa đơn, giá trị đơn, hàng trả và đóng góp từng mặt hàng trên cùng phạm vi ngày.", action: "Đối chiếu bán hàng", path: "/phan-tich/ban-hang", severity: "info" });
  }
  if (current.operatingExpense > previous.operatingExpense) {
    results.push({ id: "expense-increase", title: "Chi phí vận hành tăng", detail: "So sánh các khoản đã ghi nhận theo ngày phát sinh và chi nhánh chịu chi phí; không đồng nhất chi phí với tiền đã chi.", action: "Xem khoản thu nhập, chi phí", path: "/tai-chinh/thu-nhap-chi-phi", severity: "info" });
  }
  if (results.length === 0) {
    results.push({ id: "review-period", title: "Đối chiếu kết quả trước khi chốt kỳ", detail: "Kết quả phản ánh chứng từ đã ghi nhận; chưa xác nhận mọi chi phí vận hành đã được nhập đầy đủ.", action: "Mở kết quả kinh doanh", path: "/phan-tich/bao-cao-tai-chinh", severity: "info" });
  }
  return results;
}

export function managementFinancialRows(current: ProfitAndLoss, previous: ProfitAndLoss) {
  return [
    { metric: "Doanh thu thuần hàng hóa", current: current.goodsRevenue, previous: previous.goodsRevenue },
    { metric: "Giá vốn lịch sử", current: current.cogsComplete ? current.cogs : null, previous: previous.cogsComplete ? previous.cogs : null },
    { metric: "Lãi gộp", current: current.cogsComplete ? current.grossProfit : null, previous: previous.cogsComplete ? previous.grossProfit : null },
    { metric: "Thu nhập khác", current: current.otherIncome ?? 0, previous: previous.otherIncome ?? 0 },
    { metric: "Chi phí vận hành đã ghi nhận", current: current.operatingExpense, previous: previous.operatingExpense },
    { metric: "Kết quả sau chi phí đã ghi nhận", current: current.cogsComplete ? current.netProfit : null, previous: previous.cogsComplete ? previous.netProfit : null },
  ].map(row => ({ ...row, difference: row.current === null || row.previous === null ? null : row.current - row.previous }));
}
