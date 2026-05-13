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
import { getClient, handleError, getCurrentTenantId } from "./base";
import { recordAuditLog } from "./audit";
import { getStationsByProductIds } from "./kitchen-stations";
import { isRpcUnavailable } from "./rpc-utils";

type KOInsert = Database["public"]["Tables"]["kitchen_orders"]["Insert"];
type KOItemInsert = Database["public"]["Tables"]["kitchen_order_items"]["Insert"];

const KITCHEN_ORDER_SELECT =
  "*, restaurant_tables!kitchen_orders_table_id_fkey(name), profiles!kitchen_orders_created_by_fkey(full_name)";

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
    // Migration 00070: tách commission_percent / commission_amount
    platformCommissionPercent: Number(row.platform_commission_percent ?? 0),
    platformCommissionAmount: Number(row.platform_commission_amount ?? 0),
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
    // Sprint KITCHEN-1: station routing — null nếu legacy single-queue mode.
    kitchenStationId: (row.kitchen_station_id as string | null) ?? null,
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
  const tenantId = await getCurrentTenantId();

  let query = supabase
    .from("kitchen_orders")
    .select(KITCHEN_ORDER_SELECT)
    .eq("tenant_id", tenantId)
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
  const tenantId = await getCurrentTenantId();

  const { data: order, error: orderErr } = await supabase
    .from("kitchen_orders")
    .select(KITCHEN_ORDER_SELECT)
    .eq("tenant_id", tenantId)
    .eq("id", orderId)
    .single();

  if (orderErr) handleError(orderErr, "getKitchenOrderById");
  if (!order) throw new Error("Không tìm thấy đơn bếp");

  // items scope qua kitchen_order_id (đã verify ownership ở step trên)
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

/**
 * Get kitchen orders and all child items in two queries.
 *
 * KDS calls this on polling + realtime refresh. Keeping it bulked avoids the
 * old N+1 pattern where every active order triggered another network request.
 */
export async function getKitchenOrdersWithItems(
  branchId: string,
  statuses?: KitchenOrderStatus[],
): Promise<(KitchenOrder & { items: KitchenOrderItem[] })[]> {
  const supabase = getClient();
  const orders = await getKitchenOrders(branchId, statuses);
  if (orders.length === 0) return [];

  const orderIds = orders.map((order) => order.id);
  const { data: items, error } = await supabase
    .from("kitchen_order_items")
    .select("*")
    .in("kitchen_order_id", orderIds)
    .order("id", { ascending: true });

  if (error) handleError(error, "getKitchenOrdersWithItems:items");

  const itemsByOrder = new Map<string, KitchenOrderItem[]>();
  for (const row of items ?? []) {
    const item = mapKitchenItem(row);
    const bucket = itemsByOrder.get(item.kitchenOrderId) ?? [];
    bucket.push(item);
    itemsByOrder.set(item.kitchenOrderId, bucket);
  }

  return orders.map((order) => ({
    ...order,
    items: itemsByOrder.get(order.id) ?? [],
  }));
}

// ── Mutations ──

export interface CreateKitchenOrderInput {
  tenantId: string;
  branchId: string;
  createdBy: string;
  tableId?: string;
  orderType: "dine_in" | "takeaway" | "delivery";
  note?: string;
  /**
   * Idempotency key — Sprint FIX-1 (CEO 07/05). Khi pass, server check
   * existing trước, nếu đã có thì return existing thay vì insert mới
   * → chống duplicate khi offline retry.
   * Client gen UUID hoặc dùng localId từ offline queue.
   */
  idempotencyKey?: string;
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

  // Sprint FIX-1: Idempotency check — nếu client truyền key + đã có order
  // với key đó → return existing (chống duplicate khi offline retry).
  if (input.idempotencyKey) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing } = await (supabase as any)
      .from("kitchen_orders")
      .select(KITCHEN_ORDER_SELECT)
      .eq("tenant_id", input.tenantId)
      .eq("idempotency_key", input.idempotencyKey)
      .maybeSingle();
    if (existing) {
      // Đã insert lần trước — không tạo mới + KHÔNG insert items (đã có).
      return mapKitchenOrder(existing);
    }
  }

  const orderData: KOInsert & { idempotency_key?: string } = {
    tenant_id: input.tenantId,
    branch_id: input.branchId,
    table_id: input.tableId ?? null,
    order_number: orderNumber,
    order_type: input.orderType,
    note: input.note ?? null,
    created_by: input.createdBy,
    ...(input.idempotencyKey ? { idempotency_key: input.idempotencyKey } : {}),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: order, error: orderErr } = await (supabase as any)
    .from("kitchen_orders")
    .insert(orderData)
    .select()
    .single();

  if (orderErr) {
    // Race condition: 2 retry concurrent → unique constraint violation.
    // Re-query existing và return — vẫn idempotent.
    if (
      input.idempotencyKey &&
      typeof orderErr === "object" &&
      orderErr !== null &&
      "code" in orderErr &&
      (orderErr as { code: string }).code === "23505" // unique_violation
    ) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: race } = await (supabase as any)
        .from("kitchen_orders")
        .select(KITCHEN_ORDER_SELECT)
        .eq("tenant_id", input.tenantId)
        .eq("idempotency_key", input.idempotencyKey)
        .maybeSingle();
      if (race) return mapKitchenOrder(race);
    }
    handleError(orderErr, "createKitchenOrder");
  }
  if (!order) throw new Error("Không tạo được đơn bếp");

  // Sprint KITCHEN-1: Auto-fill station_id cho mỗi item bằng cách lookup
  // product → category → kitchen_station_id. Bulk query 1 lần cho hiệu quả.
  // Items không tìm được station → null (legacy single-queue mode).
  const productIds = Array.from(new Set(input.items.map((i) => i.productId)));
  const stationMap = await getStationsByProductIds(productIds).catch(
    () => new Map<string, string | null>(),
  );

  // Insert items với kitchen_station_id auto-filled
  const itemsData: (KOItemInsert & { kitchen_station_id?: string | null })[] =
    input.items.map((item) => ({
      kitchen_order_id: order.id,
      product_id: item.productId,
      product_name: item.productName,
      variant_id: item.variantId ?? null,
      variant_label: item.variantLabel ?? null,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      note: item.note ?? null,
      toppings: item.toppings ?? null,
      kitchen_station_id: stationMap.get(item.productId) ?? null,
    }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: itemsErr } = await (supabase as any)
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

  // Sprint KITCHEN-1: Auto-fill station_id cho items bổ sung (cùng logic).
  const productIds = Array.from(new Set(items.map((i) => i.productId)));
  const stationMap = await getStationsByProductIds(productIds).catch(
    () => new Map<string, string | null>(),
  );

  const itemsData: (KOItemInsert & { kitchen_station_id?: string | null })[] =
    items.map((item) => ({
      kitchen_order_id: orderId,
      product_id: item.productId,
      product_name: item.productName,
      variant_id: item.variantId ?? null,
      variant_label: item.variantLabel ?? null,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      note: item.note ?? null,
      toppings: item.toppings ?? null,
      kitchen_station_id: stationMap.get(item.productId) ?? null,
    }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
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
  const tenantId = await getCurrentTenantId();

  const { error } = await supabase
    .from("kitchen_orders")
    .update({ status: newStatus })
    .eq("tenant_id", tenantId)
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
  const tenantId = await getCurrentTenantId();

  const { error } = await supabase
    .from("kitchen_orders")
    .update({ invoice_id: invoiceId, status: "completed" as const })
    .eq("tenant_id", tenantId)
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
 *
 * @param orderId — kitchen_orders.id
 * @param reason — lý do bắt buộc cho audit (vd "khách đổi ý", "hết NL").
 *   Lưu vào `note` (append "[Hủy: <reason>]") + audit log để loss prevention.
 */
export async function cancelKitchenOrder(
  orderId: string,
  reason?: string,
): Promise<void> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // Load order to check status + get table_id + existing note
  const { data: order, error: fetchErr } = await supabase
    .from("kitchen_orders")
    .select("id, status, table_id, note")
    .eq("tenant_id", tenantId)
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

  // Append cancel reason vào note để hiện ở report sau này.
  const reasonTag = reason?.trim() ? ` [Hủy: ${reason.trim()}]` : "";
  const newNote = (order.note ?? "") + reasonTag;

  // Cancel the order
  const { error: updateErr } = await supabase
    .from("kitchen_orders")
    .update({ status: "cancelled" as const, note: newNote })
    .eq("tenant_id", tenantId)
    .eq("id", orderId);

  if (updateErr) handleError(updateErr, "cancelKitchenOrder:update");

  // Audit log để báo cáo loss prevention.
  void recordAuditLog({
    entityType: "kitchen_order",
    entityId: orderId,
    action: "cancel",
    newData: { reason: reason ?? null, releasedTable: !!order.table_id },
  });

  // Release table if occupied
  if (order.table_id) {
    const { error: tableErr } = await supabase
      .from("restaurant_tables")
      .update({ status: "available" as const, current_order_id: null })
      .eq("tenant_id", tenantId)
      .eq("id", order.table_id)
      .eq("current_order_id", orderId);

    if (tableErr) handleError(tableErr, "cancelKitchenOrder:releaseTable");
  }
}

export interface CancelUnpaidKitchenOrderInput {
  orderId: string;
  reasonCode: string;
  reasonNote?: string;
  shiftId?: string | null;
  /**
   * Phase 3a (CEO 12/05): nếu cashier không có quyền pos_fnb.cancel_unpaid_order,
   * verify OTP từ manager trước (`verifyAndUseManagerOtp`) rồi pass otpId xuống
   * service. Server kiểm OTP used_at < 60s + action_code match + used_by = current
   * user → cho phép thực thi với permission của OTP issuer.
   */
  otpId?: string;
}

/**
 * Secure cancel for a sent-but-unpaid F&B order.
 *
 * This path is intentionally RPC-only: the database verifies the current user
 * has a manager-level cancel permission and writes a POS exception event in the
 * same transaction as the order/table update.
 */
export async function cancelUnpaidKitchenOrder(
  input: CancelUnpaidKitchenOrderInput,
): Promise<void> {
  const supabase = getClient();
  const reasonCode = input.reasonCode.trim();
  const reasonNote = input.reasonNote?.trim();

  if (!reasonCode) {
    throw new Error("Vui lòng chọn lý do hủy đơn.");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "fnb_cancel_unpaid_order_atomic",
    {
      p_order_id: input.orderId,
      p_reason_code: reasonCode,
      p_reason_note: reasonNote || null,
      p_shift_id: input.shiftId ?? null,
      p_otp_id: input.otpId ?? null,
    },
  );

  if (error) {
    if (isRpcUnavailable(error)) {
      throw new Error("Chưa có RPC fnb_cancel_unpaid_order_atomic. Vui lòng chạy migration kiểm soát hủy bill FnB trước.");
    }
    handleError(error, "cancelUnpaidKitchenOrder:atomic_rpc");
  }

  if (!data || (typeof data === "object" && "success" in data && !data.success)) {
    throw new Error("Server không trả kết quả hủy đơn hợp lệ.");
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
  const tenantId = await getCurrentTenantId();

  // Server-side transaction only. Table transfer must fail closed if the RPC is
  // missing; the legacy multi-step flow can leave table/order state split.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: atomicData, error: atomicError } = await (supabase.rpc as any)(
    "fnb_transfer_table_atomic",
    {
      p_tenant_id: tenantId,
      p_order_id: orderId,
      p_from_table_id: fromTableId,
      p_to_table_id: toTableId,
    },
  );

  if (!atomicError && (atomicData as { success?: boolean } | null)?.success) {
    return;
  }
  if (atomicError) {
    if (isRpcUnavailable(atomicError)) {
      throw new Error("Chưa có RPC fnb_transfer_table_atomic. Vui lòng chạy migration POS/FnB atomic trước khi chuyển bàn.");
    }
    handleError(atomicError, "transferTable:atomic_rpc");
  }

  throw new Error("Server không trả kết quả chuyển bàn hợp lệ.");
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
  const tenantId = await getCurrentTenantId();

  for (const sourceId of sourceOrderIds) {
    // 1. Move items: update kitchen_order_id to target — scope qua kitchen_order_id (parent đã verify tenant ở step 2)
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
      .eq("tenant_id", tenantId)
      .eq("id", sourceId);

    if (cancelErr) handleError(cancelErr, `mergeKitchenOrders:cancel:${sourceId}`);

    // 3. Release source table if any
    const { data: srcOrder } = await supabase
      .from("kitchen_orders")
      .select("table_id")
      .eq("tenant_id", tenantId)
      .eq("id", sourceId)
      .single();

    if (srcOrder?.table_id) {
      await supabase
        .from("restaurant_tables")
        .update({ status: "available" as const, current_order_id: null })
        .eq("tenant_id", tenantId)
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

  const tenantId = await getCurrentTenantId();
  const { error } = await supabase
    .from("kitchen_orders")
    .update({
      discount_amount: discountAmount,
      discount_reason: reason ?? null,
    })
    .eq("tenant_id", tenantId)
    .eq("id", orderId);

  if (error) handleError(error, "applyOrderDiscount");
  return { discountAmount };
}

// ============================================================
// Delivery Platform (Shopee Food, Grab, etc.)
// ============================================================

/**
 * Set delivery platform info on a kitchen order.
 *
 * Migration 00070 (CEO 13/05): tách commission thành 2 trường:
 *   - platform_commission_percent (%): cashier set, vd 25 = 25%
 *   - platform_commission_amount  (VND): tự tính khi thanh toán
 *     = subtotal × percent / 100
 *
 * Giữ tham số `platformCommissionPercent` ở client. Server tự tính
 * commission_amount khi gọi fnb_complete_payment_atomic.
 */
export async function setDeliveryPlatform(
  orderId: string,
  platform: DeliveryPlatform,
  deliveryFee: number,
  platformCommissionPercent: number
): Promise<void> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  const { error } = await supabase
    .from("kitchen_orders")
    .update({
      delivery_platform: platform,
      delivery_fee: deliveryFee,
      // Migration 00070: lưu vào cột _percent mới. Giữ cột cũ
      // platform_commission = 0 để tránh confuse báo cáo cũ.
      platform_commission_percent: platformCommissionPercent,
      platform_commission: 0,
    })
    .eq("tenant_id", tenantId)
    .eq("id", orderId);

  if (error) handleError(error, "setDeliveryPlatform");
}
