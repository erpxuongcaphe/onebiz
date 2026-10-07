import type { KitchenOrder, FnbTabSnapshot } from "./types/fnb";

/** Unassigned orders use walk-in by default; named customers remain shared. */
export function customerContextFromOrder(order: KitchenOrder): Pick<FnbTabSnapshot, "customerId" | "customerName" | "customerConfirmationRequired"> {
  return {
    customerId: order.customerSelected ? order.customerId ?? undefined : undefined,
    customerName: order.customerSelected ? order.customerName || "Khách lẻ" : "Khách lẻ",
    customerConfirmationRequired: false,
  };
}

export function needsCustomerSelection(tab: FnbTabSnapshot | undefined): boolean {
  return !!tab?.customerId && !tab.customerName;
}
