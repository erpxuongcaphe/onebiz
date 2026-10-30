import type { CogsByBomRow } from "@/lib/services/supabase/bom-reports";
import { searchOptions } from "@/lib/search-options";
import { sortReportRows } from "@/lib/reports/table-sort";
import type { ExcelSheet } from "@/lib/utils/excel-export";

export type BomCogsViewRow = CogsByBomRow & { recordedUnit: string; unitReference: string; conversionReference: string; costStatus: string };
export function bomCogsView(source: CogsByBomRow[], search: string, unit: string, status: string, sort: { id: string; direction: "asc" | "desc" }): BomCogsViewRow[] {
  const rows = searchOptions(source, search, row => ({ name: `${row.productName} ${row.branchName}`, identifiers: [row.productCode, row.invoiceCode] }))
    .map(({ item }) => ({ ...item, recordedUnit: item.recordedUnit || "Chưa có ĐVT lịch sử", unitReference: item.catalogUnit || "Chưa có ĐVT", conversionReference: item.currentConversion || "Chưa có dữ liệu quy đổi", costStatus: item.cogsReal == null ? "Chưa xác định" : "Đã ghi nhận" }))
    .filter(row => (!unit || row.unitReference === unit) && (!status || (status === "missing" ? row.cogsReal == null : row.cogsReal != null)));
  return sortReportRows(rows, row => row[sort.id as keyof BomCogsViewRow] ?? null, sort.direction);
}
export function bomCogsTotals(rows: CogsByBomRow[]) {
  const known = rows.filter(row => row.cogsReal !== null);
  return { revenue: rows.reduce((sum, row) => sum + row.revenue, 0), knownCost: known.reduce((sum, row) => sum + (row.cogsReal ?? 0), 0),
    knownMargin: known.reduce((sum, row) => sum + row.revenue - (row.cogsReal ?? 0), 0), missing: rows.length - known.length };
}
export function bomCogsSheet(rows: BomCogsViewRow[]): ExcelSheet {
  const total = bomCogsTotals(rows);
  return { name: "Chi tiết giá vốn", tablePreferenceKey: "report.bom-cogs.rows", columns: [
    { key: "invoiceCode", label: "Hóa đơn", width: 16, hideable: false }, { key: "invoiceDate", label: "Thời gian", width: 24 },
    { key: "branchName", label: "Chi nhánh", width: 26 }, { key: "productCode", label: "Mã hàng", width: 18 }, { key: "productName", label: "Mặt hàng", width: 32 },
    { key: "qtySold", label: "SL chứng từ", width: 16, format: "number", decimalPlaces: 4 }, { key: "recordedUnit", label: "ĐVT lịch sử", width: 20 },
    { key: "unitReference", label: "ĐVT hiện tại (tham khảo)", width: 24 }, { key: "conversionReference", label: "Quy đổi hiện tại (tham khảo)", width: 38 },
    { key: "revenue", label: "Doanh thu trước hàng trả", width: 24, format: "currency" },
    { key: "cogsReal", label: "Giá vốn", width: 20, format: "currency" }, { key: "margin", label: "Lãi gộp", width: 20, format: "currency" },
    { key: "costStatus", label: "Trạng thái giá vốn", width: 22 },
  ], rows: rows.map(row => ({ ...row })), footer: { invoiceCode: "TỔNG", qtySold: null, recordedUnit: "Không cộng khác ĐVT", revenue: total.revenue,
    cogsReal: total.missing ? null : total.knownCost, margin: total.missing ? null : total.knownMargin } };
}
