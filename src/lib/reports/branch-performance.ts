import type { BranchPnLRow } from "@/lib/services/supabase/reports";
import { BRANCH_TYPE_LABELS } from "@/lib/branch-type-labels";
import { matchesMetricFilters, metricFilterLabel, type MetricFilter } from "./metric-filter";
import type { ExcelSheet } from "@/lib/utils/excel-export";
import { sortReportRows } from "./table-sort";

export const BRANCH_FIELDS = [
  { key: "branchName", label: "Chi nhánh" }, { key: "typeLabel", label: "Loại chi nhánh" },
  { key: "goodsRevenue", label: "Doanh thu thuần" }, { key: "revenueShare", label: "Tỷ trọng doanh thu (%)" },
  { key: "deliveryFee", label: "Phí giao hàng thu hộ" }, { key: "totalRevenue", label: "Tổng doanh thu" },
  { key: "cogs", label: "Giá vốn" }, { key: "grossProfit", label: "Lãi gộp" },
  { key: "grossMargin", label: "Biên gộp (%)" }, { key: "opEx", label: "Chi phí vận hành" },
  { key: "otherIncome", label: "Thu nhập khác" }, { key: "netProfit", label: "Kết quả vận hành" },
  { key: "netMargin", label: "Biên vận hành (%)" }, { key: "missingCostLines", label: "Dòng thiếu giá vốn" },
];
export const BRANCH_METRICS = BRANCH_FIELDS.slice(2);
export interface BranchPerformanceRow extends Omit<BranchPnLRow, "cogs" | "grossProfit" | "grossMargin" | "netProfit" | "netMargin"> {
  typeLabel: string;
  revenueShare: number | null;
  cogs: number | null;
  grossProfit: number | null;
  grossMargin: number | null;
  netProfit: number | null;
  netMargin: number | null;
}
export interface BranchPerformanceFilter {
  search: string;
  type: string;
  status: "all" | "loss" | "missing" | "profit";
  metrics: MetricFilter[];
}
export const EMPTY_BRANCH_FILTER: BranchPerformanceFilter = { search: "", type: "", status: "all", metrics: [] };

export function branchPerformanceRows(source: BranchPnLRow[], filter: BranchPerformanceFilter, sort: { id: string; direction: "asc" | "desc" }): BranchPerformanceRow[] {
  const revenue = source.reduce((sum, row) => sum + row.goodsRevenue, 0);
  const query = filter.search.trim().toLocaleLowerCase("vi");
  const rows = source.map(row => ({ ...row,
    typeLabel: BRANCH_TYPE_LABELS[row.branchType as keyof typeof BRANCH_TYPE_LABELS] ?? row.branchType,
    revenueShare: revenue > 0 ? row.goodsRevenue / revenue * 100 : null,
    cogs: row.cogsComplete ? row.cogs : null,
    grossProfit: row.cogsComplete ? row.grossProfit : null,
    grossMargin: row.cogsComplete && row.goodsRevenue > 0 ? row.grossMargin : null,
    netProfit: row.cogsComplete ? row.netProfit : null,
    netMargin: row.cogsComplete && row.goodsRevenue > 0 ? row.netMargin : null,
  })).filter(row => (!query || `${row.branchName} ${row.typeLabel}`.toLocaleLowerCase("vi").includes(query)) &&
    (!filter.type || row.branchType === filter.type) &&
    (filter.status === "all" || (filter.status === "missing" ? !row.cogsComplete : row.netProfit !== null && (filter.status === "loss" ? row.netProfit < 0 : row.netProfit >= 0))) &&
    matchesMetricFilters(row, filter.metrics));
  return sortReportRows(rows, row => row[sort.id as keyof BranchPerformanceRow], sort.direction);
}

export function branchPerformanceTotals(rows: BranchPerformanceRow[]) {
  const sum = (key: "goodsRevenue" | "deliveryFee" | "totalRevenue" | "opEx" | "otherIncome" | "missingCostLines") => rows.reduce((total, row) => total + (row[key] ?? 0), 0);
  const complete = rows.every(row => row.cogsComplete);
  const cogs = complete ? rows.reduce((total, row) => total + (row.cogs ?? 0), 0) : null;
  const grossProfit = complete ? rows.reduce((total, row) => total + (row.grossProfit ?? 0), 0) : null;
  const netProfit = complete ? rows.reduce((total, row) => total + (row.netProfit ?? 0), 0) : null;
  const goodsRevenue = sum("goodsRevenue");
  return { goodsRevenue, cogs, grossProfit, netProfit, deliveryFee: sum("deliveryFee"), totalRevenue: sum("totalRevenue"), opEx: sum("opEx"), otherIncome: sum("otherIncome"), missingCostLines: sum("missingCostLines"),
    grossMargin: grossProfit !== null && goodsRevenue > 0 ? grossProfit / goodsRevenue * 100 : null,
    netMargin: netProfit !== null && goodsRevenue > 0 ? netProfit / goodsRevenue * 100 : null,
    revenueShare: rows.some(row => row.revenueShare === null) ? null : rows.reduce((sum, row) => sum + (row.revenueShare ?? 0), 0) };
}

export function branchPerformanceSheet(rows: BranchPerformanceRow[], filter: BranchPerformanceFilter, sort: { id: string; direction: "asc" | "desc" }, mode: "view" | "full", titleRows: string[]): ExcelSheet {
  const typeLabel = BRANCH_TYPE_LABELS[filter.type as keyof typeof BRANCH_TYPE_LABELS] ?? filter.type;
  return { name: "2. Theo chi nhánh", autoFilter: true,
    tablePreferenceKey: mode === "view" ? "report.financial-results.branches" : undefined,
    titleRows: [...titleRows, "Chi nhánh gồm nội bộ; không phải tổng hợp nhất. Tỷ trọng trên doanh thu tất cả chi nhánh trong phạm vi.",
      `Lọc chi nhánh: ${filter.search || "Tất cả"}; Loại: ${typeLabel || "Tất cả"}; Kết quả: ${{ all: "Tất cả", loss: "Lỗ vận hành", profit: "Không lỗ vận hành", missing: "Thiếu giá vốn" }[filter.status]}`,
      `Chỉ tiêu: ${metricFilterLabel(filter.metrics, BRANCH_FIELDS)}; Sắp xếp: ${BRANCH_FIELDS.find(field => field.key === sort.id)?.label ?? sort.id} ${sort.direction === "asc" ? "tăng dần" : "giảm dần"}`],
    columns: BRANCH_FIELDS.map((field, index) => ({ ...field, width: index < 2 ? 30 : 24, format: index < 2 ? undefined : "number", decimalPlaces: 4 })),
    rows: rows.map(row => ({ ...row })), footer: { branchName: "TỔNG THEO BỘ LỌC", ...branchPerformanceTotals(rows) } };
}
