import { getClient, handleError } from "./base";

export interface KitchenReturnSummary {
  soldQuantity: number;
  returnedQuantity: number;
}

export interface KitchenReturnLine {
  kitchenOrderId: string;
  remainingQuantity: number;
  returnedQuantity: number;
}

export async function getKitchenReturnLines(branchId: string): Promise<Map<string, KitchenReturnLine>> {
  const { data, error } = await getClient().rpc("fnb_kitchen_return_lines", { p_branch_id: branchId });
  if (error) handleError(error, "getKitchenReturnLines");
  return new Map((data ?? []).map((row) => [row.kitchen_order_item_id, {
    kitchenOrderId: row.kitchen_order_id,
    remainingQuantity: Number(row.remaining_quantity),
    returnedQuantity: Number(row.returned_quantity),
  }]));
}

/** KDS-only counts: no invoice prices, customer details or guessed item matching. */
export async function getKitchenReturnSummaries(
  branchId: string,
): Promise<Map<string, KitchenReturnSummary>> {
  const { data, error } = await getClient().rpc("fnb_kitchen_return_summary", {
    p_branch_id: branchId,
  });
  if (error) handleError(error, "getKitchenReturnSummaries");
  return new Map((data ?? []).map((row) => [row.kitchen_order_id, {
    soldQuantity: Number(row.sold_quantity),
    returnedQuantity: Number(row.returned_quantity),
  }]));
}
