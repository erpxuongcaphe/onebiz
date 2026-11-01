import type { DeliveryInvoiceRow } from "@/lib/services/supabase/delivery-invoice-management";
import { deliveryDateTime, DELIVERY_TIER_LABELS } from "./delivery-report-export";
import { normalizeSearch } from "@/lib/smart-search";
import type { ExcelSheet } from "@/lib/utils/excel-export";
import { sortReportRows } from "./table-sort";
export const DELIVERY_STATUS_LABELS = { cancelled: "Đã hủy", completed: "Đã giao", assigned: "Đang giao", unassigned: "Chưa nhận giao" };
export const INVOICE_PAYMENT_LABELS: Record<string, string> = { cash: "Tiền mặt", transfer: "Chuyển khoản", card: "Thẻ", mixed: "Kết hợp", bank_transfer: "Chuyển khoản" };
const INVOICE_STATUS_LABELS: Record<string, string> = { completed: "Hoàn tất", cancelled: "Đã hủy", draft: "Nháp", pending: "Chưa hoàn tất", posted: "Đã ghi sổ" };
export type DeliveryInvoiceView = ReturnType<typeof deliveryInvoiceView>[number];
export function deliveryInvoiceView(items: DeliveryInvoiceRow[]) {
  const invoiceCounts = new Map<string, number>();
  for (const row of items) if (row.invoiceId) invoiceCounts.set(row.invoiceId, (invoiceCounts.get(row.invoiceId) ?? 0) + 1);
  return items.map(row => ({ ...row,
    staffKey: `${row.branchId}:${row.staffId ?? "unassigned"}`,
    deliveryStatusLabel: DELIVERY_STATUS_LABELS[row.deliveryStatus],
    invoiceStatusLabel: row.invoiceStatus ? INVOICE_STATUS_LABELS[row.invoiceStatus] ?? row.invoiceStatus : "",
    paymentMethodLabel: row.paymentMethod ? INVOICE_PAYMENT_LABELS[row.paymentMethod] ?? row.paymentMethod : "",
    tierLabel: row.deliveryTier ? DELIVERY_TIER_LABELS[row.deliveryTier] ?? row.deliveryTier : "",
    createdLabel: deliveryDateTime(row.createdAt), assignedLabel: deliveryDateTime(row.assignedAt), completedLabel: deliveryDateTime(row.completedAt),
    invoiceDuplicate: !!row.invoiceId && (invoiceCounts.get(row.invoiceId) ?? 0) > 1,
    invoiceEvidence: !row.invoiceId ? "Chưa có hóa đơn phù hợp" : (invoiceCounts.get(row.invoiceId) ?? 0) > 1 ? "Hóa đơn gắn nhiều đơn giao" : "",
  }));
}
export function filterDeliveryRows(rows: DeliveryInvoiceView[], filters: { search: string; staff: string; status: string; method: string }) {
  const terms = normalizeSearch(filters.search).split(/\s+/).filter(Boolean);
  return rows.filter(row => (!filters.staff || row.staffKey === filters.staff) && (!filters.status || row.deliveryStatus === filters.status) && (!filters.method || row.paymentMethod === filters.method) &&
    terms.every(term => normalizeSearch([row.orderNumber, row.invoiceCode, row.staffName, row.branchName, row.customerName].join(" ")).includes(term)));
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
  return { orders: rows.length, completed: active.filter(row => row.deliveryStatus === "completed").length,
    cancelled: rows.length - active.length, unassigned: active.filter(row => !row.staffId).length,
    invoiceTotal: sum("invoiceTotal"), invoicePaid: sum("invoicePaid"), invoiceDebt: sum("invoiceDebt"),
    deliveryFee: active.reduce((sum, row) => sum + (row.deliveryFee ?? 0), 0), timedCount: timed.length,
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
