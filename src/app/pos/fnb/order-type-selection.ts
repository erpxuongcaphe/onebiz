import type { FnbTabSnapshot, OrderType } from "@/lib/types/fnb";

export function needsFnbTable(tab: Pick<FnbTabSnapshot, "orderType" | "tableId"> | undefined): boolean {
  return tab?.orderType === "dine_in" && !tab.tableId;
}

/** Keep type, table and visible name together; never relabel a sent order. */
export function changeDraftOrderType(tab: FnbTabSnapshot, next: OrderType, table?: { id: string; tableNumber: string | number }): FnbTabSnapshot {
  if (tab.kitchenOrderId || (next === "dine_in" && !table)) return tab;
  const suffix = tab.label.match(/ #\d+$/)?.[0] ?? "";
  const label = next === "dine_in" ? `Bàn ${table!.tableNumber}` : `${next === "delivery" ? "Giao hàng" : "Mang về"}${suffix}`;
  return {
    ...tab, orderType: next, tableId: next === "dine_in" ? table!.id : undefined, label,
    ...(next !== "delivery" ? { deliveryPlatform: undefined, deliveryFee: 0, platformCommissionPercent: 0, deliveryDistanceTier: undefined, deliveryStaffId: undefined } : {}),
  };
}
