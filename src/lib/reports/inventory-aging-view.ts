import type { InventoryAgingRow } from "@/lib/services/supabase/inventory-reports";
import type { ExcelSheet } from "@/lib/utils/excel-export";
import { searchOptions } from "@/lib/search-options";
import { sortReportRows } from "@/lib/reports/table-sort";
import { formatDate } from "@/lib/format";

export const AGING_LABELS = { "0-30": "0–30 ngày", "31-60": "31–60 ngày", "61-90": "61–90 ngày", "91+": "Trên 90 ngày", unknown: "Chưa có ngày nhập" };
export type AgingFilter = "all" | keyof typeof AGING_LABELS | "review" | "insufficient";
export interface AgingViewRow extends InventoryAgingRow {
  unitLabel: string; conversionLabel: string; reviewStatus: string;
  needsReview: boolean; insufficientHistory: boolean;
}
export function agingView(source: InventoryAgingRow[], search: string, unit: string, filter: AgingFilter, sort: { id: string; direction: "asc" | "desc" } | null): AgingViewRow[] {
  const rows = searchOptions(source, search, row => ({ name: row.name, identifiers: [row.code] })).map(({ item }) => {
    const hasSaleHistory = item.lastSaleDate !== null && item.daysSinceLastSale !== null;
    const hasReceiptHistory = item.lastInDate !== null && item.daysInStock !== null;
    const needsReview = item.currentQty > 0 && (hasSaleHistory ? item.daysSinceLastSale! > 60 : hasReceiptHistory && item.daysInStock! > 60);
    return { ...item, unitLabel: item.catalogUnit || "Chưa có ĐVT", conversionLabel: item.currentConversion || "Chưa có quy đổi phụ",
      needsReview, insufficientHistory: !hasSaleHistory && !hasReceiptHistory,
      reviewStatus: needsReview ? "Cần rà soát" : !hasSaleHistory && !hasReceiptHistory ? "Thiếu lịch sử" : "Chưa quá ngưỡng" };
  }).filter(row => (!unit || row.unitLabel === unit) && (filter === "all" || (filter === "review" ? row.needsReview : filter === "insufficient" ? row.insufficientHistory : row.agingBucket === filter)));
  return sort ? sortReportRows(rows, row => row[sort.id as keyof AgingViewRow] ?? null, sort.direction) : rows;
}
export function agingTotals(rows: InventoryAgingRow[]) {
  const known = rows.filter(row => row.stockValue !== null);
  return { count: rows.length, knownValue: known.reduce((sum, row) => sum + row.stockValue!, 0), missingValues: rows.length - known.length };
}
export function agingBuckets(rows: InventoryAgingRow[]) {
  return (Object.keys(AGING_LABELS) as (keyof typeof AGING_LABELS)[]).map(key => {
    const selected = rows.filter(row => row.agingBucket === key), totals = agingTotals(selected);
    return { key, label: AGING_LABELS[key], ...totals, value: totals.missingValues ? null : totals.knownValue };
  });
}
export function agingSheet(rows: AgingViewRow[], name = "Chi tiết"): ExcelSheet {
  const totals = agingTotals(rows);
  return { name, tablePreferenceKey: "report.aging.products", columns: [
    { key: "code", label: "Mã hàng", width: 18, hideable: false }, { key: "name", label: "Mặt hàng", width: 32 },
    { key: "unitLabel", label: "ĐVT hiện tại", width: 18 }, { key: "conversionLabel", label: "Quy đổi hiện tại (tham khảo)", width: 38 },
    { key: "currentQty", label: "Tồn hiện tại", width: 18, format: "number", decimalPlaces: 4 },
    { key: "costPrice", label: "Giá danh mục hiện tại", width: 24, format: "currency", decimalPlaces: 4 },
    { key: "stockValue", label: "Giá trị tham chiếu", width: 24, format: "currency", decimalPlaces: 4 },
    { key: "lastInDate", label: "Nhập cuối (VN)", width: 24 }, { key: "daysInStock", label: "Ngày từ nhập cuối", width: 22, format: "number" },
    { key: "lastSaleDate", label: "Bán cuối (VN)", width: 24 }, { key: "daysSinceLastSale", label: "Ngày từ bán cuối", width: 22, format: "number" },
    { key: "bucketLabel", label: "Nhóm từ nhập cuối", width: 24 }, { key: "reviewStatus", label: "Rà soát", width: 24 },
  ], rows: rows.map(row => ({ ...row, lastInDate: row.lastInDate ? formatDate(row.lastInDate) : "Chưa có dữ liệu", lastSaleDate: row.lastSaleDate ? formatDate(row.lastSaleDate) : "Chưa có dữ liệu", bucketLabel: AGING_LABELS[row.agingBucket] })),
    footer: { code: "TỔNG", name: `${rows.length} mặt hàng`, currentQty: null, unitLabel: "Không cộng khác ĐVT", stockValue: totals.missingValues ? null : totals.knownValue } };
}
