/**
 * Supabase service: Purchase Orders (Đặt hàng / Nhập hàng)
 *
 * State machine — khớp DB enum (draft, ordered, partial, completed, cancelled).
 *
 * Stock effects:
 *   - draft/ordered/partial/cancelled → NO stock change (informational statuses)
 *   - ordered|partial → completed  → `receivePurchaseOrder` hoặc
 *     `receivePurchaseOrderPartial` đều gọi RPC
 *     `receive_purchase_items_atomic` bọc toàn bộ side-effect trong 1
 *     Postgres transaction (K2 hardening): stock_movements +
 *     increment_product_stock + upsert_branch_stock + product_lots +
 *     received_quantity + status + input_invoice. Rollback all-or-nothing.
 */

import type {
  PurchaseOrder,
  PurchaseOrderStatus,
  QueryParams,
  QueryResult,
} from "@/lib/types";
import {
  getClient,
  getCurrentContext,
  getCurrentTenantId,
  getPaginationRange,
  handleError,
} from "./base";

/* ------------------------------------------------------------------ */
/*  RPC response shape (receive_purchase_items_atomic)                 */
/* ------------------------------------------------------------------ */

interface ReceivePurchaseItemsRpcResponse {
  new_status: PurchaseOrderStatus;
  received_lines: number;
  received_qty_total: number;
  input_invoice_id: string | null;
  input_invoice_code: string | null;
}

/* ------------------------------------------------------------------ */
/*  State machine                                                      */
/* ------------------------------------------------------------------ */

const VALID_PURCHASE_TRANSITIONS: Record<PurchaseOrderStatus, PurchaseOrderStatus[]> = {
  draft: ["ordered", "cancelled"],
  ordered: ["partial", "completed", "cancelled"],
  partial: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function canTransitionPurchaseStatus(from: string, to: string): boolean {
  const allowed = VALID_PURCHASE_TRANSITIONS[from as PurchaseOrderStatus];
  if (!allowed) return false;
  return allowed.includes(to as PurchaseOrderStatus);
}

export function getPurchaseOrderStatusMeta(): Record<
  PurchaseOrderStatus,
  { label: string; color: string }
> {
  return {
    draft: { label: "Phiếu tạm", color: "#94a3b8" },
    ordered: { label: "Đã đặt hàng", color: "#004AC6" },
    partial: { label: "Nhập một phần", color: "#f59e0b" },
    completed: { label: "Hoàn thành", color: "#10b981" },
    cancelled: { label: "Đã hủy", color: "#ef4444" },
  };
}

/* ------------------------------------------------------------------ */
/*  Queries                                                            */
/* ------------------------------------------------------------------ */

export async function getPurchaseOrders(
  params: QueryParams
): Promise<QueryResult<PurchaseOrder>> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const { from, to } = getPaginationRange(params);

  let query = supabase
    .from("purchase_orders")
    .select("*, profiles!purchase_orders_created_by_fkey(full_name)", { count: "exact" })
    .eq("tenant_id", tenantId);

  if (params.search) {
    query = query.or(
      `code.ilike.%${params.search}%,supplier_name.ilike.%${params.search}%`
    );
  }

  const statusFilter = params.filters?.status;
  if (Array.isArray(statusFilter) && statusFilter.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query = query.in("status", statusFilter as any);
  } else if (typeof statusFilter === "string" && statusFilter !== "all") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query = query.eq("status", statusFilter as any);
  }

  if (params.filters?.supplier && params.filters.supplier !== "all") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query = query.eq("supplier_name", params.filters.supplier as any);
  }

  // Filter: branch
  if (params.branchId) {
    query = query.eq("branch_id", params.branchId);
  }

  query = query.order("created_at", { ascending: false }).range(from, to);

  const { data, count, error } = await query;
  if (error) handleError(error, "getPurchaseOrders");

  const orders: PurchaseOrder[] = (data ?? []).map(mapPurchaseOrder);
  return { data: orders, total: count ?? 0 };
}

export function getPurchaseOrderStatuses() {
  const meta = getPurchaseOrderStatusMeta();
  return (Object.keys(meta) as PurchaseOrderStatus[]).map((value) => ({
    label: meta[value].label,
    value,
    count: 0,
  }));
}

/**
 * Lấy lịch sử đặt/nhập hàng từ 1 nhà cung cấp cụ thể (dùng trong tab chi tiết NCC).
 */
export async function getPurchaseOrdersForSupplier(
  supplierId: string,
  limit: number = 50
): Promise<PurchaseOrder[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const { data, error } = await supabase
    .from("purchase_orders")
    .select("*, profiles!purchase_orders_created_by_fkey(full_name)")
    .eq("tenant_id", tenantId)
    .eq("supplier_id", supplierId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) handleError(error, "getPurchaseOrdersForSupplier");
  return (data ?? []).map(mapPurchaseOrder);
}

/* ------------------------------------------------------------------ */
/*  Item loader (for detail panel + partial receive)                   */
/* ------------------------------------------------------------------ */

export interface PurchaseOrderItemRow {
  id: string;
  productId: string | null;
  productCode: string;
  productName: string;
  unit: string;
  quantity: number;
  receivedQuantity: number;
  remaining: number;
  unitPrice: number;
  lineTotal: number;
}

export async function getPurchaseOrderItems(
  orderId: string,
): Promise<PurchaseOrderItemRow[]> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("purchase_order_items")
    .select(
      "id, product_id, product_name, quantity, received_quantity, unit_price, unit, products(code)",
    )
    .eq("purchase_order_id", orderId)
    .order("id", { ascending: true });

  if (error) handleError(error, "getPurchaseOrderItems");

  return ((data ?? []) as unknown as Array<{
    id: string;
    product_id: string | null;
    product_name: string;
    quantity: number | string;
    received_quantity: number | string;
    unit_price: number | string;
    unit: string | null;
    products: { code: string } | null;
  }>).map((row) => {
    const qty = Number(row.quantity ?? 0);
    const received = Number(row.received_quantity ?? 0);
    const price = Number(row.unit_price ?? 0);
    return {
      id: row.id,
      productId: row.product_id,
      productCode: row.products?.code ?? "",
      productName: row.product_name ?? "",
      unit: row.unit ?? "cái",
      quantity: qty,
      receivedQuantity: received,
      remaining: Math.max(0, qty - received),
      unitPrice: price,
      lineTotal: qty * price,
    };
  });
}

/* ------------------------------------------------------------------ */
/*  Partial receive — nhập một phần với số lượng tuỳ chỉnh per-line     */
/* ------------------------------------------------------------------ */

export interface PartialReceiveLine {
  itemId: string;
  receiveQty: number; // 0 = skip, > remaining = clamped
}

/**
 * Nhập một phần: gọi RPC `receive_purchase_items_atomic` để bọc toàn bộ
 * side-effect trong 1 Postgres transaction:
 *   - stock_movements + increment_product_stock + upsert_branch_stock
 *   - product_lots (FIFO)
 *   - update received_quantity per line
 *   - cập nhật purchase_orders.status = 'partial' hoặc 'completed'
 *   - tự động tạo input_invoice nếu đơn vừa hoàn thành
 *
 * Nếu mạng rớt giữa chừng → Postgres rollback toàn bộ → zero orphan state.
 */
export async function receivePurchaseOrderPartial(
  orderId: string,
  lines: PartialReceiveLine[],
): Promise<{ newStatus: PurchaseOrderStatus; receivedLines: number }> {
  const supabase = getClient();
  if (!lines || lines.length === 0) {
    throw new Error("Không có dòng nào để nhập");
  }

  const ctx = await getCurrentContext();
  const payload = lines
    .filter((l) => Number(l.receiveQty) > 0)
    .map((l) => ({ item_id: l.itemId, receive_qty: Number(l.receiveQty) }));

  if (payload.length === 0) {
    throw new Error("Không có dòng nào để nhập");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "receive_purchase_items_atomic",
    {
      p_order_id: orderId,
      p_lines: payload,
      p_created_by: ctx.userId,
    },
  );
  if (error) handleError(error, "receivePurchaseOrderPartial");

  const res = data as ReceivePurchaseItemsRpcResponse | null;
  if (!res || !res.new_status) {
    throw new Error("RPC receive_purchase_items_atomic không trả về kết quả");
  }

  return {
    newStatus: res.new_status,
    receivedLines: Number(res.received_lines ?? 0),
  };
}

/* ------------------------------------------------------------------ */
/*  Mutations                                                          */
/* ------------------------------------------------------------------ */

export async function updatePurchaseOrderStatus(
  orderId: string,
  newStatus: PurchaseOrderStatus
): Promise<void> {
  // "completed" transitions are special: they commit real inventory, so we
  // route them through `receivePurchaseOrder` instead of a plain status flip.
  // This keeps all callers (Kanban drag, row action menu) safe by default.
  if (newStatus === "completed") {
    await receivePurchaseOrder(orderId);
    return;
  }

  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  const { data: current, error: readErr } = await supabase
    .from("purchase_orders")
    .select("status")
    .eq("tenant_id", tenantId)
    .eq("id", orderId)
    .single();

  if (readErr) handleError(readErr, "updatePurchaseOrderStatus.read");
  if (!current) throw new Error("Không tìm thấy đơn nhập hàng");

  const fromStatus = current.status as PurchaseOrderStatus;
  if (!canTransitionPurchaseStatus(fromStatus, newStatus)) {
    throw new Error(
      `Không thể chuyển từ "${fromStatus}" sang "${newStatus}"`
    );
  }

  const { error: updateErr } = await supabase
    .from("purchase_orders")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({ status: newStatus as any })
    .eq("tenant_id", tenantId)
    .eq("id", orderId);

  if (updateErr) handleError(updateErr, "updatePurchaseOrderStatus.update");
}

/* ------------------------------------------------------------------ */
/*  Receive (G6 fix) — commits real inventory                          */
/* ------------------------------------------------------------------ */

/**
 * Mark a purchase order as fully received — delegates to RPC
 * `receive_purchase_items_atomic` với `p_lines = null` để nhận toàn bộ
 * remaining quantity của tất cả line.
 *
 * RPC bọc tất cả trong 1 Postgres transaction:
 *   - stock_movements + increment_product_stock + upsert_branch_stock
 *   - product_lots (FIFO)
 *   - update received_quantity
 *   - purchase_orders.status = 'completed' (với guard ordered/partial)
 *   - input_invoice (tạo tự động)
 *
 * Nếu mạng/DB fail ở bất kỳ bước nào → rollback toàn bộ → zero orphan.
 */
export async function receivePurchaseOrder(orderId: string): Promise<void> {
  const supabase = getClient();
  const ctx = await getCurrentContext();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "receive_purchase_items_atomic",
    {
      p_order_id: orderId,
      p_lines: null, // null = "nhận toàn bộ remaining"
      p_created_by: ctx.userId,
    },
  );
  if (error) handleError(error, "receivePurchaseOrder");

  const res = data as ReceivePurchaseItemsRpcResponse | null;
  if (!res || !res.new_status) {
    throw new Error("RPC receive_purchase_items_atomic không trả về kết quả");
  }
}

/* ------------------------------------------------------------------ */
/*  Mapper                                                             */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapPurchaseOrder(row: any): PurchaseOrder {
  const profile = row.profiles as { full_name: string } | null;
  return {
    id: row.id,
    code: row.code,
    date: row.created_at,
    supplierId: row.supplier_id,
    supplierCode: "",
    supplierName: row.supplier_name,
    amountOwed: Number(row.debt ?? 0),
    taxAmount: Number(row.tax_amount ?? 0),
    total: Number(row.total ?? 0),
    paid: Number(row.paid ?? 0),
    status: (row.status ?? "draft") as PurchaseOrderStatus,
    createdBy: row.created_by ?? "",
    createdByName: profile?.full_name ?? "",
  };
}
