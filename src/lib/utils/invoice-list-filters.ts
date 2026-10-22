import {
  copyDefaultStatuses,
  DEFAULT_INVOICE_LIST_STATUSES,
} from "./document-list-statuses";

export type InvoiceDeliveryFilter = "all" | "delivery" | "no_delivery";
export type InvoiceKpiFilter = "all" | "completed" | "cancelled";

const DELIVERY = "delivery";
const NO_DELIVERY = "no_delivery";

/** Chọn cả hai hoặc bỏ cả hai đều có nghĩa là không thu hẹp kết quả. */
export function resolveInvoiceDeliveryFilter(
  selectedTypes: readonly string[],
): InvoiceDeliveryFilter {
  const hasDelivery = selectedTypes.includes(DELIVERY);
  const hasNoDelivery = selectedTypes.includes(NO_DELIVERY);
  if (hasDelivery === hasNoDelivery) return "all";
  return hasDelivery ? "delivery" : "no_delivery";
}

export function invoiceStatusesForKpi(filter: InvoiceKpiFilter): string[] {
  if (filter === "completed") return ["completed"];
  if (filter === "cancelled") return ["cancelled"];
  return copyDefaultStatuses(DEFAULT_INVOICE_LIST_STATUSES);
}

export function isInvoiceKpiSelected(
  selectedStatuses: readonly string[],
  filter: InvoiceKpiFilter,
): boolean {
  const expected = invoiceStatusesForKpi(filter);
  return (
    selectedStatuses.length === expected.length &&
    expected.every((status) => selectedStatuses.includes(status))
  );
}

export const FNB_INVOICE_TYPES = [
  { value: "all", label: "Tất cả", icon: "receipt_long" },
  { value: "dine_in", label: "Tại chỗ", icon: "table_restaurant" },
  { value: "takeaway", label: "Mang về", icon: "takeout_dining" },
  { value: "delivery", label: "Giao hàng", icon: "local_shipping" },
] as const;
export type FnbInvoiceType = (typeof FNB_INVOICE_TYPES)[number]["value"];
export function resolveFnbInvoiceType(value: unknown): FnbInvoiceType {
  return FNB_INVOICE_TYPES.some(option => option.value === value) ? value as FnbInvoiceType : "all";
}
/** Missing historical order type stays unknown, never guessed as takeaway. */
export function invoiceFnbTypeLabel(value?: string): string {
  return FNB_INVOICE_TYPES.find(option => option.value !== "all" && option.value === value)?.label ?? "Chưa ghi nhận";
}
