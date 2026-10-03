import type { FnbTabSnapshot, RestaurantTable } from "@/lib/types/fnb";

export function canTransferFnbTab(
  tab: Pick<FnbTabSnapshot, "orderType" | "tableId" | "kitchenOrderId"> | undefined,
  tables: Pick<RestaurantTable, "id" | "status" | "currentOrderId">[],
): boolean {
  if (tab?.orderType !== "dine_in" || !tab.tableId || !tab.kitchenOrderId) return false;
  // Split bills share the table reference, but only its current order owns it.
  return tables.some((table) => table.id === tab.tableId
    && table.status === "occupied" && table.currentOrderId === tab.kitchenOrderId);
}
