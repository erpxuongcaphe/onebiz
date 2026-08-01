/**
 * Split Bill Service - all mutations run in one database transaction.
 */

import { getClient, handleError, getCurrentTenantId } from "./base";

export interface SplitChildResult {
  orderId: string;
  orderNumber: string;
  itemCount: number;
  discountAmount: number;
}

export interface SplitResult {
  childOrderId: string;
  childDiscountAmount: number;
  parentItemsLeft: number;
  parentDiscountAmount: number;
}

interface SplitRpcResult {
  parent_items_left?: number;
  parent_discount_amount?: number;
  children?: Array<{
    order_id?: string;
    order_number?: string;
    item_count?: number;
    discount_amount?: number;
  }>;
}

function parseSplitResult(data: unknown): {
  parentItemsLeft: number;
  parentDiscountAmount: number;
  children: SplitChildResult[];
} {
  const raw = (data ?? {}) as SplitRpcResult;
  const children = (raw.children ?? []).map((child) => ({
    orderId: String(child.order_id ?? ""),
    orderNumber: String(child.order_number ?? ""),
    itemCount: Number(child.item_count ?? 0),
    discountAmount: Number(child.discount_amount ?? 0),
  }));
  if (children.length === 0 || children.some((child) => !child.orderId)) {
    throw new Error("May chu khong tra ve ket qua tach bill hop le.");
  }
  return {
    parentItemsLeft: Number(raw.parent_items_left ?? 0),
    parentDiscountAmount: Number(raw.parent_discount_amount ?? 0),
    children,
  };
}

export async function splitByItems(
  orderId: string,
  itemIds: string[],
): Promise<SplitResult> {
  if (itemIds.length === 0) throw new Error("Chon it nhat 1 mon de tach");

  const supabase = getClient();
  const { data, error } = await (supabase.rpc as any)(
    "split_kitchen_order_atomic",
    {
      p_order_id: orderId,
      p_mode: "items",
      p_item_ids: itemIds,
      p_number_of_ways: null,
    },
  );
  if (error) handleError(error, "splitByItems.rpc");

  const result = parseSplitResult(data);
  const child = result.children[0];
  return {
    childOrderId: child.orderId,
    childDiscountAmount: child.discountAmount,
    parentItemsLeft: result.parentItemsLeft,
    parentDiscountAmount: result.parentDiscountAmount,
  };
}

export async function splitEqually(
  orderId: string,
  numberOfWays: number,
): Promise<{
  childOrderIds: string[];
  childDiscountAmounts: number[];
  parentDiscountAmount: number;
}> {
  if (numberOfWays < 2 || numberOfWays > 10) {
    throw new Error("So phan tach phai tu 2 den 10");
  }

  const supabase = getClient();
  const { data, error } = await (supabase.rpc as any)(
    "split_kitchen_order_atomic",
    {
      p_order_id: orderId,
      p_mode: "equal",
      p_item_ids: null,
      p_number_of_ways: numberOfWays,
    },
  );
  if (error) handleError(error, "splitEqually.rpc");

  const result = parseSplitResult(data);
  return {
    childOrderIds: result.children.map((child) => child.orderId),
    childDiscountAmounts: result.children.map((child) => child.discountAmount),
    parentDiscountAmount: result.parentDiscountAmount,
  };
}

/**
 * Check if all orders (parent + children) for a table are completed.
 * Used to determine when to release the table.
 */
export async function areAllTableOrdersCompleted(tableId: string): Promise<boolean> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const { count } = await supabase
    .from("kitchen_orders")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("table_id", tableId)
    .not("status", "in", '("completed","cancelled")');

  return (count ?? 0) === 0;
}
