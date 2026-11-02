import type { DeliveryInvoiceRow } from "@/lib/services/supabase/delivery-invoice-management";
import { deliveryDateTime, DELIVERY_TIER_LABELS } from "./delivery-report-export";
import { normalizeSearch } from "@/lib/smart-search";
import type { ExcelSheet } from "@/lib/utils/excel-export";
import { sortReportRows } from "./table-sort";
import { cashBookDate } from "@/lib/cash-time";
import { matchesMetricFilters, type MetricFilter } from "./metric-filter";
export const DELIVERY_STATUS_LABELS = { cancelled: "Đã hủy", completed: "Đã giao", assigned: "Đang giao", unassigned: "Chưa nhận giao" };
export const INVOICE_PAYMENT_LABELS: Record<string, string> = { cash: "Tiền mặt", transfer: "Chuyển khoản", card: "Thẻ", mixed: "Kết hợp", bank_transfer: "Chuyển khoản" };
export const DELIVERY_INVOICE_STATUS_LABELS: Record<string, string> = { completed: "Hoàn tất", cancelled: "Đã hủy", draft: "Nháp", pending: "Chưa hoàn tất", posted: "Đã ghi sổ" };
export interface DeliveryFilters {
  search: string; staff: string; status: string; method: string;
  branch?: string; invoiceStatus?: string; tier?: string;
  evidence?: string; assignedState?: string;
  assignedFrom?: string; assignedTo?: string; completedFrom?: string; completedTo?: string;
  metrics?: MetricFilter[];
}
export function createDeliveryFilters(): DeliveryFilters {
  return { search: "", staff: "", status: "", method: "", branch: "", invoiceStatus: "", tier: "",
    evidence: "", assignedState: "", assignedFrom: "", assignedTo: "", completedFrom: "", completedTo: "", metrics: [] };
}
const METRIC_KEYS = new Set(["durationSeconds", "invoiceTotal", "invoicePaid", "invoiceDebt", "deliveryFee"]);
const EVIDENCE_LABELS: Record<string, string> = { linked: "Có hóa đơn phù hợp", missing: "Chưa có hóa đơn phù hợp", duplicate: "Hóa đơn gắn nhiều đơn giao" };
export type DeliveryInvoiceView = ReturnType<typeof deliveryInvoiceView>[number];
export function deliveryInvoiceView(items: DeliveryInvoiceRow[]) {
  const invoiceCounts = new Map<string, number>();
  for (const row of items) if (row.invoiceId) invoiceCounts.set(row.invoiceId, (invoiceCounts.get(row.invoiceId) ?? 0) + 1);
  return items.map(row => ({ ...row,
    staffKey: `${row.branchId}:${row.staffId ?? "unassigned"}`,
    deliveryStatusLabel: DELIVERY_STATUS_LABELS[row.deliveryStatus],
    invoiceStatusLabel: row.invoiceStatus ? DELIVERY_INVOICE_STATUS_LABELS[row.invoiceStatus] ?? row.invoiceStatus : "",
    paymentMethodLabel: row.paymentMethod ? INVOICE_PAYMENT_LABELS[row.paymentMethod] ?? row.paymentMethod : "",
    tierLabel: row.deliveryTier ? DELIVERY_TIER_LABELS[row.deliveryTier] ?? row.deliveryTier : "",
    createdLabel: deliveryDateTime(row.createdAt), assignedLabel: deliveryDateTime(row.assignedAt), completedLabel: deliveryDateTime(row.completedAt),
    invoiceDuplicate: !!row.invoiceId && (invoiceCounts.get(row.invoiceId) ?? 0) > 1,
    invoiceEvidence: !row.invoiceId ? "Chưa có hóa đơn phù hợp" : (invoiceCounts.get(row.invoiceId) ?? 0) > 1 ? "Hóa đơn gắn nhiều đơn giao" : "",
  }));
}
export function filterDeliveryRows(rows: DeliveryInvoiceView[], filters: DeliveryFilters) {
  const metrics = filters.metrics ?? [];
  if (metrics.some(filter => !METRIC_KEYS.has(filter.key))) return [];
  const validRange = (from?: string, to?: string) =>
    (!from || (/^\d{4}-\d{2}-\d{2}$/.test(from) && cashBookDate(from) === from)) &&
    (!to || (/^\d{4}-\d{2}-\d{2}$/.test(to) && cashBookDate(to) === to)) && (!from || !to || from <= to);
  if (!validRange(filters.assignedFrom, filters.assignedTo) || !validRange(filters.completedFrom, filters.completedTo)) return [];
  const inRange = (value: string | null, from?: string, to?: string) => {
    if (!from && !to) return true;
    const day = value ? cashBookDate(value) : "";
    return !!day && (!from || day >= from) && (!to || day <= to);
  };
  const terms = normalizeSearch(filters.search).split(/\s+/).filter(Boolean);
  // Duplicate evidence belongs to the full source, never recompute it after filtering.
  return rows.filter(row => {
    const evidence = !row.invoiceId ? "missing" : row.invoiceDuplicate ? "duplicate" : "linked";
    const assignedState = row.staffId ? "assigned" : "unassigned";
    return (!filters.staff || row.staffKey === filters.staff) && (!filters.status || row.deliveryStatus === filters.status) &&
      (!filters.method || (row.paymentMethod === "bank_transfer" ? "transfer" : row.paymentMethod) === (filters.method === "bank_transfer" ? "transfer" : filters.method)) && (!filters.branch || row.branchId === filters.branch) &&
      (!filters.invoiceStatus || row.invoiceStatus === filters.invoiceStatus) && (!filters.tier || row.deliveryTier === filters.tier) &&
      (!filters.evidence || evidence === filters.evidence) && (!filters.assignedState || assignedState === filters.assignedState) &&
      inRange(row.assignedAt, filters.assignedFrom, filters.assignedTo) && inRange(row.completedAt, filters.completedFrom, filters.completedTo) &&
      matchesMetricFilters(row, metrics) && terms.every(term => normalizeSearch([
        row.orderNumber, row.invoiceCode, row.staffName, row.branchName, row.customerName,
        row.deliveryStatusLabel, row.invoiceStatusLabel, row.tierLabel, row.paymentMethodLabel,
        row.invoiceEvidence, EVIDENCE_LABELS[evidence], assignedState === "assigned" ? "Đã nhận giao" : "Chưa nhận giao",
      ].join(" ")).includes(term));
  });
}
export function deliverySortValue(row: DeliveryInvoiceView, key: string) {
  const timestamps: Record<string, string | null> = { createdLabel: row.createdAt, assignedLabel: row.assignedAt, completedLabel: row.completedAt };
  return key in timestamps ? timestamps[key] ? Date.parse(timestamps[key]!) : null : row[key as keyof DeliveryInvoiceView];
}
export function sortDeliveryRows(rows: DeliveryInvoiceView[], sort: { id: string; direction: "asc" | "desc" } | null) {
  return sort ? sortReportRows(rows, row => deliverySortValue(row, sort.id), sort.direction) : rows;
}
export function summarizeDeliveryRows(rows: DeliveryInvoiceView[]) {
  const active = rows.filter(row => row.deliveryStatus !== "cancelled");
  const moneyRows = active.filter(row => !!row.invoiceId && !row.invoiceDuplicate);
  const sum = (key: "invoiceTotal" | "invoicePaid" | "invoiceDebt") => {
    const known = moneyRows.flatMap(row => row[key] === null || row[key] === undefined ? [] : [row[key]!]);
    return known.length ? known.reduce((total, value) => total + value, 0) : null;
  };
  const timed = active.filter(row => row.durationSeconds !== null && row.durationSeconds !== undefined);
  const knownFees = active.flatMap(row => row.deliveryFee === null || row.deliveryFee === undefined ? [] : [row.deliveryFee]);
  return { orders: rows.length, completed: active.filter(row => row.deliveryStatus === "completed").length,
    cancelled: rows.length - active.length, unassigned: active.filter(row => !row.staffId).length,
    invoiceTotal: sum("invoiceTotal"), invoicePaid: sum("invoicePaid"), invoiceDebt: sum("invoiceDebt"),
    deliveryFee: knownFees.length ? knownFees.reduce((sum, value) => sum + value, 0) : null, timedCount: timed.length,
    avgDeliverySeconds: timed.length ? Math.round(timed.reduce((sum, row) => sum + row.durationSeconds!, 0) / timed.length) : null,
    missingInvoice: active.filter(row => !row.invoiceId || row.invoiceDuplicate || row.invoiceTotal === null || row.invoicePaid === null || row.invoiceDebt === null).length };
}
export function deliveryManagementColumns(canViewMoney: boolean): ExcelSheet["columns"] {
  return [
    { label: "Chi nhánh", key: "branchName", width: 28 }, { label: "Nhân viên giao", key: "staffName", width: 25 },
    { label: "Mã đơn", key: "orderNumber", width: 18 }, { label: "Mã hóa đơn", key: "invoiceCode", width: 18 },
    { label: "Khách hàng", key: "customerName", width: 25 }, { label: "Trạng thái giao", key: "deliveryStatusLabel", width: 18 },
    { label: "Trạng thái hóa đơn", key: "invoiceStatusLabel", width: 20 },
    ...(canViewMoney ? [
      { label: "Giá trị hóa đơn (VND)", key: "invoiceTotal", width: 23, format: "currency" as const },
      { label: "Đã thanh toán trên HĐ (VND)", key: "invoicePaid", width: 26, format: "currency" as const },
      { label: "Còn phải thu trên HĐ (VND)", key: "invoiceDebt", width: 26, format: "currency" as const },
      { label: "Phí giao trên đơn (VND)", key: "deliveryFee", width: 24, format: "currency" as const },
      { label: "Hình thức trên hóa đơn", key: "paymentMethodLabel", width: 24 },
    ] : []),
    { label: "Cự ly", key: "tierLabel", width: 14 }, { label: "Tạo đơn lúc", key: "createdLabel", width: 23 },
    { label: "Nhận giao lúc", key: "assignedLabel", width: 23 }, { label: "Hoàn tất lúc", key: "completedLabel", width: 23 },
    { label: "Thời gian giao (giây)", key: "durationSeconds", width: 23, format: "number" },
    { label: "Kiểm tra hóa đơn", key: "invoiceEvidence", width: 32 },
  ];
}
