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
import { getClient, getCurrentContext, getCurrentTenantId, getPaginationRange, handleError } from "./base";

// --- Shipping Orders ---

export async function getShippingOrders(params: QueryParams): Promise<QueryResult<ShippingOrder>> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const { from, to } = getPaginationRange(params);

  let query = supabase
    .from("shipping_orders")
    .select(`
      *,
      invoices!shipping_orders_invoice_id_fkey(code),
      delivery_partners!shipping_orders_partner_id_fkey(name)
    `, { count: "exact" })
    .eq("tenant_id", tenantId);

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

  // CEO 08/07 (verify DB): bảng shipping_orders KHÔNG có cột branch_id —
  // filter .eq("branch_id") cũ làm query LỖI khi chọn 1 chi nhánh (bug ẩn vì
  // 0 vận đơn). Vận đơn xem toàn tenant; chi nhánh suy từ hóa đơn gắn kèm.

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

/**
 * CEO 08/07: vận đơn gắn 1 hóa đơn/đơn đặt hàng — cho khối "Giao hàng" ở
 * panel chi tiết. Trả null nếu đơn không có vận đơn.
 */
export async function getShippingOrderByInvoice(
  invoiceId: string,
): Promise<ShippingOrder | null> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  const { data, error } = await supabase
    .from("shipping_orders")
    .select(
      `*, invoices!shipping_orders_invoice_id_fkey(code), delivery_partners!shipping_orders_partner_id_fkey(name)`,
    )
    .eq("tenant_id", tenantId)
    .eq("invoice_id", invoiceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("[getShippingOrderByInvoice]", error.message);
    return null;
  }
  return data ? mapShippingOrder(data) : null;
}

// --- Tạo vận đơn cho hóa đơn có sẵn (CEO 08/07 — như KiotViet) ---

export interface CreateShipmentInput {
  invoiceId: string;
  fee: number; // phí giao hàng thu khách
  receiverName: string;
  receiverPhone: string;
  receiverAddress: string;
  partnerId?: string | null;
  note?: string | null;
}

/**
 * Gắn VẬN ĐƠN vào hóa đơn/đơn đặt hàng CÓ SẴN (kể cả completed — đơn cũ tạo
 * trước khi có tính năng phí giao). Cập nhật đủ sổ:
 *   - invoices: delivery_fee = fee, total += diff, debt += diff
 *     (diff = fee − delivery_fee cũ; total ĐÃ gồm phí theo quy ước FnB RPC)
 *   - customers.debt += diff CHỈ khi hóa đơn 'completed' (đơn nháp chưa cộng
 *     nợ KH — verify DB 08/07: draft debt KH = 0, completed mới cộng)
 *   - shipping_orders: mã VD (next_code), cod = total mới − paid
 * Chặn: hóa đơn cancelled, hoặc đã có vận đơn chưa hủy (1 đơn 1 vận đơn).
 */
interface AttachShipmentRpcResult {
  shipment_id?: string | null;
  shipment_code?: string | null;
  delivery_fee?: number;
  total?: number;
  debt?: number;
  idempotent?: boolean;
}

async function attachInvoiceShipmentAtomic(input: {
  invoiceId: string;
  fee: number;
  receiverName?: string | null;
  receiverPhone?: string | null;
  receiverAddress?: string | null;
  partnerId?: string | null;
  note?: string | null;
}): Promise<AttachShipmentRpcResult> {
  const supabase = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "attach_invoice_shipment_atomic",
    {
      p_invoice_id: input.invoiceId,
      p_delivery_fee: Math.max(0, Number(input.fee) || 0),
      p_receiver_name: input.receiverName ?? null,
      p_receiver_phone: input.receiverPhone ?? null,
      p_receiver_address: input.receiverAddress ?? null,
      p_partner_id: input.partnerId ?? null,
      p_note: input.note ?? null,
    },
  );
  if (error) handleError(error, "attachInvoiceShipmentAtomic.rpc");
  if (!data) throw new Error("Máy chủ không trả kết quả tạo vận đơn");
  return data as AttachShipmentRpcResult;
}

export async function createShipmentForInvoice(
  input: CreateShipmentInput,
): Promise<ShippingOrder> {
  if (
    !input.receiverName.trim() ||
    !input.receiverPhone.trim() ||
    !input.receiverAddress.trim()
  ) {
    throw new Error("Cần đủ người nhận + SĐT + địa chỉ giao hàng");
  }

  const result = await attachInvoiceShipmentAtomic({
    invoiceId: input.invoiceId,
    fee: input.fee,
    receiverName: input.receiverName,
    receiverPhone: input.receiverPhone,
    receiverAddress: input.receiverAddress,
    partnerId: input.partnerId,
    note: input.note,
  });
  if (!result.shipment_id) {
    throw new Error("Phản hồi tạo vận đơn thiếu mã vận đơn");
  }

  const supabase = getClient();
  const { data, error } = await supabase
    .from("shipping_orders")
    .select(
      `*, invoices!shipping_orders_invoice_id_fkey(code), delivery_partners!shipping_orders_partner_id_fkey(name)`,
    )
    .eq("id", result.shipment_id)
    .single();
  if (error) handleError(error, "createShipmentForInvoice.read");
  return mapShippingOrder(data);
}

export interface AttachDeliveryInput {
  invoiceId: string;
  /** Phí giao hàng thu khách (state.shippingFee). */
  deliveryFee: number;
  /** Tổng ĐÚNG đã gồm ship (state.total). Reconcile khi nhánh nháp lưu thiếu. */
  authoritativeTotal: number;
  /** Số đã thu tại quầy (COD → thường 0). */
  paid: number;
  receiverName?: string;
  receiverPhone?: string;
  receiverAddress?: string;
  partnerId?: string | null;
  note?: string | null;
}

/**
 * CEO 08/07: sau khi POS Retail thanh toán đơn "Bán giao hàng" → gắn phí ship +
 * vận đơn vào hóa đơn VỪA TẠO. Cả 2 nhánh (posCheckout tươi / completeDraftOrder)
 * đều ghi `invoices.total` GỒM ship (page truyền `state.total`) nhưng KHÔNG set
 * cột `delivery_fee`; riêng nhánh nháp: hash auto-save bỏ phí ship → nếu cashier
 * nhập ship SAU khi sửa hàng, nháp lưu total CŨ THIẾU ship. Hàm này:
 *   1. set `delivery_fee` + RECONCILE `total`/`debt` về đúng (state.total).
 *      Trigger 00130 tự đồng bộ `customers.debt` từ SUM(invoices.debt) → không
 *      cần chỉnh nợ KH tay, không recursion.
 *   2. tạo `shipping_order` (cod = tổng − đã thu) nếu đủ người nhận/SĐT/địa chỉ.
 * Best-effort: lỗi ném ra để page toast; KHÔNG rollback hóa đơn (đã thu tiền).
 */
export async function attachDeliveryToInvoice(
  input: AttachDeliveryInput,
): Promise<{ shipmentCode: string | null }> {
  // authoritativeTotal/paid are retained in the public input for compatibility,
  // but the server derives both from the locked invoice row.
  const result = await attachInvoiceShipmentAtomic({
    invoiceId: input.invoiceId,
    fee: input.deliveryFee,
    receiverName: input.receiverName,
    receiverPhone: input.receiverPhone,
    receiverAddress: input.receiverAddress,
    partnerId: input.partnerId,
    note: input.note,
  });
  return { shipmentCode: result.shipment_code ?? null };
}

// --- Delivery Partners ---

export async function getDeliveryPartners(params: QueryParams): Promise<QueryResult<DeliveryPartner>> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const { from, to } = getPaginationRange(params);

  let query = supabase
    .from("delivery_partners")
    .select("*", { count: "exact" })
    .eq("tenant_id", tenantId);

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
  const tenantId = await getCurrentTenantId();

  const { data, error } = await supabase
    .from("delivery_partners")
    .select("id, name")
    .eq("tenant_id", tenantId)
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
  const { data, error } = await (supabase.rpc as any)(
    "update_shipping_order_status_atomic",
    {
      p_shipping_order_id: orderId,
      p_next_status: nextStatus,
      p_note: note ?? null,
    },
  );
  if (error) handleError(error, "updateShippingOrderStatus.rpc");
  if (!data) throw new Error("Máy chủ không trả về vận đơn đã cập nhật.");
  return mapShippingOrder(data);
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
  const tenantId = await getCurrentTenantId();

  const payload: Record<string, unknown> = {};
  if (updates.name !== undefined) payload.name = updates.name;
  if (updates.phone !== undefined) payload.phone = updates.phone || null;

  const { data, error } = await supabase
    .from("delivery_partners")
    .update(payload)
    .eq("tenant_id", tenantId)
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
  const tenantId = await getCurrentTenantId();

  const { error } = await supabase
    .from("delivery_partners")
    .update({ is_active: false })
    .eq("tenant_id", tenantId)
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
