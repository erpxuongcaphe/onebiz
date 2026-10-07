import type { KitchenOrder, FnbTabSnapshot } from "./types/fnb";

/** A selected walk-in guest is different from an order with no customer context. */
export function customerContextFromOrder(order: KitchenOrder): Pick<FnbTabSnapshot, "customerId" | "customerName" | "customerConfirmationRequired"> {
  return {
    customerId: order.customerSelected ? order.customerId ?? undefined : undefined,
    customerName: order.customerSelected ? order.customerName || "Khách lẻ" : "Chọn khách",
    customerConfirmationRequired: !order.customerSelected,
  };
}

export function needsCustomerSelection(tab: FnbTabSnapshot | undefined): boolean {
  return !!tab && tab.customerConfirmationRequired !== false;
}
