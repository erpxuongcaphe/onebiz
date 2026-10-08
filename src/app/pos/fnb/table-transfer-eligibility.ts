import type { FnbTabSnapshot, RestaurantTable } from "@/lib/types/fnb";

export function canTransferFnbTab(
  tab: Pick<FnbTabSnapshot, "orderType" | "tableId" | "kitchenOrderId"> | undefined,
  tables: Pick<RestaurantTable, "id" | "status" | "currentOrderId">[],
): boolean {
  if (tab?.orderType !== "dine_in" || !tab.tableId || !tab.kitchenOrderId) return false;
  // currentOrderId is only the table's representative bill. A split bill can
  // move independently; the RPC validates its actual table and unpaid status.
  return tables.some((table) => table.id === tab.tableId
    && table.status === "occupied");
}
