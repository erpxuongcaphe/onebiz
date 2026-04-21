/**
 * Supabase service: Shipping Orders & Delivery Partners
 *
 * ShippingStatus khớp với enum DB (shipping_orders.status):
 *   pending → picked_up → in_transit → delivered
 *   ↘ returned (nếu giao thất bại / khách từ chối)
 *   ↘ cancelled (nếu huỷ trước khi lấy)
 */

import type {
  ShippingOrder,
  DeliveryPartner,
  QueryParams,
  QueryResult,
  ShippingStatus,
} from "@/lib/types";
import { getClient, getCurrentContext, getPaginationRange, handleError } from "./base";

// --- Shipping Orders ---

export async function getShippingOrders(params: QueryParams): Promise<QueryResult<ShippingOrder>> {
  const supabase = getClient();
  const { from, to } = getPaginationRange(params);

  let query = supabase
    .from("shipping_orders")
    .select(`
      *,
      invoices!shipping_orders_invoice_id_fkey(code),
      delivery_partners!shipping_orders_partner_id_fkey(name)
    `, { count: "exact" });

  // Search
  if (params.search) {
    query = query.or(`code.ilike.%${params.search}%,receiver_phone.ilike.%${params.search}%`);
  }

  // Filter: status
  if (params.filters?.status && params.filters.status !== "all") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query = query.eq("status", params.filters.status as any);
  }

  // Filter: partner
  if (params.filters?.partner && params.filters.partner !== "all") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query = query.eq("partner_id", params.filters.partner as any);
  }

  // Filter: branch
  if (params.branchId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query = (query as any).eq("branch_id", params.branchId);
  }

  // Sort & paginate
  query = query
    .order("created_at", { ascending: false })
    .range(from, to);

  const { data, count, error } = await query;
  if (error) handleError(error, "getShippingOrders");

  const orders: ShippingOrder[] = (data ?? []).map(mapShippingOrder);
  return { data: orders, total: count ?? 0 };
}

/**
 * Danh sách status filter trong sidebar. Phản ánh đúng lifecycle lẻ của
 * shipping_orders để user có thể filter "Đang giao" tách biệt với
 * "Đang lấy hàng".
 */
export function getShippingStatuses() {
  return [
    { value: "all", label: "Tất cả" },
    { value: "pending", label: "Chờ lấy hàng" },
    { value: "picked_up", label: "Đã lấy hàng" },
    { value: "in_transit", label: "Đang giao" },
    { value: "delivered", label: "Đã giao" },
    { value: "returned", label: "Đã hoàn" },
    { value: "cancelled", label: "Đã hủy" },
  ];
}

// --- Delivery Partners ---

export async function getDeliveryPartners(params: QueryParams): Promise<QueryResult<DeliveryPartner>> {
  const supabase = getClient();
  const { from, to } = getPaginationRange(params);

  let query = supabase
    .from("delivery_partners")
    .select("*", { count: "exact" });

  // Search
  if (params.search) {
    query = query.ilike("name", `%${params.search}%`);
  }

  query = query
    .order("created_at", { ascending: false })
    .range(from, to);

  const { data, count, error } = await query;
  if (error) handleError(error, "getDeliveryPartners");

  const partners: DeliveryPartner[] = (data ?? []).map(mapDeliveryPartner);
  return { data: partners, total: count ?? 0 };
}

/**
 * Get partner options synchronously (static list).
 * For dynamic list, use getPartnerOptionsAsync().
 */
export function getPartnerOptions() {
  // Static fallback - matches mock pattern for sync usage at module level.
  // Pages that need real-time partner list should use getPartnerOptionsAsync().
  return [
    { value: "all", label: "Tất cả" },
  ];
}

/**
 * Get partner options from DB (async).
 */
export async function getPartnerOptionsAsync() {
  const supabase = getClient();

  const { data, error } = await supabase
    .from("delivery_partners")
    .select("id, name")
    .eq("is_active", true)
    .order("name");

  if (error) handleError(error, "getPartnerOptionsAsync");

  return [
    { value: "all", label: "Tất cả" },
    ...(data ?? []).map((p) => ({ value: p.id, label: p.name })),
  ];
}

// --- Status Transitions ---

/**
 * State machine vận đơn. Chỉ cho phép các transition thực tế nghiệp vụ:
 *
 *   pending     → picked_up | cancelled
 *   picked_up   → in_transit | returned
 *   in_transit  → delivered | returned
 *   delivered   → (terminal)
 *   returned    → (terminal — nếu cần tái giao, tạo vận đơn mới)
 *   cancelled   → (terminal)
 *
 * Lý do tách tường minh: tránh accidentally nhảy thẳng từ pending → delivered
 * (không thể — shipper phải đi qua picked_up), hoặc đổi lại state sau khi
 * đã delivered (làm lệch KPI).
 */
const ALLOWED_TRANSITIONS: Record<ShippingStatus, ShippingStatus[]> = {
  pending: ["picked_up", "cancelled"],
  picked_up: ["in_transit", "returned"],
  in_transit: ["delivered", "returned"],
  delivered: [],
  returned: [],
  cancelled: [],
};

export function canTransitionShippingStatus(
  from: ShippingStatus,
  to: ShippingStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function getNextShippingStatuses(current: ShippingStatus): ShippingStatus[] {
  return ALLOWED_TRANSITIONS[current] ?? [];
}

export const SHIPPING_STATUS_LABEL: Record<ShippingStatus, string> = {
  pending: "Chờ lấy hàng",
  picked_up: "Đã lấy hàng",
  in_transit: "Đang giao",
  delivered: "Đã giao",
  returned: "Đã hoàn",
  cancelled: "Đã hủy",
};

/**
 * Chuyển trạng thái vận đơn (pending → picked_up → in_transit → delivered …).
 *
 * - Validate transition hợp lệ theo state machine ở trên
 * - UPDATE guard `WHERE id = ? AND status = v_from` → tránh race khi 2 người
 *   cùng bấm "đã giao" thì chỉ 1 người thắng
 * - Insert audit_log entry `entity_type = "shipping_order"` với `old_data` +
 *   `new_data` để wired vào tab "Lịch sử giao hàng" ở detail panel
 */
export async function updateShippingOrderStatus(
  orderId: string,
  nextStatus: ShippingStatus,
  note?: string,
): Promise<ShippingOrder> {
  const supabase = getClient();
  const ctx = await getCurrentContext();

  // 1. Load current status + validate transition
  const { data: current, error: loadErr } = await supabase
    .from("shipping_orders")
    .select("id, status, code")
    .eq("id", orderId)
    .single();
  if (loadErr) handleError(loadErr, "updateShippingOrderStatus.load");
  if (!current) throw new Error("Không tìm thấy vận đơn");

  const fromStatus = current.status as ShippingStatus;
  if (!canTransitionShippingStatus(fromStatus, nextStatus)) {
    throw new Error(
      `Không thể chuyển vận đơn từ "${SHIPPING_STATUS_LABEL[fromStatus]}" sang "${SHIPPING_STATUS_LABEL[nextStatus]}"`,
    );
  }

  // 2. Atomic status swap (race-safe): chỉ update nếu status còn khớp
  const { data: updated, error: updErr } = await supabase
    .from("shipping_orders")
    .update({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      status: nextStatus as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      updated_at: new Date().toISOString() as any,
    })
    .eq("id", orderId)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .eq("status", fromStatus as any)
    .select(
      `*, invoices!shipping_orders_invoice_id_fkey(code), delivery_partners!shipping_orders_partner_id_fkey(name)`,
    )
    .single();
  if (updErr) handleError(updErr, "updateShippingOrderStatus.update");
  if (!updated) {
    throw new Error(
      "Vận đơn đã bị thay đổi trạng thái bởi request khác — vui lòng tải lại",
    );
  }

  // 3. Audit log — best-effort (không block nếu audit ghi fail)
  try {
    await supabase.from("audit_log").insert({
      tenant_id: ctx.tenantId,
      user_id: ctx.userId,
      action: "update_status",
      entity_type: "shipping_order",
      entity_id: orderId,
      old_data: { status: fromStatus },
      new_data: { status: nextStatus, note: note ?? null },
    });
  } catch (err) {
    console.warn("updateShippingOrderStatus: audit_log insert failed", err);
  }

  return mapShippingOrder(updated);
}

// --- Write Operations ---

/**
 * Cập nhật đối tác giao hàng.
 */
export async function updateDeliveryPartner(
  id: string,
  updates: Partial<DeliveryPartner>,
): Promise<DeliveryPartner> {
  const supabase = getClient();

  const payload: Record<string, unknown> = {};
  if (updates.name !== undefined) payload.name = updates.name;
  if (updates.phone !== undefined) payload.phone = updates.phone || null;

  const { data, error } = await supabase
    .from("delivery_partners")
    .update(payload)
    .eq("id", id)
    .select()
    .single();

  if (error) handleError(error, "updateDeliveryPartner");
  return mapDeliveryPartner(data);
}

/**
 * Ngừng hoạt động đối tác giao hàng (set is_active = false).
 */
export async function deactivateDeliveryPartner(id: string): Promise<void> {
  const supabase = getClient();

  const { error } = await supabase
    .from("delivery_partners")
    .update({ is_active: false })
    .eq("id", id);

  if (error) handleError(error, "deactivateDeliveryPartner");
}

// --- Mappers ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapShippingOrder(row: any): ShippingOrder {
  const status = (row.status ?? "pending") as ShippingStatus;
  return {
    id: row.id,
    code: row.code,
    invoiceCode: (row.invoices as { code: string } | null)?.code ?? "---",
    deliveryPartner: (row.delivery_partners as { name: string } | null)?.name ?? "---",
    customerName: row.receiver_name,
    customerPhone: row.receiver_phone,
    address: row.receiver_address,
    status,
    statusName: SHIPPING_STATUS_LABEL[status] ?? row.status,
    fee: row.shipping_fee,
    cod: row.cod_amount,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? undefined,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapDeliveryPartner(row: any): DeliveryPartner {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone ?? "",
    activeOrders: 0, // Would need aggregation
    completedOrders: 0,
    status: row.is_active ? "active" : "inactive",
    statusName: row.is_active ? "Đang hoạt động" : "Ngừng hoạt động",
    createdAt: row.created_at,
  };
}
