import type { FnbTabSnapshot, KitchenOrder } from "@/lib/types/fnb";
export type FnbOpenOrder = KitchenOrder & { itemCount: number; provisionalTotal: number };
export function isUnpaidFnbOrder(order: Pick<KitchenOrder, "invoiceId" | "mergedIntoId" | "status">): boolean {
  return !order.invoiceId && !order.mergedIntoId && ["pending", "preparing", "ready", "served"].includes(order.status);
}

export function getFnbTableBills(tableId: string, orders: FnbOpenOrder[], tabs: FnbTabSnapshot[]) {
  return {
    orders: orders.filter(order => order.tableId === tableId && isUnpaidFnbOrder(order)),
    drafts: tabs.filter(tab => tab.tableId === tableId && !tab.kitchenOrderId),
  };
}

export function getSingleFnbTableBill(
  bills: ReturnType<typeof getFnbTableBills>,
  currentOrderId: string | null,
) {
  if (bills.orders.length + bills.drafts.length !== 1) return null;

  const [order] = bills.orders;
  // A conflicting floor-plan pointer can mean the list missed another bill.
  if (currentOrderId && currentOrderId !== order?.id) return null;
  return order ? { order } : { draftId: bills.drafts[0].id };
}

export function summarizeFnbOpenOrder(order: KitchenOrder): FnbOpenOrder {
  const items = order.items ?? [];
  const subtotal = items.reduce((sum, item) => sum + (item.unitPrice + item.toppings.reduce((n, topping) => n + topping.price * topping.quantity, 0)) * item.quantity, 0);
  return { ...order, itemCount: items.reduce((sum, item) => sum + item.quantity, 0), provisionalTotal: Math.max(0, subtotal - order.discountAmount) + (order.orderType === "delivery" ? order.deliveryFee : 0) };
}
export function fnbOpenOrderLabel(order: KitchenOrder): string {
  return order.orderType === "dine_in" ? (order.tableName || "Tại quán · thiếu bàn") : order.orderType === "delivery" ? "Giao hàng" : "Mang về";
}
