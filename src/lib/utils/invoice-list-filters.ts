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
