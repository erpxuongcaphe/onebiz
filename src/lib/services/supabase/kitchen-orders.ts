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
    // CEO 01/06/2026 — Sprint 2.4b: snapshot modifier choices.
    // Cột mới từ migration 00122. Null/undefined cho item cũ tạo trước migration.
    modifierSelections: Array.isArray(row.modifier_selections)
      ? row.modifier_selections
      : undefined,
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
    /** CEO 01/06/2026 — Sprint 2.4b: snapshot modifier choices */
    modifierSelections?: import("@/lib/types/fnb").ModifierSelectionPayload[];
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
 *
 * P0-8 fix 12/06/2026: idempotency cho "Gửi thêm". batchId (UUID) generate
 * khi cashier click "Gửi bếp" — tất cả items cùng batch chia sẻ batch_id.
 * UNIQUE INDEX (kitchen_order_id, batch_id) chặn replay → bếp KHÔNG nhận
 * món lặp khi network glitch / offline drain trùng / user F5 mid-flight.
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
    /** CEO 01/06/2026 — Sprint 2.4b */
    modifierSelections?: import("@/lib/types/fnb").ModifierSelectionPayload[];
  }[],
  options?: {
    /** Stable key for one "Gửi thêm" action and its offline retries. */
    batchId?: string;
  },
): Promise<void> {
  const supabase = getClient();
  const batchId = options?.batchId ??
    (typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `batch-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

  // Reuse the same trusted server pipeline as a new kitchen order. The RPC
  // locks the existing order, checks branch/status and registers one batch row
  // before rebuilding product, price, topping and modifier snapshots.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)(
    "fnb_send_to_kitchen_atomic_v2",
    {
      p_branch_id: null,
      p_table_id: null,
      p_order_type: "takeaway",
      p_note: null,
      p_idempotency_key: batchId,
      p_items: items,
      p_delivery_platform: null,
      p_delivery_fee: 0,
      p_platform_commission_percent: null,
      p_delivery_staff_id: null,
      p_delivery_distance_tier: null,
      p_existing_order_id: orderId,
    },
  );

  if (error) {
    if (isRpcUnavailable(error)) {
      throw new Error(
        "Chưa có RPC fnb_send_to_kitchen_atomic_v2. Vui lòng chạy migration POS/FnB atomic trước khi gửi thêm món.",
      );
    }
    handleError(error, "addItemsToOrder:atomic_rpc");
  }
}

/**
 * Update kitchen order status.
 */
export async function updateKitchenOrderStatus(
  orderId: string,
  newStatus: "served"
): Promise<void> {
  const supabase = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)(
    "fnb_update_kitchen_order_status_v2",
    { p_order_id: orderId, p_new_status: newStatus },
  );
  if (error) handleError(error, "updateKitchenOrderStatus:atomic_rpc");
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
  const { error } = await (supabase.rpc as any)(
    "fnb_update_kitchen_item_status_v2",
    { p_item_id: itemId, p_new_status: newStatus },
  );
  if (error) handleError(error, "updateKitchenItemStatus:atomic_rpc");
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
 * F1b 15/08/2026: `cancelKitchenOrder` đã gỡ.
 *
 * Hàm này ghi thẳng `restaurant_tables` để nhả bàn — đường ghi trực tiếp
 * cuối cùng còn sót vào nhóm bảng cấu hình bàn. Nó không còn caller nào và
 * đã bị gỡ khỏi barrel từ PR #217. Xoá hẳn để migration F1b thu hồi quyền
 * ghi thẳng không để lại đoạn mã chết chắc chắn gãy.
 *
 * Huỷ đơn bếp chưa thanh toán dùng `cancelUnpaidKitchenOrder` ngay bên dưới
 * (đi qua RPC, máy chủ kiểm quyền + OTP quản lý).
 */

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

const TRANSFER_TABLE_ERROR_MESSAGES: ReadonlyArray<{
  codes: readonly string[];
  message: string;
}> = [
  { codes: ["FNB_TRANSFER_SAME_TABLE"], message: "Vui lòng chọn một bàn khác." },
  {
    codes: ["FNB_TRANSFER_SOURCE_STALE"],
    message: "Đơn đã chuyển hoặc bàn nguồn vừa thay đổi. Vui lòng tải lại sơ đồ bàn.",
  },
  {
    codes: ["FNB_TRANSFER_DESTINATION_UNAVAILABLE"],
    message: "Bàn đích vừa có khách hoặc không còn trống. Vui lòng chọn bàn khác.",
  },
  {
    codes: ["FNB_TRANSFER_ORDER_NOT_ELIGIBLE"],
    message: "Chỉ chuyển được đơn tại quán chưa thanh toán.",
  },
  {
    codes: ["FNB_TRANSFER_ORDER_NOT_FOUND", "FNB_TRANSFER_TABLE_NOT_FOUND"],
    message: "Không tìm thấy đơn hoặc bàn. Vui lòng tải lại sơ đồ bàn.",
  },
  {
    codes: [
      "FNB_TRANSFER_AUTH_REQUIRED",
      "FNB_TRANSFER_ACTIVE_PROFILE_REQUIRED",
      "FNB_TRANSFER_TENANT_DENIED",
      "FNB_TRANSFER_PERMISSION_REQUIRED",
      "FNB_TRANSFER_BRANCH_DENIED",
      "FNB_TRANSFER_TABLE_SCOPE_DENIED",
    ],
    message: "Anh/chị không có quyền chuyển đơn sang bàn này.",
  },
];

export function getTransferTableErrorMessage(error: unknown): string | null {
  const rawMessage =
    typeof error === "string"
      ? error
      : error && typeof error === "object" && "message" in error
        ? String((error as { message?: unknown }).message ?? "")
        : "";

  for (const item of TRANSFER_TABLE_ERROR_MESSAGES) {
    if (item.codes.some((code) => rawMessage.includes(code))) {
      return item.message;
    }
  }
  return null;
}

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
    const friendlyMessage = getTransferTableErrorMessage(atomicError);
    if (friendlyMessage) throw new Error(friendlyMessage);
    handleError(atomicError, "transferTable:atomic_rpc");
  }

  throw new Error("Server không trả kết quả chuyển bàn hợp lệ.");
}

// ============================================================
// Gộp đơn (Merge orders)
// ============================================================

const MERGE_ORDER_ERROR_MESSAGES: ReadonlyArray<{
  codes: readonly string[];
  message: string;
}> = [
  {
    codes: [
      "FNB_MERGE_SELECTION_REQUIRED",
      "FNB_MERGE_TARGET_IN_SOURCES",
      "FNB_MERGE_DUPLICATE_SOURCE",
    ],
    message: "Vui lòng chọn ít nhất một đơn khác để gộp.",
  },
  {
    codes: ["FNB_MERGE_TARGET_TABLE_STALE", "FNB_MERGE_SOURCE_TABLE_STALE"],
    message: "Bàn hoặc đơn vừa thay đổi. Vui lòng tải lại sơ đồ bàn.",
  },
  {
    codes: ["FNB_MERGE_TARGET_NOT_FOUND"],
    message: "Không tìm thấy đơn nhận. Vui lòng tải lại sơ đồ bàn.",
  },
  {
    codes: [
      "FNB_MERGE_TARGET_NOT_ELIGIBLE",
      "FNB_MERGE_SOURCE_NOT_ELIGIBLE",
      "FNB_MERGE_SOURCE_EMPTY",
    ],
    message: "Chỉ gộp được các đơn tại quán chưa thanh toán và còn món.",
  },
  {
    codes: [
      "FNB_MERGE_AUTH_REQUIRED",
      "FNB_MERGE_ACTIVE_PROFILE_REQUIRED",
      "FNB_MERGE_PERMISSION_REQUIRED",
      "FNB_MERGE_BRANCH_DENIED",
    ],
    message: "Anh/chị không có quyền gộp các đơn này.",
  },
];

export function getMergeOrderErrorMessage(error: unknown): string | null {
  const rawMessage =
    typeof error === "string"
      ? error
      : error && typeof error === "object" && "message" in error
        ? String((error as { message?: unknown }).message ?? "")
        : "";

  for (const item of MERGE_ORDER_ERROR_MESSAGES) {
    if (item.codes.some((code) => rawMessage.includes(code))) {
      return item.message;
    }
  }
  return null;
}

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

  // Browser-side multi-step updates can leave items, orders and table status
  // split when one request fails. Merge therefore fails closed without RPC.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "merge_kitchen_orders_atomic",
    {
      p_target_order_id: targetOrderId,
      p_source_order_ids: sourceOrderIds,
    },
  );

  if (error) {
    if (isRpcUnavailable(error)) {
      throw new Error(
        "Chức năng gộp đơn chưa được cài đặt an toàn. Vui lòng liên hệ quản trị viên.",
      );
    }
    const friendlyMessage = getMergeOrderErrorMessage(error);
    if (friendlyMessage) throw new Error(friendlyMessage);
    handleError(error, "mergeKitchenOrders:atomic_rpc");
  }
  if (!(data as { success?: boolean } | null)?.success) {
    throw new Error("Server không trả kết quả gộp đơn hợp lệ.");
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)(
    "fnb_set_delivery_pricing_v2",
    {
      p_kitchen_order_id: orderId,
      p_platform: platform,
      p_delivery_fee: deliveryFee,
      p_commission_percent: platformCommissionPercent,
      p_distance_tier: null,
    },
  );
  if (error) handleError(error, "setDeliveryPlatform:atomic_rpc");
}

// ============================================================
// Delivery staff tracking (CEO 21/05/2026 — migration 00108)
// ============================================================

/**
 * Gán nhân viên đi giao cho 1 kitchen order. Có thể gọi lúc tạo đơn HOẶC
 * sau khi đơn đã thanh toán (lúc đó RPC sẽ update luôn invoice).
 *
 * RPC `assign_delivery_staff_to_order` (SECURITY DEFINER) đảm bảo:
 *   - Validate đơn tồn tại
 *   - Set delivery_assigned_at = NOW() nếu chưa có
 *   - Update invoice.delivery_staff_id nếu đơn đã thanh toán
 */
export async function assignDeliveryStaff(
  kitchenOrderId: string,
  staffId: string,
): Promise<{ kitchen_order_id: string; delivery_staff_id: string; invoice_updated: boolean }> {
  const supabase = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("assign_delivery_staff_to_order", {
    p_kitchen_order_id: kitchenOrderId,
    p_staff_id: staffId,
  });
  if (error) handleError(error, "assignDeliveryStaff");
  return data as {
    kitchen_order_id: string;
    delivery_staff_id: string;
    invoice_updated: boolean;
  };
}

/**
 * Bỏ gán shipper (set delivery_staff_id = null).
 */
export async function unassignDeliveryStaff(kitchenOrderId: string): Promise<void> {
  const supabase = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)(
    "assign_delivery_staff_to_order",
    { p_kitchen_order_id: kitchenOrderId, p_staff_id: null },
  );
  if (error) handleError(error, "unassignDeliveryStaff:atomic_rpc");
}

/**
 * Đánh dấu shipper đã giao xong → set delivery_completed_at = NOW().
 * Dùng để tính avg time (assigned_at → completed_at) trong báo cáo hiệu suất.
 */
export async function completeDelivery(
  kitchenOrderId: string,
): Promise<{ kitchen_order_id: string; completed_at: string; duration_seconds: number }> {
  const supabase = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("complete_delivery_for_order", {
    p_kitchen_order_id: kitchenOrderId,
  });
  if (error) handleError(error, "completeDelivery");
  return data as {
    kitchen_order_id: string;
    completed_at: string;
    duration_seconds: number;
  };
}

/**
 * Set cấp ngưỡng km cho đơn (đồng thời tính lại delivery_fee từ bảng tiers).
 * Nếu tier = 'custom' → giữ fee hiện tại (cashier nhập tay).
 */
export async function setDeliveryDistanceTier(
  kitchenOrderId: string,
  tier: "near" | "mid" | "far" | "custom",
  customFee?: number,
): Promise<void> {
  const supabase = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: order, error: readError } = await (supabase
    .from("kitchen_orders") as any)
    .select("delivery_platform, delivery_fee, platform_commission_percent")
    .eq("id", kitchenOrderId)
    .maybeSingle();
  if (readError) handleError(readError, "setDeliveryDistanceTier:read_order");
  if (!order) throw new Error("Không tìm thấy đơn giao hàng.");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)(
    "fnb_set_delivery_pricing_v2",
    {
      p_kitchen_order_id: kitchenOrderId,
      p_platform: order.delivery_platform ?? "direct",
      p_delivery_fee:
        tier === "custom"
          ? (customFee ?? Number(order.delivery_fee ?? 0))
          : Number(order.delivery_fee ?? 0),
      p_commission_percent: Number(
        order.platform_commission_percent ?? 0,
      ),
      p_distance_tier: tier,
    },
  );
  if (error) handleError(error, "setDeliveryDistanceTier:atomic_rpc");
}
