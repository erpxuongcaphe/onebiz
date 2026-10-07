import type { KitchenOrder } from "@/lib/types/fnb";
export type FnbOpenOrder = KitchenOrder & { itemCount: number; provisionalTotal: number };
export function isUnpaidFnbOrder(order: Pick<KitchenOrder, "invoiceId" | "mergedIntoId" | "status">): boolean {
  return !order.invoiceId && !order.mergedIntoId && ["pending", "preparing", "ready", "served"].includes(order.status);
}
export function summarizeFnbOpenOrder(order: KitchenOrder): FnbOpenOrder {
  const items = order.items ?? [];
  const subtotal = items.reduce((sum, item) => sum + (item.unitPrice + item.toppings.reduce((n, topping) => n + topping.price * topping.quantity, 0)) * item.quantity, 0);
  return { ...order, itemCount: items.reduce((sum, item) => sum + item.quantity, 0), provisionalTotal: Math.max(0, subtotal - order.discountAmount) + (order.orderType === "delivery" ? order.deliveryFee : 0) };
}
export function fnbOpenOrderLabel(order: KitchenOrder): string {
  return order.orderType === "dine_in" ? (order.tableName || "Tại quán · thiếu bàn") : order.orderType === "delivery" ? "Giao hàng" : "Mang về";
}
