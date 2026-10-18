import type { CustomerFinancialRow } from "@/lib/services/supabase/customer-financial-report";
import { sortReportRows } from "./table-sort";
import { matchesMetricFilters, type MetricFilter } from "./metric-filter";

export const CUSTOMER_FINANCIAL_FIELDS = [
  ["code", "Mã KH"], ["name", "Khách hàng"],
  ["orders", "Hóa đơn bán"], ["returns", "Phiếu trả"], ["products", "Mặt hàng"],
  ["salesAmount", "Tiền hàng bán"], ["returnAmount", "Tiền hàng trả"], ["netRevenue", "Doanh thu thuần"],
  ["averageOrderValue", "Giá trị HĐ bán BQ"], ["cogs", "Giá vốn ròng"], ["grossProfit", "Lãi gộp"], ["marginPercent", "Biên lãi gộp (%)"],
  ["previousRevenue", "Doanh thu kỳ trước"], ["revenueDifference", "Chênh lệch doanh thu"],
  ["previousGrossProfit", "Lãi gộp kỳ trước"], ["grossProfitDifference", "Chênh lệch lãi gộp"],
  ["missingCostLines", "Dòng thiếu giá vốn"], ["previousMissingCostLines", "Thiếu giá vốn kỳ trước"], ["lastActivityAt", "Phát sinh cuối"],
] as const;
export const CUSTOMER_COLUMN_GROUPS = [{ label: "Khách hàng", span: 2 }, { label: "Bán và trả", span: 7 }, { label: "Giá vốn và lãi gộp", span: 3 }, { label: "Đối chiếu kỳ trước", span: 4 }, { label: "Kiểm soát", span: 3 }];
export const CUSTOMER_METRIC_FIELDS = CUSTOMER_FINANCIAL_FIELDS.filter(([key]) => !["code", "name", "lastActivityAt"].includes(key)).map(([key, label]) => ({ key, label }));
export const CUSTOMER_REVIEW_LABELS = { all: "Tất cả khách hàng", decline: "Doanh thu giảm", loss: "Lãi gộp âm", missing: "Thiếu giá vốn", returns: "Có hàng trả", anonymous: "Chưa gắn khách hàng" };
export type CustomerReview = keyof typeof CUSTOMER_REVIEW_LABELS;
export const customerKey = (row: Pick<CustomerFinancialRow, "customerId">) => row.customerId ?? "anonymous";
export interface CustomerProfitabilityRow extends CustomerFinancialRow {
  previousRevenue: number; revenueDifference: number; previousGrossProfit: number | null;
  grossProfitDifference: number | null; previousMissingCostLines: number;
  previousRow?: CustomerFinancialRow;
}
export function compareCustomerPeriods(current: CustomerFinancialRow[], previous: CustomerFinancialRow[]): CustomerProfitabilityRow[] {
  const now = new Map(current.map(row => [customerKey(row), row]));
  const prior = new Map(previous.map(row => [customerKey(row), row]));
  return [...new Set([...now.keys(), ...prior.keys()])].map(key => {
    const old = prior.get(key);
    const row = now.get(key) ?? { ...old!, orders: 0, returns: 0, products: 0, salesAmount: 0, returnAmount: 0, netRevenue: 0, cogs: 0, grossProfit: 0, marginPercent: null, averageOrderValue: null, missingCostLines: 0, lastActivityAt: "" };
    const previousRevenue = old?.netRevenue ?? 0;
    const previousGrossProfit = old ? old.grossProfit : 0;
    return { ...row, previousRevenue, revenueDifference: row.netRevenue - previousRevenue,
      previousGrossProfit, grossProfitDifference: row.grossProfit === null || previousGrossProfit === null ? null : row.grossProfit - previousGrossProfit,
      previousMissingCostLines: old?.missingCostLines ?? 0, previousRow: old };
  });
}
export function customerProfitabilityView(rows: CustomerProfitabilityRow[], search: string, review: CustomerReview, filters: MetricFilter[], sort: { id: string; direction: "asc" | "desc" }) {
  const query = search.trim().toLocaleLowerCase("vi");
  return sortReportRows(rows.filter(row => (!query || `${row.code} ${row.name}`.toLocaleLowerCase("vi").includes(query)) &&
    (review === "all" || (review === "decline" && row.revenueDifference < 0) || (review === "loss" && row.grossProfit !== null && row.grossProfit < 0) ||
     (review === "missing" && row.missingCostLines + row.previousMissingCostLines > 0) || (review === "returns" && row.returns > 0) || (review === "anonymous" && row.customerId === null)) &&
    matchesMetricFilters(row, filters)), row => row[sort.id as keyof CustomerProfitabilityRow], sort.direction);
}
export function customerFinancialTotals(rows: CustomerFinancialRow[]) {
  const sum = (key: "salesAmount" | "returnAmount" | "netRevenue" | "orders" | "returns" | "missingCostLines") => rows.reduce((total, row) => total + row[key], 0);
  const netRevenue = sum("netRevenue");
  const cogs = rows.some(row => row.cogs === null) ? null : rows.reduce((total, row) => total + (row.cogs ?? 0), 0);
  const grossProfit = cogs === null ? null : netRevenue - cogs;
  return { salesAmount: sum("salesAmount"), returnAmount: sum("returnAmount"), netRevenue, cogs, grossProfit,
    orders: sum("orders"), returns: sum("returns"), missingCostLines: sum("missingCostLines"),
    averageOrderValue: sum("orders") ? sum("salesAmount") / sum("orders") : null,
    marginPercent: netRevenue > 0 && grossProfit !== null ? grossProfit * 100 / netRevenue : null };
}
