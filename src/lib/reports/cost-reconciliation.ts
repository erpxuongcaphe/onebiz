import { searchOptions } from "@/lib/search-options";
import { sortReportRows } from "@/lib/reports/table-sort";
import type { ExcelSheet } from "@/lib/utils/excel-export";

export const COST_STATUSES = {
  ready: { label: "Đủ căn cứ chốt", action: "Rà soát nguồn và duyệt chốt giá vốn" },
  waiting: { label: "Chờ nguồn thực tế", action: "Đối chiếu thực nhận hoặc mẻ sản xuất" },
  ambiguous: { label: "Đối soát lịch sử", action: "Xác định liên kết chứng từ và sự kiện giá vốn" },
  missing: { label: "Thiếu nguồn ban đầu", action: "Truy chứng từ nhập hoặc tồn đầu kỳ" },
} as const;
export type CostStatus = keyof typeof COST_STATUSES;
export interface CostEvidence {
  mode: "event_line_mapping" | "historical_component_match" | "missing_source";
  eventCount: number; hasReturns: boolean; lastAttemptAt: string | null;
}
export interface CostPendingComponent { code: string; name: string; unit: string; pendingQuantity: number; costKnown: boolean; }
export interface CostReconciliationRow {
  id: string; invoiceId: string; invoiceCode: string; issuedAt: string;
  branchId: string; branchName: string; productId: string; code: string; name: string;
  quantity: number; unit: string; transactionQuantity: number | null; transactionUnit: string | null;
  conversionFactor: number | null; storedUnitCost: number | null; candidateUnitCost: number | null;
  status: CostStatus; evidence: CostEvidence; pendingComponents: CostPendingComponent[];
}
export interface CostReconciliationResult { rows: CostReconciliationRow[]; revision: string; checkedAt: string; }
export const COST_SORT_KEYS = ["issuedAt", "invoiceCode", "branchName", "code", "name", "quantity", "unit", "status", "candidateUnitCost"] as const;
export type CostSortKey = typeof COST_SORT_KEYS[number];

export function costReconciliationRows(rows: CostReconciliationRow[], filters: { search: string; status: string; product: string; unit: string }, sort: { id: string; direction: "asc" | "desc" }) {
  const matches = searchOptions(rows, filters.search, row => ({ name: `${row.name} ${row.branchName}`, identifiers: [row.code, row.invoiceCode] })).map(x => x.item)
    .filter(row => (!filters.status || row.status === filters.status) && (!filters.product || row.productId === filters.product) && (!filters.unit || row.unit === filters.unit));
  return sortReportRows(matches, row => row[sort.id as CostSortKey], sort.direction);
}

export function costReconciliationSummary(rows: CostReconciliationRow[]) {
  return Object.keys(COST_STATUSES).map(key => ({ status: key as CostStatus,
    invoices: new Set(rows.filter(row => row.status === key).map(row => row.invoiceId)).size,
    lines: rows.filter(row => row.status === key).length }));
}

export function costPendingComponentsSheet(rows: CostReconciliationRow[]): ExcelSheet {
  const invoices = [...new Map(rows.map(row => [row.invoiceId, row])).values()];
  return { name: "Thành phần chờ", columns: [
    { key: "invoiceCode", label: "Hóa đơn" }, { key: "branchName", label: "Chi nhánh" },
    { key: "code", label: "Mã thành phần" }, { key: "name", label: "Thành phần", width: 34 },
    { key: "pendingQuantity", label: "Lượng chờ", format: "number", decimalPlaces: 4 },
    { key: "unit", label: "ĐVT" }, { key: "sourceStatus", label: "Nguồn giá" },
  ], rows: invoices.flatMap(row => row.pendingComponents.map(component => ({ ...component,
    invoiceCode: row.invoiceCode, branchName: row.branchName,
    sourceStatus: component.costKnown ? "Có đơn giá, chưa đủ nguồn lượng" : "Chưa đủ nguồn giá" }))) };
}

export function costReconciliationSheet(rows: CostReconciliationRow[]): ExcelSheet {
  return { name: "Đối soát giá vốn", columns: [
    { key: "invoiceCode", label: "Hóa đơn" }, { key: "issuedAt", label: "Ngày hóa đơn" },
    { key: "branchName", label: "Chi nhánh" }, { key: "code", label: "Mã hàng" }, { key: "name", label: "Tên hàng", width: 34 },
    { key: "quantity", label: "Số lượng", format: "number", decimalPlaces: 4 }, { key: "unit", label: "ĐVT" },
    { key: "transactionQuantity", label: "SL giao dịch", format: "number", decimalPlaces: 4 }, { key: "transactionUnit", label: "ĐVT giao dịch" },
    { key: "conversionFactor", label: "Hệ số quy đổi", format: "number", decimalPlaces: 4 },
    { key: "statusLabel", label: "Trạng thái" }, { key: "candidateUnitCost", label: "Giá vốn đối chiếu (đ/ĐVT)", format: "number", decimalPlaces: 4 },
    { key: "storedUnitCost", label: "Giá đang lưu, chưa chốt (đ/ĐVT)", format: "number", decimalPlaces: 4 },
    { key: "sourceMode", label: "Nguồn đối chiếu", width: 32 }, { key: "eventCount", label: "Sự kiện giá vốn", format: "number" },
    { key: "hasReturns", label: "Có trả hàng" }, { key: "lastAttempt", label: "Lần xử lý gần nhất" },
    { key: "pending", label: "Thành phần chờ theo hóa đơn", width: 40 }, { key: "action", label: "Bước tiếp theo", width: 42 },
  ], rows: rows.map(row => ({ ...row, issuedAt: new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short" }).format(new Date(row.issuedAt)),
    statusLabel: COST_STATUSES[row.status].label, action: COST_STATUSES[row.status].action,
    sourceMode: row.evidence.mode === "event_line_mapping" ? "Liên kết sự kiện – dòng hàng" : row.evidence.mode === "historical_component_match" ? "Đối chiếu thành phần lịch sử" : "Chưa có nguồn giá",
    eventCount: row.evidence.eventCount, hasReturns: row.evidence.hasReturns ? "Có" : "Không", lastAttempt: row.evidence.lastAttemptAt,
    pending: row.pendingComponents.map(p => `${p.code} · ${p.name}: ${p.pendingQuantity} ${p.unit}`).join("; ") })) };
}
