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
import { applyCreatedAtRangeFilter } from "@/lib/utils/list-date-preset-range";

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

  // Filter: thời gian tạo (dateFrom/dateTo) — 04/08: trước đây sidebar có ô
  // lọc nhưng không truyền vào truy vấn (UI giả). Dùng khuôn chung như hóa đơn.
  query = applyCreatedAtRangeFilter(query, params.filters);

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
 * Đếm vận đơn theo trạng thái trên TOÀN BỘ tenant — cho 4 thẻ KPI đầu trang.
 * 04/08: thẻ cũ đếm `data.filter(...)` = chỉ 15 dòng của trang hiện tại nên
 * số sai ngay khi có phân trang. 1 truy vấn chỉ lấy cột status, không phân
 * trang (vài chục–vài nghìn dòng, nhẹ).
 */
export type ShippingStatusCounts = Record<ShippingStatus, number>;

export async function getShippingStatusCounts(): Promise<ShippingStatusCounts> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  const { data, error } = await supabase
    .from("shipping_orders")
    .select("status")
    .eq("tenant_id", tenantId);
  if (error) handleError(error, "getShippingStatusCounts");

  const counts: ShippingStatusCounts = {
    pending: 0,
    picked_up: 0,
    in_transit: 0,
    delivered: 0,
    returned: 0,
    cancelled: 0,
  };
  for (const row of data ?? []) {
    const s = row.status as ShippingStatus;
    if (s in counts) counts[s] += 1;
  }
  return counts;
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
 * Đối tác giao hàng KÈM SỐ LIỆU THẬT gộp từ vận đơn.
 *
 * 04/08/2026 — trang cũ hiển thị "Tổng đơn hàng", "Nợ cần trả", "Tổng phí"
 * đều là số 0 hardcode nên vô dụng. Bản này đọc thật từ `shipping_orders`.
 *
 * Câu hỏi trang phải trả lời được (chuẩn quản lý bán lẻ):
 *   · Đối tác đang giữ bao nhiêu đơn của mình?
 *   · Đang giữ bao nhiêu TIỀN THU HỘ (COD) chưa nộp lại?  ← quan trọng nhất
 *   · Mình phải trả họ bao nhiêu phí giao?
 *   · Tỷ lệ giao hỏng (hoàn/huỷ) bao nhiêu?
 *
 * Dữ liệu nhỏ (vài chục–vài nghìn vận đơn) nên gộp phía ứng dụng bằng 2 truy
 * vấn, không cần thêm hàm phía máy chủ. Nếu sau này nhiều lên thì chuyển RPC.
 */
export interface DeliveryPartnerStats {
  /** Đơn đối tác đang cầm: pending + picked_up + in_transit */
  activeOrders: number;
  deliveredOrders: number;
  /** Giao hỏng: returned + cancelled */
  failedOrders: number;
  /**
   * COD của các đơn ĐÃ GIAO. Hiện cộng dồn TẤT CẢ đơn đã giao vì bảng chưa có
   * cột đánh dấu đã đối soát (`cod_collected_at`). Khi làm màn đối soát thì
   * trừ phần đã nộp ra.
   */
  codHolding: number;
  /**
   * Tổng phí giao của các đơn đã giao. ⚠️ Đây là phí THU CỦA KHÁCH — bảng chỉ
   * có một cột `shipping_fee`, chưa tách phí TRẢ ĐỐI TÁC. Không được gọi đây
   * là công nợ phải trả cho tới khi có cột riêng.
   */
  feeCollected: number;
}

export interface DeliveryPartnerWithStats extends DeliveryPartner {
  stats: DeliveryPartnerStats;
}

const EMPTY_STATS: DeliveryPartnerStats = {
  activeOrders: 0,
  deliveredOrders: 0,
  failedOrders: 0,
  codHolding: 0,
  feeCollected: 0,
};

const ACTIVE_SHIPPING_STATUSES = ["pending", "picked_up", "in_transit"];
const FAILED_SHIPPING_STATUSES = ["returned", "cancelled"];

export async function getDeliveryPartnersWithStats(
  params: QueryParams,
  scope?: { branchId?: string },
): Promise<
  QueryResult<DeliveryPartnerWithStats> & {
    /** Vận đơn CHƯA gán đối tác — hiện đang là toàn bộ, cần cho CEO biết. */
    unassigned: DeliveryPartnerStats;
  }
> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // 00301 thêm cột settlement_id — đơn đã đối soát thì đối tác hết giữ COD.
  // Chưa chạy migration (42703 cột chưa có) → rơi về câu cũ, trang vẫn chạy.
  // Type sinh máy chưa biết cột mới → ép kiểu dòng cục bộ.
  type StatsRow = {
    partner_id: string | null;
    status: string | null;
    shipping_fee: number | null;
    cod_amount: number | null;
    settlement_id?: string | null;
  };
  type StatsResult = {
    data: StatsRow[] | null;
    error: { code?: string; message: string } | null;
  };
  let ordersQuery = supabase
    .from("shipping_orders")
    .select("partner_id, status, shipping_fee, cod_amount, settlement_id, invoices!inner(branch_id)")
    .eq("tenant_id", tenantId);
  if (scope?.branchId) {
    ordersQuery = ordersQuery.eq("invoices.branch_id", scope.branchId);
  }
  let ordersResult = (await ordersQuery) as unknown as StatsResult;
  if (ordersResult.error?.code === "42703") {
    let legacyOrdersQuery = supabase
      .from("shipping_orders")
      .select("partner_id, status, shipping_fee, cod_amount, invoices!inner(branch_id)")
      .eq("tenant_id", tenantId);
    if (scope?.branchId) {
      legacyOrdersQuery = legacyOrdersQuery.eq("invoices.branch_id", scope.branchId);
    }
    ordersResult = (await legacyOrdersQuery) as unknown as StatsResult;
  }
  const partnersResult = await getDeliveryPartners(params);

  if (ordersResult.error) {
    handleError(ordersResult.error, "getDeliveryPartnersWithStats.orders");
  }

  const byPartner = new Map<string, DeliveryPartnerStats>();
  const unassigned: DeliveryPartnerStats = { ...EMPTY_STATS };

  for (const row of ordersResult.data ?? []) {
    const key = (row.partner_id as string | null) ?? "";
    const bucket = key
      ? byPartner.get(key) ?? { ...EMPTY_STATS }
      : unassigned;

    const status = String(row.status ?? "");
    const settled =
      (row as { settlement_id?: string | null }).settlement_id != null;
    if (ACTIVE_SHIPPING_STATUSES.includes(status)) {
      bucket.activeOrders += 1;
    } else if (status === "delivered") {
      bucket.deliveredOrders += 1;
      // Chỉ đơn đã giao mà CHƯA đối soát mới là tiền đối tác đang giữ.
      if (!settled) {
        bucket.codHolding += Number(row.cod_amount ?? 0);
        bucket.feeCollected += Number(row.shipping_fee ?? 0);
      }
    } else if (FAILED_SHIPPING_STATUSES.includes(status)) {
      bucket.failedOrders += 1;
    }

    if (key) byPartner.set(key, bucket);
  }

  return {
    data: partnersResult.data.map((partner) => ({
      ...partner,
      stats: byPartner.get(partner.id) ?? { ...EMPTY_STATS },
    })),
    total: partnersResult.total,
    unassigned,
  };
}

// --- Đối soát COD (00301, kiểu KiotViet) ---

const MIGRATION_00301_HINT =
  "Chức năng đối soát COD cần chạy migration 00301_cod_settlement.sql trước.";

export interface UnsettledShipment {
  id: string;
  code: string;
  invoiceCode: string;
  customerName: string;
  codAmount: number;
  /** Thời điểm chuyển sang "đã giao" (updated_at — bảng không có cột riêng). */
  deliveredAt: string;
}

/**
 * Vận đơn ĐÃ GIAO chưa đối soát của một đối tác (null = nhóm chưa gán đối
 * tác). Danh sách tick trong dialog đối soát.
 */
export async function getUnsettledShipments(
  partnerId: string | null,
  branchId?: string,
): Promise<UnsettledShipment[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  let query = supabase
    .from("shipping_orders")
    .select(
      "id, code, cod_amount, updated_at, settlement_id, invoices!shipping_orders_invoice_id_fkey!inner(code, customer_name, branch_id)",
    )
    .eq("tenant_id", tenantId)
    .eq("status", "delivered")
    .is("settlement_id", null)
    .order("updated_at", { ascending: true });
  if (branchId) query = query.eq("invoices.branch_id", branchId);
  query = partnerId
    ? query.eq("partner_id", partnerId)
    : query.is("partner_id", null);

  // Type sinh máy chưa biết settlement_id (cột của 00301) → ép kiểu dòng.
  type UnsettledRow = {
    id: string;
    code: string;
    cod_amount: number | null;
    updated_at: string;
    invoices: { code: string; customer_name: string } | null;
  };
  const { data, error } = (await query) as unknown as {
    data: UnsettledRow[] | null;
    error: { code?: string; message: string } | null;
  };
  if (error) {
    if (error.code === "42703") throw new Error(MIGRATION_00301_HINT);
    handleError(error, "getUnsettledShipments");
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    code: row.code,
    invoiceCode: row.invoices?.code ?? "—",
    customerName: row.invoices?.customer_name ?? "—",
    codAmount: Number(row.cod_amount ?? 0),
    deliveredAt: row.updated_at,
  }));
}

export interface SettleCodInput {
  partnerId: string | null;
  items: Array<{ shipmentId: string; partnerFee: number }>;
  paymentMethod: "cash" | "transfer";
  note?: string | null;
}

export interface SettleCodResult {
  settlementId: string;
  code: string;
  totalCod: number;
  totalPartnerFee: number;
  netAmount: number;
  receipts: number;
}

/**
 * Xác nhận đối soát — 1 RPC nguyên tử (00301): phiếu đối soát DS + phiếu thu
 * từng hóa đơn (trừ nợ khách) + 1 phiếu chi phí trả đối tác + đóng dấu vận
 * đơn. Được ăn cả ngã về không.
 */
export async function settleCod(input: SettleCodInput): Promise<SettleCodResult> {
  if (input.items.length === 0) {
    throw new Error("Chọn ít nhất 1 vận đơn để đối soát.");
  }
  const supabase = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("settle_cod_atomic", {
    p_partner_id: input.partnerId,
    p_items: input.items.map((i) => ({
      shipment_id: i.shipmentId,
      partner_fee: Math.max(0, Number(i.partnerFee) || 0),
    })),
    p_payment_method: input.paymentMethod,
    p_note: input.note ?? null,
  });
  if (error) {
    // PGRST202 = RPC chưa tồn tại → migration chưa chạy (KHÔNG phải lỗi quyền)
    if (error.code === "PGRST202") throw new Error(MIGRATION_00301_HINT);
    handleError(error, "settleCod");
  }
  const raw = (data ?? {}) as Record<string, unknown>;
  if (!raw.settlement_id) {
    throw new Error("Máy chủ không trả kết quả đối soát hợp lệ.");
  }
  return {
    settlementId: String(raw.settlement_id),
    code: String(raw.code ?? ""),
    totalCod: Number(raw.total_cod ?? 0),
    totalPartnerFee: Number(raw.total_partner_fee ?? 0),
    netAmount: Number(raw.net_amount ?? 0),
    receipts: Number(raw.receipts ?? 0),
  };
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
    code: row.code ?? "",
    name: row.name,
    phone: row.phone ?? "",
    // Số đơn thật lấy ở getDeliveryPartnersWithStats (gộp từ shipping_orders);
    // hai trường này giữ lại cho các nơi gọi cũ, luôn bằng 0.
    activeOrders: 0,
    completedOrders: 0,
    status: row.is_active ? "active" : "inactive",
    statusName: row.is_active ? "Đang hoạt động" : "Ngừng hoạt động",
    createdAt: row.created_at,
  };
}
