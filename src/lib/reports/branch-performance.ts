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
  { key: "previousGoodsRevenue", label: "Doanh thu kỳ trước" }, { key: "revenueDifference", label: "Chênh lệch doanh thu" },
  { key: "previousCogs", label: "Giá vốn kỳ trước" }, { key: "previousGrossProfit", label: "Lãi gộp kỳ trước" },
  { key: "previousNetProfit", label: "Kết quả kỳ trước" }, { key: "netProfitDifference", label: "Chênh lệch kết quả" },
  { key: "previousMissingCostLines", label: "Thiếu giá vốn kỳ trước" },
];
export const BRANCH_METRICS = BRANCH_FIELDS.slice(2);
export const BRANCH_COLUMN_GROUPS = [{ label: "Chi nhánh", span: 2 }, { label: "Kỳ đang xem", span: 12 }, { label: "Đối chiếu kỳ trước", span: 7 }];
export const BRANCH_STATUS_LABELS = { all: "Tất cả kết quả", loss: "Lỗ vận hành", profit: "Không lỗ vận hành", missing: "Thiếu giá vốn", missingPrior: "Thiếu giá vốn kỳ trước", revenueDecline: "Doanh thu giảm", resultDecline: "Kết quả vận hành giảm" };
export interface BranchPerformanceRow extends Omit<BranchPnLRow, "cogs" | "grossProfit" | "grossMargin" | "netProfit" | "netMargin"> {
  typeLabel: string;
  revenueShare: number | null;
  cogs: number | null;
  grossProfit: number | null;
  grossMargin: number | null;
  netProfit: number | null;
  netMargin: number | null;
  previousGoodsRevenue: number | null;
  revenueDifference: number | null;
  previousCogs: number | null;
  previousGrossProfit: number | null;
  previousNetProfit: number | null;
  netProfitDifference: number | null;
  previousMissingCostLines: number | null;
}
export interface BranchPerformanceFilter {
  search: string;
  type: string;
  status: keyof typeof BRANCH_STATUS_LABELS;
  metrics: MetricFilter[];
}
export const EMPTY_BRANCH_FILTER: BranchPerformanceFilter = { search: "", type: "", status: "all", metrics: [] };

export function branchPerformanceRows(source: BranchPnLRow[], filter: BranchPerformanceFilter, sort: { id: string; direction: "asc" | "desc" }, previous?: BranchPnLRow[]): BranchPerformanceRow[] {
  const revenue = source.reduce((sum, row) => sum + row.goodsRevenue, 0);
  const priorById = new Map(previous?.map(row => [row.branchId, row]));
  const current = new Map(source.map(row => [row.branchId, row]));
  // Keep prior-only branches visible so ceased activity cannot disappear from the comparison.
  for (const row of previous ?? []) if (!current.has(row.branchId)) current.set(row.branchId, {
    ...row, revenue: 0, goodsRevenue: 0, deliveryFee: 0, totalRevenue: 0, cogs: 0,
    grossProfit: 0, grossMargin: 0, opEx: 0, otherIncome: 0, netProfit: 0, netMargin: 0,
    cogsComplete: true, missingCostLines: 0,
  });
  const query = filter.search.trim().toLocaleLowerCase("vi");
  const rows = [...current.values()].map(row => {
    const prior = priorById.get(row.branchId);
    const previousGoodsRevenue = previous ? prior?.goodsRevenue ?? 0 : null;
    const previousCogs = previous ? (!prior || prior.cogsComplete ? prior?.cogs ?? 0 : null) : null;
    const previousGrossProfit = previous ? (!prior || prior.cogsComplete ? prior?.grossProfit ?? 0 : null) : null;
    const previousNetProfit = previous ? (!prior || prior.cogsComplete ? prior?.netProfit ?? 0 : null) : null;
    return { ...row,
    typeLabel: BRANCH_TYPE_LABELS[row.branchType as keyof typeof BRANCH_TYPE_LABELS] ?? row.branchType,
    revenueShare: revenue > 0 ? row.goodsRevenue / revenue * 100 : null,
    cogs: row.cogsComplete ? row.cogs : null,
    grossProfit: row.cogsComplete ? row.grossProfit : null,
    grossMargin: row.cogsComplete && row.goodsRevenue > 0 ? row.grossMargin : null,
    netProfit: row.cogsComplete ? row.netProfit : null,
    netMargin: row.cogsComplete && row.goodsRevenue > 0 ? row.netMargin : null,
    previousGoodsRevenue, previousCogs, previousGrossProfit, previousNetProfit,
    revenueDifference: previousGoodsRevenue === null ? null : row.goodsRevenue - previousGoodsRevenue,
    netProfitDifference: row.cogsComplete && row.netProfit !== null && previousNetProfit !== null ? row.netProfit - previousNetProfit : null,
    previousMissingCostLines: previous ? prior?.missingCostLines ?? 0 : null,
  }; }).filter(row => (!query || `${row.branchName} ${row.typeLabel}`.toLocaleLowerCase("vi").includes(query)) &&
    (!filter.type || row.branchType === filter.type) &&
    (filter.status === "all" || (filter.status === "missing" && !row.cogsComplete) ||
      (filter.status === "missingPrior" && (row.previousMissingCostLines ?? 0) > 0) ||
      (filter.status === "loss" && row.netProfit !== null && row.netProfit < 0) ||
      (filter.status === "profit" && row.netProfit !== null && row.netProfit >= 0) ||
      (filter.status === "revenueDecline" && row.revenueDifference !== null && row.revenueDifference < 0) ||
      (filter.status === "resultDecline" && row.netProfitDifference !== null && row.netProfitDifference < 0)) &&
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
  const priorSum = (key: "previousGoodsRevenue" | "previousCogs" | "previousGrossProfit" | "previousNetProfit" | "revenueDifference" | "netProfitDifference" | "previousMissingCostLines") => rows.some(row => row[key] === null) ? null : rows.reduce((total, row) => total + (row[key] ?? 0), 0);
  return { goodsRevenue, cogs, grossProfit, netProfit, deliveryFee: sum("deliveryFee"), totalRevenue: sum("totalRevenue"), opEx: sum("opEx"), otherIncome: sum("otherIncome"), missingCostLines: sum("missingCostLines"),
    previousGoodsRevenue: priorSum("previousGoodsRevenue"), previousCogs: priorSum("previousCogs"), previousGrossProfit: priorSum("previousGrossProfit"), previousNetProfit: priorSum("previousNetProfit"), revenueDifference: priorSum("revenueDifference"), netProfitDifference: priorSum("netProfitDifference"), previousMissingCostLines: priorSum("previousMissingCostLines"),
    grossMargin: grossProfit !== null && goodsRevenue > 0 ? grossProfit / goodsRevenue * 100 : null,
    netMargin: netProfit !== null && goodsRevenue > 0 ? netProfit / goodsRevenue * 100 : null,
    revenueShare: rows.some(row => row.revenueShare === null) ? null : rows.reduce((sum, row) => sum + (row.revenueShare ?? 0), 0) };
}

export function branchPerformanceSheet(rows: BranchPerformanceRow[], filter: BranchPerformanceFilter, sort: { id: string; direction: "asc" | "desc" }, mode: "view" | "full", titleRows: string[]): ExcelSheet {
  const typeLabel = BRANCH_TYPE_LABELS[filter.type as keyof typeof BRANCH_TYPE_LABELS] ?? filter.type;
  return { name: "2. Theo chi nhánh", autoFilter: true,
    columnGroups: BRANCH_COLUMN_GROUPS,
    tablePreferenceKey: mode === "view" ? "report.financial-results.branches" : undefined,
    titleRows: [...titleRows, "Chi nhánh gồm nội bộ; không phải tổng hợp nhất. Tỷ trọng trên doanh thu tất cả chi nhánh trong phạm vi.",
      `Lọc chi nhánh: ${filter.search || "Tất cả"}; Loại: ${typeLabel || "Tất cả"}; Kết quả: ${BRANCH_STATUS_LABELS[filter.status]}`,
      `Chỉ tiêu: ${metricFilterLabel(filter.metrics, BRANCH_FIELDS)}; Sắp xếp: ${BRANCH_FIELDS.find(field => field.key === sort.id)?.label ?? sort.id} ${sort.direction === "asc" ? "tăng dần" : "giảm dần"}`],
    columns: BRANCH_FIELDS.map((field, index) => ({ ...field, width: index < 2 ? 30 : 24, format: index < 2 ? undefined : "number", decimalPlaces: 4 })),
    rows: rows.map(row => ({ ...row })), footer: { branchName: "TỔNG THEO BỘ LỌC", ...branchPerformanceTotals(rows) } };
}
