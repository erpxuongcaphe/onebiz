import { applyCreatedAtRangeFilter } from "@/lib/utils/list-date-preset-range";
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
import { isRpcUnavailable } from "./rpc-utils";

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

export interface SavePurchaseOrderItemInput {
  productId: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  vatRate: number;
  expiryDate?: string | null;
  lotNumber?: string | null;
}

export interface SavePurchaseOrderInput {
  orderId?: string | null;
  requestedCode?: string | null;
  branchId: string;
  supplierId: string;
  note?: string | null;
  shippingCost?: number;
  otherCost?: number;
  orderDiscount?: number;
  paidAmount?: number;
  paymentMethod?: "cash" | "transfer" | "card" | "ewallet";
  markOrdered?: boolean;
  receiveNow?: boolean;
  items: SavePurchaseOrderItemInput[];
}

export interface SavePurchaseOrderResult {
  orderId: string;
  code: string;
  status: PurchaseOrderStatus;
  total: number;
  paid: number;
  debt: number;
}

export interface UpdateReceivedPurchaseOrderInput {
  orderId: string;
  requestedPaid: number;
  note?: string | null;
  paymentMethod?: "cash" | "transfer" | "card" | "ewallet";
}

export async function updateReceivedPurchaseOrderAtomic(
  input: UpdateReceivedPurchaseOrderInput,
): Promise<SavePurchaseOrderResult> {
  const supabase = getClient();
  const { data, error } = await (supabase.rpc as any)(
    "update_received_purchase_order_atomic",
    {
      p_purchase_order_id: input.orderId,
      p_requested_paid: Number(input.requestedPaid),
      p_note: input.note ?? null,
      p_payment_method: input.paymentMethod ?? "cash",
    },
  );
  if (error) handleError(error, "updateReceivedPurchaseOrderAtomic");

  const result = data as Record<string, unknown> | null;
  if (!result?.purchase_order_id || !result.code || !result.status) {
    throw new Error("Máy chủ không trả về kết quả cập nhật phiếu nhập.");
  }

  return {
    orderId: String(result.purchase_order_id),
    code: String(result.code),
    status: result.status as PurchaseOrderStatus,
    total: Number(result.paid ?? 0) + Number(result.debt ?? 0),
    paid: Number(result.paid ?? 0),
    debt: Number(result.debt ?? 0),
  };
}

export async function savePurchaseOrderAtomic(
  input: SavePurchaseOrderInput,
): Promise<SavePurchaseOrderResult> {
  const supabase = getClient();
  const { data, error } = await (supabase.rpc as any)(
    "save_purchase_order_atomic",
    {
      p_purchase_order_id: input.orderId ?? null,
      p_requested_code: input.requestedCode ?? null,
      p_branch_id: input.branchId,
      p_supplier_id: input.supplierId,
      p_note: input.note ?? null,
      p_shipping_cost: Number(input.shippingCost ?? 0),
      p_other_cost: Number(input.otherCost ?? 0),
      p_order_discount: Number(input.orderDiscount ?? 0),
      p_paid_amount: Number(input.paidAmount ?? 0),
      p_payment_method: input.paymentMethod ?? "cash",
      p_mark_ordered: Boolean(input.markOrdered),
      p_receive_now: Boolean(input.receiveNow),
      p_items: input.items.map((item) => ({
        product_id: item.productId,
        quantity: Number(item.quantity),
        unit_price: Number(item.unitPrice),
        discount: Number(item.discount ?? 0),
        vat_rate: Number(item.vatRate ?? 0),
        expiry_date: item.expiryDate ?? null,
        lot_number: item.lotNumber ?? null,
      })),
    },
  );
  if (error) handleError(error, "savePurchaseOrderAtomic");

  const result = data as Record<string, unknown> | null;
  if (!result?.purchase_order_id || !result.code || !result.status) {
    throw new Error("Máy chủ không trả về kết quả lưu phiếu nhập.");
  }

  return {
    orderId: String(result.purchase_order_id),
    code: String(result.code),
    status: result.status as PurchaseOrderStatus,
    total: Number(result.total ?? 0),
    paid: Number(result.paid ?? 0),
    debt: Number(result.debt ?? 0),
  };
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyCreatedAtRange(query: any, filters: QueryParams["filters"] | undefined) {
  return applyCreatedAtRangeFilter(query, filters);
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
    const esc = params.search.replace(/[%_]/g, "\\$&");
    // CEO 05/07: tìm theo cột chọn — "all"/lạ → OR mã+NCC như cũ.
    if (params.searchField === "code") query = query.ilike("code", `%${esc}%`);
    else if (params.searchField === "supplier_name")
      query = query.ilike("supplier_name", `%${esc}%`);
    else
      query = query.or(
        `code.ilike.%${esc}%,supplier_name.ilike.%${esc}%`
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

  query = applyCreatedAtRange(query, params.filters);

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
  /** Day 18/05/2026 (CEO): HSD nhập tại phiếu nhập (migration 00102) */
  expiryDate?: string | null;
  lotNumber?: string | null;
  /** 29/07: cần cho màn "Sửa phiếu nhập" — sửa giá không đụng kho. */
  discount?: number;
  vatRate?: number;
}

export async function getPurchaseOrderItems(
  orderId: string,
): Promise<PurchaseOrderItemRow[]> {
  const supabase = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("purchase_order_items")
    .select(
      "id, product_id, product_name, quantity, received_quantity, unit_price, discount, vat_rate, unit, expiry_date, lot_number, products(code)",
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
    discount: number | string | null;
    vat_rate: number | string | null;
    unit: string | null;
    expiry_date: string | null;
    lot_number: string | null;
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
      expiryDate: row.expiry_date,
      lotNumber: row.lot_number,
      discount: Number(row.discount ?? 0),
      vatRate: Number(row.vat_rate ?? 0),
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
      p_created_by: null,
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
  newStatus: PurchaseOrderStatus,
  reason?: string,
): Promise<void> {
  if (newStatus === "completed") {
    await receivePurchaseOrder(orderId);
    return;
  }
  if (newStatus !== "ordered" && newStatus !== "cancelled") {
    throw new Error("Trạng thái phiếu nhập phải được thay đổi qua đúng nghiệp vụ.");
  }

  const supabase = getClient();
  const { data, error } = await (supabase.rpc as any)(
    "set_purchase_order_state_atomic",
    {
      p_purchase_order_id: orderId,
      p_new_status: newStatus,
      p_reason: reason ?? null,
    },
  );
  if (error) handleError(error, "updatePurchaseOrderStatus");

  const result = data as Record<string, unknown> | null;
  if (!result?.purchase_order_id || result.status !== newStatus) {
    throw new Error("Máy chủ không xác nhận trạng thái phiếu nhập.");
  }
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "receive_purchase_items_atomic",
    {
      p_order_id: orderId,
      p_lines: null, // null = "nhận toàn bộ remaining"
      p_created_by: null,
    },
  );
  if (error) handleError(error, "receivePurchaseOrder");

  const res = data as ReceivePurchaseItemsRpcResponse | null;
  if (!res || !res.new_status) {
    throw new Error("RPC receive_purchase_items_atomic không trả về kết quả");
  }
}

// ============================================================
// Phase 2 — Mở lại phiếu nhập đã nhập kho để sửa (CEO 01/06/2026)
// ============================================================

/**
 * Atomic revert receive: trả phiếu đã nhập kho về 'draft' để user sửa
 * items/qty/giá rồi nhập kho lại. Wrap RPC revert_received_purchase_order_atomic
 * (migration 00120).
 *
 * Side effects (atomic):
 * - Trừ products.stock + branch_stock theo received_quantity.
 * - Insert stock_movements 'out' audit (reference_type='purchase_order_revert').
 * - Xoá product_lots còn full, cancel lots đã consume một phần.
 * - Xoá input_invoice (nếu chưa 'recorded' — nếu đã ghi sổ → throw).
 * - Reset received_quantity về 0.
 * - Set status='draft'.
 *
 * Guards (RPC sẽ raise):
 * - Status phải ordered/partial/completed.
 * - Sản phẩm đã bán bớt → tồn âm → throw "đã bán X, không thể revert Y".
 * - Input_invoice đã ghi sổ → throw.
 */
export async function reopenPurchaseOrderForEdit(
  orderId: string,
  /** 21/07 (00214): true → hoàn nhập DÙ tồn âm (đã bán bớt). Mặc định false =
   *  giữ chặn cứng như cũ. UI cảnh báo đỏ rồi mới truyền true. */
  allowNegative = false,
): Promise<{
  revertedLines: number;
  revertedQtyTotal: number;
  consumedLotsCancelled: number;
  inputInvoiceDeleted: boolean;
}> {
  const supabase = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "revert_received_purchase_order_atomic",
    {
      p_order_id: orderId,
      p_user_id: null,
      p_allow_negative: allowNegative,
    },
  );
  if (error) handleError(error, "reopenPurchaseOrderForEdit");

  const res = data as {
    success: boolean;
    reverted_lines: number;
    reverted_qty_total: number;
    consumed_lots_cancelled: number;
    input_invoice_deleted: boolean;
    new_status: string;
  } | null;
  if (!res || !res.success) {
    throw new Error("RPC revert_received_purchase_order_atomic không trả về kết quả");
  }
  return {
    revertedLines: res.reverted_lines,
    revertedQtyTotal: res.reverted_qty_total,
    consumedLotsCancelled: res.consumed_lots_cancelled,
    inputInvoiceDeleted: res.input_invoice_deleted,
  };
}

// ============================================================
// Sửa phiếu nhập KHÔNG cần huỷ — phần không đụng kho (CEO 29/07/2026)
// ============================================================

/**
 * Nạp đúng những trường màn "Sửa phiếu nhập" cần.
 *
 * Không lấy từ dòng danh sách vì kiểu `PurchaseOrder` không mang ghi chú và
 * các khoản chi phí — dialog tự đọc để luôn thấy số mới nhất, không lệ thuộc
 * bảng ngoài đã tải trước đó.
 */
export async function getPurchaseOrderEditData(orderId: string): Promise<{
  note: string | null;
  shippingCost: number;
  otherCost: number;
  orderDiscount: number;
  total: number;
  paid: number;
  supplierName: string | null;
  status: string;
}> {
  const supabase = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("purchase_orders")
    .select("note, shipping_cost, other_cost, order_discount, total, paid, supplier_name, status")
    .eq("id", orderId)
    .single();
  if (error) handleError(error, "getPurchaseOrderEditData");
  return {
    note: data?.note ?? null,
    shippingCost: Number(data?.shipping_cost ?? 0),
    otherCost: Number(data?.other_cost ?? 0),
    orderDiscount: Number(data?.order_discount ?? 0),
    total: Number(data?.total ?? 0),
    paid: Number(data?.paid ?? 0),
    supplierName: data?.supplier_name ?? null,
    status: String(data?.status ?? ""),
  };
}

export interface SuaGiaDongHang {
  /** id dòng trong purchase_order_items */
  id: string;
  unitPrice?: number;
  discount?: number;
  vatRate?: number;
}

export interface KetQuaSuaPhieuNhap {
  soDongSua: number;
  tongCu: number;
  tongMoi: number;
  chenhLech: number;
  daTra: number;
  conNo: number;
}

/**
 * Sửa phiếu nhập đã nhập kho mà KHÔNG hoàn nhập.
 *
 * Sửa được: nhà cung cấp, ghi chú, đơn giá, chiết khấu, thuế, phí vận
 * chuyển, chi phí khác, giảm giá cả phiếu.
 *
 * KHÔNG sửa được số lượng — đổi số lượng là đụng kho, vẫn phải hoàn nhập.
 * Lý do: phiếu nhập 33, đã bán còn 32, sửa xuống 30 thì phải rút ra 3 đơn vị
 * không còn tồn tại → sổ âm.
 *
 * RPC 00234 chỉ CỘNG PHẦN CHÊNH chứ không tính lại tổng từ đầu, để không
 * làm xê dịch các phiếu cũ vốn đã có sai lệch lịch sử (3/40 phiếu).
 * Giá vốn KHÔNG đổi — hàng đã bán thì giá vốn đã chốt vào hoá đơn bán.
 */
export async function suaGiaPhieuNhap(input: {
  orderId: string;
  items: SuaGiaDongHang[];
  supplierId?: string | null;
  supplierName?: string | null;
  note?: string | null;
  shippingCost?: number | null;
  otherCost?: number | null;
  orderDiscount?: number | null;
}): Promise<KetQuaSuaPhieuNhap> {
  const supabase = getClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "update_purchase_order_prices",
    {
      p_order_id: input.orderId,
      p_items: input.items.map((i) => ({
        id: i.id,
        unit_price: i.unitPrice,
        discount: i.discount,
        vat_rate: i.vatRate,
      })),
      p_supplier_id: input.supplierId ?? null,
      p_supplier_name: input.supplierName ?? null,
      p_note: input.note ?? null,
      p_shipping_cost: input.shippingCost ?? null,
      p_other_cost: input.otherCost ?? null,
      p_order_discount: input.orderDiscount ?? null,
    },
  );
  if (error) handleError(error, "suaGiaPhieuNhap");

  const r = data as {
    so_dong_sua: number;
    tong_cu: number;
    tong_moi: number;
    chenh_lech: number;
    da_tra: number;
    con_no: number;
  } | null;
  if (!r) throw new Error("Không sửa được phiếu nhập — máy chủ không trả kết quả");

  return {
    soDongSua: r.so_dong_sua,
    tongCu: Number(r.tong_cu),
    tongMoi: Number(r.tong_moi),
    chenhLech: Number(r.chenh_lech),
    daTra: Number(r.da_tra),
    conNo: Number(r.con_no),
  };
}

// ============================================================
// Duplicate purchase order — clone existing PO → create new draft
// Sprint UX-1 Stage 3 (CEO 04/05/2026).
// ============================================================

/**
 * Sao chép purchase order → tạo PO mới với status='draft'.
 * Cùng supplier, items, expected_delivery → kế toán/thủ kho re-order
 * NCC nhanh.
 *
 * KHÔNG copy: paid, debt, received_quantity, status (mới = draft từ đầu).
 * Code mới qua next_code RPC.
 */
export async function duplicatePurchaseOrder(
  sourceOrderId: string,
): Promise<{ orderId: string; orderCode: string }> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const profile = await getCurrentContext();

  const { data: source, error } = await supabase
    .from("purchase_orders")
    .select("*, purchase_order_items(*)")
    .eq("tenant_id", tenantId)
    .eq("id", sourceOrderId)
    .single();
  if (error) handleError(error, "duplicatePurchaseOrder.source");
  if (!source) throw new Error("Không tìm thấy phiếu nhập để sao chép.");

  const sourceWithCosts = source as typeof source & {
    shipping_cost?: number | null;
    other_cost?: number | null;
    order_discount?: number | null;
  };
  const sourceItems = (sourceWithCosts.purchase_order_items ?? []) as Array<
    Record<string, unknown>
  >;
  if (sourceItems.length === 0) {
    throw new Error("Phiếu nguồn không có dòng hàng để sao chép.");
  }

  const saved = await savePurchaseOrderAtomic({
    branchId: profile.branchId,
    supplierId: source.supplier_id,
    note: source.note
      ? `[Sao chép từ ${source.code}] ${source.note}`
      : `[Sao chép từ ${source.code}]`,
    shippingCost: Number(sourceWithCosts.shipping_cost ?? 0),
    otherCost: Number(sourceWithCosts.other_cost ?? 0),
    orderDiscount: Number(sourceWithCosts.order_discount ?? 0),
    paidAmount: 0,
    markOrdered: false,
    receiveNow: false,
    items: sourceItems.map((item) => ({
      productId: String(item.product_id),
      quantity: Number(item.quantity ?? 0),
      unitPrice: Number(item.unit_price ?? 0),
      discount: Number(item.discount ?? 0),
      vatRate: Number(item.vat_rate ?? 0),
      expiryDate: item.expiry_date ? String(item.expiry_date) : null,
      lotNumber: item.lot_number ? String(item.lot_number) : null,
    })),
  });

  return { orderId: saved.orderId, orderCode: saved.code };
}

/* ------------------------------------------------------------------ */
/*  Day 2 16/05/2026: Đóng đơn nhập còn thiếu (won't receive)          */
/* ------------------------------------------------------------------ */

export interface ClosePurchaseOrderShortResult {
  success: boolean;
  orderId: string;
  code: string;
  itemsReceivedFully: number;
  itemsRemaining: number;
}

/**
 * Đóng đơn nhập ở trạng thái `partial` hoặc `ordered` mà KHÔNG nhận
 * thêm hàng (VD: NCC hết hàng, đổi NCC khác). Sau khi đóng:
 *   - status = "completed"
 *   - closed_short = true
 *   - close_reason = lý do (>= 5 ký tự)
 *   - audit_log entry "close_short"
 *
 * Khác `cancelled`: vẫn giữ nguyên số đã nhận, KHÔNG hoàn kho. Khác
 * `completed` thường: marker closed_short=true để báo cáo phân biệt được
 * "nhận đủ" vs "đóng còn thiếu".
 */
export async function closePurchaseOrderShort(
  orderId: string,
  reason: string,
): Promise<ClosePurchaseOrderShortResult> {
  const supabase = getClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "close_purchase_order_short",
    { p_order_id: orderId, p_reason: reason },
  );

  if (error) {
    if (isRpcUnavailable(error)) {
      throw new Error(
        "Chưa có RPC close_purchase_order_short. Vui lòng chạy migration 00075 trước.",
      );
    }
    const msg = (error.message ?? "").toString();
    if (msg.includes("INVALID_REASON")) {
      throw new Error("Lý do đóng đơn tối thiểu 5 ký tự.");
    }
    if (msg.includes("PO_NOT_FOUND")) {
      throw new Error("Không tìm thấy đơn nhập.");
    }
    if (msg.includes("INVALID_STATUS")) {
      throw new Error(
        msg.replace(/^[^:]*INVALID_STATUS:\s*/, "") ||
          "Đơn nhập không ở trạng thái phù hợp để đóng còn thiếu.",
      );
    }
    handleError(error, "closePurchaseOrderShort");
  }

  if (!data || !(data as { success?: boolean }).success) {
    throw new Error("Server không trả kết quả đóng đơn hợp lệ.");
  }

  const result = data as {
    success: boolean;
    order_id: string;
    code: string;
    items_received_fully: number;
    items_remaining: number;
  };

  return {
    success: result.success,
    orderId: result.order_id,
    code: result.code,
    itemsReceivedFully: result.items_received_fully,
    itemsRemaining: result.items_remaining,
  };
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
    branchId: row.branch_id ?? undefined,
  };
}
