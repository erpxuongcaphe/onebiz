/**
 * F&B Service: Kitchen Orders
 * CRUD + status transitions for kitchen_orders + kitchen_order_items.
 */

import type { Database } from "@/lib/supabase/types";
import type {
  KitchenOrder,
  KitchenOrderItem,
  KitchenOrderStatus,
  KitchenItemStatus,
  ToppingAttachment,
  DeliveryPlatform,
} from "@/lib/types/fnb";
import { getClient, handleError } from "./base";

type KOInsert = Database["public"]["Tables"]["kitchen_orders"]["Insert"];
type KOItemInsert = Database["public"]["Tables"]["kitchen_order_items"]["Insert"];

// ── Mappers ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapKitchenOrder(row: any): KitchenOrder {
  const profile = row.profiles as { full_name: string } | null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    branchId: row.branch_id,
    invoiceId: row.invoice_id,
    tableId: row.table_id,
    orderNumber: row.order_number,
    orderType: row.order_type,
    status: row.status,
    note: row.note,
    createdBy: row.created_by,
    createdByName: profile?.full_name ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    discountAmount: Number(row.discount_amount ?? 0),
    discountReason: row.discount_reason ?? null,
    deliveryPlatform: row.delivery_platform ?? null,
    deliveryFee: Number(row.delivery_fee ?? 0),
    platformCommission: Number(row.platform_commission ?? 0),
    mergedIntoId: row.merged_into_id ?? null,
    originalTableId: row.original_table_id ?? null,
    parentOrderId: row.parent_order_id ?? null,
    tableName: row.restaurant_tables?.name ?? undefined,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapKitchenItem(row: any): KitchenOrderItem {
  return {
    id: row.id,
    kitchenOrderId: row.kitchen_order_id,
    productId: row.product_id,
    productName: row.product_name,
    variantId: row.variant_id,
    variantLabel: row.variant_label,
    quantity: row.quantity,
    unitPrice: Number(row.unit_price ?? 0),
    note: row.note,
    toppings: (row.toppings ?? []) as ToppingAttachment[],
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

// ── Queries ──

/**
 * Get kitchen orders for a branch, filtered by statuses.
 * Used by both POS (current orders) and KDS (active orders).
 */
export async function getKitchenOrders(
  branchId: string,
  statuses?: KitchenOrderStatus[]
): Promise<KitchenOrder[]> {
  const supabase = getClient();

  let query = supabase
    .from("kitchen_orders")
    .select("*, restaurant_tables(name), profiles!kitchen_orders_created_by_fkey(full_name)")
    .eq("branch_id", branchId)
    .order("created_at", { ascending: true });

  if (statuses && statuses.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query = query.in("status", statuses as any);
  }

  const { data, error } = await query;
  if (error) handleError(error, "getKitchenOrders");
  return (data ?? []).map(mapKitchenOrder);
}

/**
 * Get a single kitchen order with its items.
 */
export async function getKitchenOrderById(orderId: string): Promise<KitchenOrder & { items: KitchenOrderItem[] }> {
  const supabase = getClient();

  const { data: order, error: orderErr } = await supabase
    .from("kitchen_orders")
    .select("*, restaurant_tables(name), profiles!kitchen_orders_created_by_fkey(full_name)")
    .eq("id", orderId)
    .single();

  if (orderErr) handleError(orderErr, "getKitchenOrderById");
  if (!order) throw new Error("Không tìm thấy đơn bếp");

  const { data: items, error: itemsErr } = await supabase
    .from("kitchen_order_items")
    .select("*")
    .eq("kitchen_order_id", orderId)
    .order("id", { ascending: true });

  if (itemsErr) handleError(itemsErr, "getKitchenOrderById:items");

  return {
    ...mapKitchenOrder(order),
    items: (items ?? []).map(mapKitchenItem),
  };
}

// ── Mutations ──

export interface CreateKitchenOrderInput {
  tenantId: string;
  branchId: string;
  createdBy: string;
  tableId?: string;
  orderType: "dine_in" | "takeaway" | "delivery";
  note?: string;
  items: {
    productId: string;
    productName: string;
    variantId?: string;
    variantLabel?: string;
    quantity: number;
    unitPrice: number;
    note?: string;
    toppings?: ToppingAttachment[];
  }[];
}

/**
 * Create a kitchen order + items. Does NOT create invoice or affect stock.
 * Returns the created order with its generated order_number.
 */
export async function createKitchenOrder(
  input: CreateKitchenOrderInput,
  orderNumber: string
): Promise<KitchenOrder> {
  const supabase = getClient();

  const orderData: KOInsert = {
    tenant_id: input.tenantId,
    branch_id: input.branchId,
    table_id: input.tableId ?? null,
    order_number: orderNumber,
    order_type: input.orderType,
    note: input.note ?? null,
    created_by: input.createdBy,
  };

  const { data: order, error: orderErr } = await supabase
    .from("kitchen_orders")
    .insert(orderData)
    .select()
    .single();

  if (orderErr) handleError(orderErr, "createKitchenOrder");
  if (!order) throw new Error("Không tạo được đơn bếp");

  // Insert items
  const itemsData: KOItemInsert[] = input.items.map((item) => ({
    kitchen_order_id: order.id,
    product_id: item.productId,
    product_name: item.productName,
    variant_id: item.variantId ?? null,
    variant_label: item.variantLabel ?? null,
    quantity: item.quantity,
    unit_price: item.unitPrice,
    note: item.note ?? null,
    toppings: item.toppings ?? null,
  }));

  const { error: itemsErr } = await supabase
    .from("kitchen_order_items")
    .insert(itemsData);

  if (itemsErr) handleError(itemsErr, "createKitchenOrder:items");

  return mapKitchenOrder(order);
}

/**
 * Add items to an existing kitchen order (bổ sung món).
 */
export async function addItemsToOrder(
  orderId: string,
  items: {
    productId: string;
    productName: string;
    variantId?: string;
    variantLabel?: string;
    quantity: number;
    unitPrice: number;
    note?: string;
    toppings?: ToppingAttachment[];
  }[]
): Promise<void> {
  const supabase = getClient();

  const itemsData: KOItemInsert[] = items.map((item) => ({
    kitchen_order_id: orderId,
    product_id: item.productId,
    product_name: item.productName,
    variant_id: item.variantId ?? null,
    variant_label: item.variantLabel ?? null,
    quantity: item.quantity,
    unit_price: item.unitPrice,
    note: item.note ?? null,
    toppings: item.toppings ?? null,
  }));

  const { error } = await supabase
    .from("kitchen_order_items")
    .insert(itemsData);

  if (error) handleError(error, "addItemsToOrder");
}

/**
 * Update kitchen order status.
 */
export async function updateKitchenOrderStatus(
  orderId: string,
  newStatus: KitchenOrderStatus
): Promise<void> {
  const supabase = getClient();

  const { error } = await supabase
    .from("kitchen_orders")
    .update({ status: newStatus })
    .eq("id", orderId);

  if (error) handleError(error, "updateKitchenOrderStatus");
}

/**
 * Update kitchen item status (for KDS: pending → preparing → ready).
 */
export async function updateKitchenItemStatus(
  itemId: string,
  newStatus: KitchenItemStatus
): Promise<void> {
  const supabase = getClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update: Record<string, any> = { status: newStatus };
  if (newStatus === "preparing") update.started_at = new Date().toISOString();
  if (newStatus === "ready") update.completed_at = new Date().toISOString();

  const { error } = await supabase
    .from("kitchen_order_items")
    .update(update)
    .eq("id", itemId);

  if (error) handleError(error, "updateKitchenItemStatus");
}

/**
 * Link invoice to kitchen order (after payment).
 */
export async function linkInvoiceToOrder(
  orderId: string,
  invoiceId: string
): Promise<void> {
  const supabase = getClient();

  const { error } = await supabase
    .from("kitchen_orders")
    .update({ invoice_id: invoiceId, status: "completed" as const })
    .eq("id", orderId);

  if (error) handleError(error, "linkInvoiceToOrder");
}

// ============================================================
// Sửa đơn (Modify order after kitchen send)
// ============================================================

/**
 * Update item quantity on an open kitchen order.
 * If newQty <= 0, removes the item entirely.
 */
export async function updateOrderItemQty(
  itemId: string,
  newQty: number
): Promise<void> {
  const supabase = getClient();

  if (newQty <= 0) {
    await removeOrderItem(itemId);
    return;
  }

  const { error } = await supabase
    .from("kitchen_order_items")
    .update({ quantity: newQty })
    .eq("id", itemId);

  if (error) handleError(error, "updateOrderItemQty");
}

/**
 * Remove an item from a kitchen order.
 */
export async function removeOrderItem(itemId: string): Promise<void> {
  const supabase = getClient();

  const { error } = await supabase
    .from("kitchen_order_items")
    .delete()
    .eq("id", itemId);

  if (error) handleError(error, "removeOrderItem");
}

// ============================================================
// Huỷ đơn (Cancel order)
// ============================================================

/**
 * Cancel a kitchen order. Releases table if dine_in.
 * Cannot cancel completed/already-cancelled orders.
 */
export async function cancelKitchenOrder(orderId: string): Promise<void> {
  const supabase = getClient();

  // Load order to check status + get table_id
  const { data: order, error: fetchErr } = await supabase
    .from("kitchen_orders")
    .select("id, status, table_id")
    .eq("id", orderId)
    .single();

  if (fetchErr) handleError(fetchErr, "cancelKitchenOrder:fetch");
  if (!order) throw new Error("Không tìm thấy đơn bếp");

  if (order.status === "completed") {
    throw new Error("Đơn đã thanh toán, không thể huỷ. Hãy dùng chức năng hoàn trả.");
  }
  if (order.status === "cancelled") {
    throw new Error("Đơn đã huỷ trước đó.");
  }

  // Cancel the order
  const { error: updateErr } = await supabase
    .from("kitchen_orders")
    .update({ status: "cancelled" as const })
    .eq("id", orderId);

  if (updateErr) handleError(updateErr, "cancelKitchenOrder:update");

  // Release table if occupied
  if (order.table_id) {
    const { error: tableErr } = await supabase
      .from("restaurant_tables")
      .update({ status: "available" as const, current_order_id: null })
      .eq("id", order.table_id)
      .eq("current_order_id", orderId);

    if (tableErr) handleError(tableErr, "cancelKitchenOrder:releaseTable");
  }
}

// ============================================================
// Chuyển bàn (Transfer table)
// ============================================================

/**
 * Move a kitchen order from one table to another.
 * Releases source table, claims destination table.
 */
export async function transferTable(
  orderId: string,
  fromTableId: string,
  toTableId: string
): Promise<void> {
  const supabase = getClient();

  // 1. Claim new table (atomic: only if available)
  const { data: claimed, error: claimErr } = await supabase
    .from("restaurant_tables")
    .update({ status: "occupied" as const, current_order_id: orderId })
    .eq("id", toTableId)
    .eq("status", "available")
    .select()
    .maybeSingle();

  if (claimErr) handleError(claimErr, "transferTable:claim");
  if (!claimed) throw new Error("Bàn đích không trống hoặc không tồn tại.");

  // 2. Release old table
  const { error: releaseErr } = await supabase
    .from("restaurant_tables")
    .update({ status: "available" as const, current_order_id: null })
    .eq("id", fromTableId)
    .eq("current_order_id", orderId);

  if (releaseErr) handleError(releaseErr, "transferTable:release");

  // 3. Update kitchen_order table_id + store original for audit
  const { error: orderErr } = await supabase
    .from("kitchen_orders")
    .update({ table_id: toTableId, original_table_id: fromTableId })
    .eq("id", orderId);

  if (orderErr) handleError(orderErr, "transferTable:order");
}

// ============================================================
// Gộp đơn (Merge orders)
// ============================================================

/**
 * Merge source orders into target order.
 * Moves all items from source orders to target, marks sources as cancelled.
 * All orders must belong to same branch.
 */
export async function mergeKitchenOrders(
  targetOrderId: string,
  sourceOrderIds: string[]
): Promise<void> {
  const supabase = getClient();

  for (const sourceId of sourceOrderIds) {
    // 1. Move items: update kitchen_order_id to target
    const { error: moveErr } = await supabase
      .from("kitchen_order_items")
      .update({ kitchen_order_id: targetOrderId })
      .eq("kitchen_order_id", sourceId);

    if (moveErr) handleError(moveErr, `mergeKitchenOrders:moveItems:${sourceId}`);

    // 2. Mark source as cancelled + set merged_into_id
    const { error: cancelErr } = await supabase
      .from("kitchen_orders")
      .update({
        status: "cancelled" as const,
        merged_into_id: targetOrderId,
      })
      .eq("id", sourceId);

    if (cancelErr) handleError(cancelErr, `mergeKitchenOrders:cancel:${sourceId}`);

    // 3. Release source table if any
    const { data: srcOrder } = await supabase
      .from("kitchen_orders")
      .select("table_id")
      .eq("id", sourceId)
      .single();

    if (srcOrder?.table_id) {
      await supabase
        .from("restaurant_tables")
        .update({ status: "available" as const, current_order_id: null })
        .eq("id", srcOrder.table_id)
        .eq("current_order_id", sourceId);
    }
  }
}

// ============================================================
// Giảm giá / Chiết khấu (Discount)
// ============================================================

/**
 * Apply discount to a kitchen order (before payment).
 * @param discountType - 'fixed' (VND amount) or 'percent' (% of subtotal)
 * @param discountValue - amount or percentage
 * @param reason - why discount was applied
 */
export async function applyOrderDiscount(
  orderId: string,
  discountType: "fixed" | "percent",
  discountValue: number,
  reason?: string
): Promise<{ discountAmount: number }> {
  const supabase = getClient();

  // If percent, calculate amount from order items
  let discountAmount = discountValue;
  if (discountType === "percent") {
    const order = await getKitchenOrderById(orderId);
    const subtotal = order.items.reduce((sum, item) => {
      const itemTotal = item.unitPrice * item.quantity;
      const toppingTotal = item.toppings.reduce(
        (s, t) => s + t.price * t.quantity * item.quantity, 0
      );
      return sum + itemTotal + toppingTotal;
    }, 0);
    discountAmount = Math.round(subtotal * discountValue / 100);
  }

  const { error } = await supabase
    .from("kitchen_orders")
    .update({
      discount_amount: discountAmount,
      discount_reason: reason ?? null,
    })
    .eq("id", orderId);

  if (error) handleError(error, "applyOrderDiscount");
  return { discountAmount };
}

// ============================================================
// Delivery Platform (Shopee Food, Grab, etc.)
// ============================================================

/**
 * Set delivery platform info on a kitchen order.
 */
export async function setDeliveryPlatform(
  orderId: string,
  platform: DeliveryPlatform,
  deliveryFee: number,
  platformCommission: number
): Promise<void> {
  const supabase = getClient();

  const { error } = await supabase
    .from("kitchen_orders")
    .update({
      delivery_platform: platform,
      delivery_fee: deliveryFee,
      platform_commission: platformCommission,
    })
    .eq("id", orderId);

  if (error) handleError(error, "setDeliveryPlatform");
}
