import { isUnpaidFnbOrder, type FnbOpenOrder } from "./fnb-open-orders";
export interface FnbBillCardDetail { id: string; orderNumber: string; customerName: string; note: string; }
export function buildFnbTableBillDetails(orders: FnbOpenOrder[]): Record<string, FnbBillCardDetail[]> {
  const result: Record<string, FnbBillCardDetail[]> = {};
  for (const order of orders) {
    if (order.orderType !== "dine_in" || !order.tableId || !isUnpaidFnbOrder(order)) continue;
    (result[order.tableId] ??= []).push({ id: order.id, orderNumber: order.orderNumber, customerName: order.customerName?.trim() || "Khách lẻ", note: order.note?.trim() || "" });
  }
  return result;
}
export function matchesFnbBillCardSearch(query: string, ...values: (string | null | undefined)[]) {
  const normalize = (value: string) => value.toLocaleLowerCase("vi").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
  return normalize(values.filter(Boolean).join(" ")).includes(normalize(query.trim()));
}
