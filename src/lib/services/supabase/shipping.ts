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
export async function createShipmentForInvoice(
  input: CreateShipmentInput,
): Promise<ShippingOrder> {
  const supabase = getClient();
  const ctx = await getCurrentContext();
  const fee = Math.max(0, Number(input.fee) || 0);
  if (!input.receiverName.trim() || !input.receiverPhone.trim() || !input.receiverAddress.trim()) {
    throw new Error("Cần đủ người nhận + SĐT + địa chỉ giao hàng");
  }

  // 1. Load hóa đơn
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: inv, error: invErr } = await (supabase as any)
    .from("invoices")
    .select("id, code, status, delivery_fee, total, paid, debt, customer_id")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", input.invoiceId)
    .single();
  if (invErr) handleError(invErr, "createShipmentForInvoice.load");
  if (!inv) throw new Error("Không tìm thấy hóa đơn");
  if (inv.status === "cancelled") {
    throw new Error("Hóa đơn đã hủy — không thể tạo vận đơn");
  }

  // 2. Chặn vận đơn trùng (còn hiệu lực)
  const { data: existing } = await supabase
    .from("shipping_orders")
    .select("id, code, status")
    .eq("tenant_id", ctx.tenantId)
    .eq("invoice_id", input.invoiceId)
    .not("status", "in", "(cancelled,returned)")
    .limit(1)
    .maybeSingle();
  if (existing) {
    throw new Error(`Đơn này đã có vận đơn ${existing.code} — hủy vận đơn cũ trước khi tạo mới`);
  }

  // 3. Cập nhật tiền hóa đơn (diff phí giao)
  const oldFee = Number(inv.delivery_fee ?? 0);
  const diff = fee - oldFee;
  const newTotal = Number(inv.total ?? 0) + diff;
  const newDebt = Number(inv.debt ?? 0) + diff;
  if (diff !== 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updErr } = await (supabase as any)
      .from("invoices")
      .update({ delivery_fee: fee, total: newTotal, debt: newDebt })
      .eq("tenant_id", ctx.tenantId)
      .eq("id", input.invoiceId);
    if (updErr) handleError(updErr, "createShipmentForInvoice.updateInvoice");

    // Nợ KH: chỉ hóa đơn completed mới đã cộng vào customers.debt
    if (inv.status === "completed" && inv.customer_id) {
      const { data: kh } = await supabase
        .from("customers")
        .select("debt")
        .eq("tenant_id", ctx.tenantId)
        .eq("id", inv.customer_id)
        .single();
      if (kh) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: khErr } = await (supabase as any)
          .from("customers")
          .update({ debt: Number(kh.debt ?? 0) + diff })
          .eq("tenant_id", ctx.tenantId)
          .eq("id", inv.customer_id);
        if (khErr) handleError(khErr, "createShipmentForInvoice.updateCustomerDebt");
      }
    }
  }

  // 4. Sinh mã + tạo vận đơn (COD = số còn phải thu)
  const { data: shipCode, error: codeErr } = await supabase.rpc("next_code", {
    p_tenant_id: ctx.tenantId,
    p_entity_type: "shipping_order",
  });
  if (codeErr) handleError(codeErr, "createShipmentForInvoice.code");

  const { data: created, error: shipErr } = await supabase
    .from("shipping_orders")
    .insert({
      tenant_id: ctx.tenantId,
      invoice_id: input.invoiceId,
      partner_id: input.partnerId || null,
      code: (shipCode as string) ?? `VD${Math.floor(performance.now())}`,
      status: "pending" as const,
      shipping_fee: fee,
      cod_amount: Math.max(0, newTotal - Number(inv.paid ?? 0)),
      receiver_name: input.receiverName.trim(),
      receiver_phone: input.receiverPhone.trim(),
      receiver_address: input.receiverAddress.trim(),
      note: input.note || null,
    })
    .select(
      `*, invoices!shipping_orders_invoice_id_fkey(code), delivery_partners!shipping_orders_partner_id_fkey(name)`,
    )
    .single();
  if (shipErr) handleError(shipErr, "createShipmentForInvoice.insert");

  // 5. Audit — best-effort
  try {
    await supabase.from("audit_log").insert({
      tenant_id: ctx.tenantId,
      user_id: ctx.userId,
      action: "attach_shipment",
      entity_type: "invoice",
      entity_id: input.invoiceId,
      old_data: { delivery_fee: oldFee, total: inv.total, debt: inv.debt },
      new_data: { delivery_fee: fee, total: newTotal, debt: newDebt, shipment: created?.code },
    });
  } catch (err) {
    console.warn("createShipmentForInvoice: audit_log failed", err);
  }

  return mapShippingOrder(created);
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
  const supabase = getClient();
  const ctx = await getCurrentContext();
  const fee = Math.max(0, Number(input.deliveryFee) || 0);
  const total = Math.max(0, Number(input.authoritativeTotal) || 0);
  const paid = Math.max(0, Number(input.paid) || 0);
  const newDebt = Math.max(0, total - paid);

  // 1. Set delivery_fee + reconcile total/debt (nhánh nháp total có thể thiếu ship).
  //    Trigger 00130 tự recompute customers.debt.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updErr } = await (supabase as any)
    .from("invoices")
    .update({ delivery_fee: fee, total, debt: newDebt })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", input.invoiceId);
  if (updErr) handleError(updErr, "attachDeliveryToInvoice.updateInvoice");

  // 2. Tạo vận đơn — chỉ khi đủ người nhận (cột NOT NULL của shipping_orders).
  const rName = (input.receiverName ?? "").trim();
  const rPhone = (input.receiverPhone ?? "").trim();
  const rAddr = (input.receiverAddress ?? "").trim();
  if (!rName || !rPhone || !rAddr) return { shipmentCode: null };

  // Chặn trùng (đã có vận đơn còn hiệu lực — vd double checkout).
  const { data: existing } = await supabase
    .from("shipping_orders")
    .select("code")
    .eq("tenant_id", ctx.tenantId)
    .eq("invoice_id", input.invoiceId)
    .not("status", "in", "(cancelled,returned)")
    .limit(1)
    .maybeSingle();
  if (existing) return { shipmentCode: (existing as { code: string }).code };

  const { data: shipCode, error: codeErr } = await supabase.rpc("next_code", {
    p_tenant_id: ctx.tenantId,
    p_entity_type: "shipping_order",
  });
  if (codeErr) handleError(codeErr, "attachDeliveryToInvoice.code");

  const { data: created, error: shipErr } = await supabase
    .from("shipping_orders")
    .insert({
      tenant_id: ctx.tenantId,
      invoice_id: input.invoiceId,
      partner_id: input.partnerId || null,
      code: (shipCode as string) ?? `VD${Math.floor(performance.now())}`,
      status: "pending" as const,
      shipping_fee: fee,
      cod_amount: newDebt, // COD = số còn phải thu khi giao
      receiver_name: rName,
      receiver_phone: rPhone,
      receiver_address: rAddr,
      note: input.note || null,
    })
    .select("code")
    .single();
  if (shipErr) handleError(shipErr, "attachDeliveryToInvoice.insertShipment");
  return { shipmentCode: (created as { code: string } | null)?.code ?? null };
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
  const ctx = await getCurrentContext();

  // 1. Load current status + validate transition
  const { data: current, error: loadErr } = await supabase
    .from("shipping_orders")
    .select("id, status, code")
    .eq("tenant_id", ctx.tenantId)
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
    .eq("tenant_id", ctx.tenantId)
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
