/**
 * Supabase service: Sales Orders (Đơn hàng)
 *
 * Two responsibilities:
 *
 *   1. `getOrders` / `getOrderStatuses` — real Supabase queries against
 *      the `sales_orders` table (migration 00012).
 *
 *   2. NEW (POS sprint): thin wrapper around `posCheckout` plus draft
 *      order management. POS uses the existing `invoices` + `invoice_items`
 *      schema (status=draft → status=completed) instead of a new table,
 *      per sprint plan M1 (see serene-toasting-quilt.md).
 *
 *      - `saveDraftOrder`      (F9 — no stock change)
 *      - `listDraftOrders`     (load saved drafts)
 *      - `completeDraftOrder`  (F10 on a draft — trigger stock + cash)
 *      - `deleteDraftOrder`    (cleanup)
 *      - `posCheckout`         (re-export — F10 on a fresh cart)
 */

import type { SalesOrder, QueryParams, QueryResult } from "@/lib/types";
import { getClient, getPaginationRange, handleError, getCurrentTenantId, getCurrentContext } from "./base";
import {
  posCheckout,
  type PosCheckoutInput,
  type PosCheckoutResult,
  type PosCheckoutItem,
} from "./pos-checkout";
import { recordAuditLog } from "./audit";
import { applyCreatedAtRangeFilter } from "@/lib/utils/list-date-preset-range";

// ============================================================
// Sales Orders — real Supabase queries against `sales_orders`
// ============================================================

const STATUS_LABEL: Record<string, string> = {
  draft: "Chờ xử lý",
  new: "Mới",
  confirmed: "Đã xác nhận",
  delivering: "Đang giao",
  completed: "Hoàn thành",
  cancelled: "Đã hủy",
};

/** Các trạng thái invoices hợp lệ để lọc từ UI (chặn giá trị lạ). */
const VALID_ORDER_STATUSES = new Set([
  "draft",
  "confirmed",
  "delivering",
  "completed",
  "cancelled",
]);

export async function getOrders(
  params: QueryParams
): Promise<QueryResult<SalesOrder>> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const { from, to } = getPaginationRange(params);

  // CEO 08/07/2026: "Đơn đặt hàng" = hóa đơn có source='order' (marker do
  // create-order-dialog gắn). GIỮ đơn qua MỌI trạng thái (Chờ xử lý → Hoàn
  // thành → Đã hủy) như KiotViet — trước đây lọc status='draft' nên đơn hoàn
  // tất rớt khỏi list. Đơn hoàn thành vẫn hiện ở CẢ trang Hóa đơn (chủ đích).
  // Bảng sales_orders là hệ CŨ (0 dữ liệu, không nút nào ghi vào).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from("invoices")
    .select(
      "*, profiles!invoices_created_by_fkey(full_name), branches!invoices_branch_id_fkey(name)",
      { count: "exact" },
    )
    .eq("tenant_id", tenantId)
    .eq("source", "order")
    // 00173: ẩn đơn đã xóa mềm (đơn đặt hàng vốn KHÔNG bị xóa — guard cho chắc).
    .is("deleted_at", null);

  // Lọc trạng thái (tùy chọn) — UI truyền mảng qua filters.status. Chỉ nhận
  // giá trị hợp lệ; rỗng/không hợp lệ → không lọc (hiện tất cả trạng thái).
  const statusFilter = params.filters?.status;
  if (statusFilter) {
    const statuses = (Array.isArray(statusFilter) ? statusFilter : [statusFilter])
      .filter((s) => VALID_ORDER_STATUSES.has(s));
    if (statuses.length > 0) query = query.in("status", statuses);
  }

  // CEO 14/07: đơn đã xuất hóa đơn (fulfilled_by_id) không còn là "chưa xử lý".
  // KHÔNG lọc ở query (cột thêm ở 00188 — lọc server .is() sẽ LỖI nếu migration
  // chưa chạy). POS "Xử lý đặt hàng" lọc client-side theo o.fulfilledById cho an
  // toàn cả trước/sau migration (trước: cột thiếu → fulfilledById undefined →
  // không loại gì, cũng đúng vì chưa có đơn nào fulfilled).

  // Search by mã hoặc tên khách. Escape % để tránh wildcard injection.
  if (params.search) {
    const esc = params.search.replace(/[%_]/g, "\\$&");
    if (params.searchField === "code") query = query.ilike("code", `%${esc}%`);
    else if (params.searchField === "customer_name")
      query = query.ilike("customer_name", `%${esc}%`);
    else
      query = query.or(`code.ilike.%${esc}%,customer_name.ilike.%${esc}%`);
  }

  // Filter: khoảng ngày (created_at) — timezone-safe. FIX (CEO 08/07): trang có
  // ô "Thời gian" nhưng trước đây KHÔNG áp ngày; nay truyền dateFrom/dateTo.
  query = applyCreatedAtRangeFilter(query, params.filters);

  // Filter: branch (falsy = tất cả chi nhánh).
  if (params.branchId) {
    query = query.eq("branch_id", params.branchId);
  }

  // Sort & paginate
  query = query
    .order("created_at", { ascending: false })
    .range(from, to);

  const { data, count, error } = await query;
  if (error) handleError(error, "getOrders");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orders: SalesOrder[] = (data ?? []).map((row: any) => {
    const profile = row.profiles as { full_name: string } | null;
    const branch = row.branches as { name: string } | null;
    return {
      id: row.id,
      // CEO 10/07: hiện MÃ ĐƠN gốc (DH). Trước hoàn tất code=DH; sau hoàn tất
      // code=HD nhưng order_code giữ DH → luôn hiện DH ở trang Đơn đặt hàng.
      code: row.order_code ?? row.code,
      // Mã hóa đơn thật (HD) khi đã hoàn tất — để đối chiếu / mở hóa đơn.
      invoiceCode: row.order_code ? row.code : undefined,
      date: row.created_at,
      customerName: row.customer_name ?? "",
      customerPhone: row.customer_phone ?? "",
      totalAmount: row.total ?? 0,
      // Phí giao = cột delivery_fee (invoices KHÔNG có shipping_fee).
      shippingFee: Number(row.delivery_fee ?? 0),
      // Số đã thu / còn phải thu — để thẻ "Tổng cần thu" tính đúng theo trạng
      // thái (đơn hoàn thành đã trả → debt=0 → không cộng vào cần thu).
      paid: Number(row.paid ?? 0),
      debt: Number(row.debt ?? 0),
      status: row.status,
      statusName: STATUS_LABEL[row.status] ?? row.status ?? "",
      // CEO 14/07: link tới hóa đơn đã xuất (nếu có) — hiện "Đã xuất hóa đơn".
      fulfilledById: row.fulfilled_by_id ?? undefined,
      // Ghi chú người bán — in trên phiếu đặt hàng (CEO 08/07).
      note: row.note ?? undefined,
      createdBy: row.created_by ?? "",
      createdByName: profile?.full_name ?? "",
      branchId: row.branch_id ?? undefined,
      branchName: branch?.name ?? undefined,
    };
  });

  // CEO 14/07: lấy mã HĐ đã xuất cho các đơn fulfilled (hiện trên badge "Đã
  // xuất hóa đơn"). Chỉ query khi thực sự có đơn fulfilled (hiếm).
  const fulfilledIds = [
    ...new Set(orders.map((o) => o.fulfilledById).filter(Boolean)),
  ] as string[];
  if (fulfilledIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: hd } = await (supabase as any)
      .from("invoices")
      .select("id, code")
      .in("id", fulfilledIds);
    const codeById = new Map<string, string>(
      (hd ?? []).map((r: { id: string; code: string }) => [r.id, r.code]),
    );
    for (const o of orders) {
      if (o.fulfilledById) {
        o.fulfilledInvoiceCode = codeById.get(o.fulfilledById) ?? undefined;
      }
    }
  }

  return { data: orders, total: count ?? 0 };
}

export function getOrderStatuses() {
  return [
    { value: "all", label: "Tất cả" },
    { value: "new", label: "Mới" },
    { value: "confirmed", label: "Đã xác nhận" },
    { value: "delivering", label: "Đang giao" },
    { value: "completed", label: "Hoàn thành" },
    { value: "cancelled", label: "Đã hủy" },
  ];
}

// ============================================================
// Complete Sales Order → auto Invoice + Stock + Cash
// ============================================================

/**
 * Hoàn thành đơn hàng bán (sales_orders):
 *   1. Atomic claim: UPDATE status='completed' WHERE status IN (confirmed, delivering)
 *   2. Load sales_order_items
 *   3. Create invoice (completed) + invoice_items
 *   4. Decrement stock via applyStockDecrement
 *   5. Create cash receipt via createAutoCashReceipt
 *
 * Kết quả: 1 sales order → 1 invoice + stock trừ + sổ quỹ ghi phiếu thu.
 */
export async function completeSalesOrder(
  orderId: string,
): Promise<{ invoiceId: string; invoiceCode: string }> {
  const supabase = getClient();
  const { data, error } = await (supabase.rpc as any)(
    "complete_legacy_sales_order_atomic",
    { p_order_id: orderId },
  );
  if (error) handleError(error, "completeSalesOrder");
  const result = data as Record<string, unknown> | null;
  if (!result?.invoice_id || !result.invoice_code) {
    throw new Error("Máy chủ không trả về hóa đơn hoàn tất hợp lệ.");
  }
  return {
    invoiceId: String(result.invoice_id),
    invoiceCode: String(result.invoice_code),
  };
}

// ============================================================
// Cancel Sales Order
// ============================================================

export async function cancelSalesOrder(orderId: string): Promise<void> {
  const supabase = getClient();
  const { error } = await (supabase.rpc as any)(
    "cancel_legacy_sales_order_atomic",
    {
      p_order_id: orderId,
      p_reason: "Hủy từ giao diện đơn hàng",
    },
  );
  if (error) handleError(error, "cancelSalesOrder");
}

// ============================================================
// Re-export from pos-checkout for convenience
// ============================================================
export { posCheckout };
export type { PosCheckoutInput, PosCheckoutResult, PosCheckoutItem };

/**
 * Lấy line items của một sales order cho detail panel.
 *
 * Trước đây panel detail render hardcoded "SP001 — Sản phẩm mẫu" cho
 * MỌI đơn → user nhìn không biết đơn này gồm SP gì.
 */
export interface SalesOrderItemRow {
  id: string;
  productCode: string;
  productName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  total: number;
  /** 00208: ghi chú từng món. */
  note?: string;
}

export async function getSalesOrderItems(
  orderId: string,
): Promise<SalesOrderItemRow[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // Verify order thuộc tenant trước (defense-in-depth)
  const { data: order } = await supabase
    .from("sales_orders")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return [];

  const { data, error } = await supabase
    .from("sales_order_items")
    .select(
      "id, product_id, product_name, unit, quantity, unit_price, discount, total, products!sales_order_items_product_id_fkey(code)",
    )
    .eq("order_id", orderId);

  if (error) {
    console.warn("[getSalesOrderItems]", error.message);
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any) => ({
    id: row.id,
    productCode: row.products?.code ?? "",
    productName: row.product_name ?? "",
    unit: row.unit ?? "",
    quantity: Number(row.quantity ?? 0),
    unitPrice: Number(row.unit_price ?? 0),
    discount: Number(row.discount ?? 0),
    total: Number(row.total ?? 0),
  }));
}

/**
 * CEO 08/07/2026: Item của 1 "đơn đặt hàng" = invoice_items (vì đơn = hóa đơn
 * nháp). Dùng cho panel chi tiết + in đơn ở trang Đơn đặt hàng.
 */
export async function getDraftOrderItems(
  invoiceId: string,
): Promise<SalesOrderItemRow[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // Verify hóa đơn thuộc tenant trước (defense-in-depth)
  const { data: inv } = await supabase
    .from("invoices")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", invoiceId)
    .maybeSingle();
  if (!inv) return [];

  // 00208: select("*") để lấy cả note mà không vỡ khi cột chưa migrate.
  const { data, error } = await supabase
    .from("invoice_items")
    .select("*")
    .eq("invoice_id", invoiceId);

  if (error) {
    console.warn("[getDraftOrderItems]", error.message);
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any) => ({
    id: row.id,
    productCode: "",
    productName: row.product_name ?? "",
    unit: row.unit ?? "",
    quantity: Number(row.quantity ?? 0),
    unitPrice: Number(row.unit_price ?? 0),
    discount: Number(row.discount ?? 0),
    total: Number(row.total ?? 0),
    note: row.note ?? undefined, // 00208
  }));
}

// ============================================================
// Types
// ============================================================

export interface DraftOrderSummary {
  id: string;
  code: string;
  customerId: string | null;
  customerName: string;
  total: number;
  subtotal: number;
  discountAmount: number;
  itemCount: number;
  note: string | null;
  createdAt: string;
  /** CEO 04/05/2026: thông tin cho recovery dialog. */
  updatedAt?: string;
  /** Tên cashier đã tạo nháp này (dùng trong recovery list). */
  createdByName?: string;
  /** Danh sách 3 tên SP đầu tiên — preview ngắn cho recovery card. */
  itemsSummary?: string[];
  /** TRUE = auto-save background, FALSE = F9 manual sticky. */
  autoSaved?: boolean;
  /** UUID idempotency key — client store để tiếp tục auto-save sau khi load. */
  clientSessionId?: string | null;
  /** 'order' = đơn đặt hàng (POS hiện banner riêng, không xóa nhầm). */
  source?: string | null;
  /** Phí giao hàng (invoices.delivery_fee) — dùng khi mở sửa đơn. */
  deliveryFee?: number;
}

export interface DraftOrderDetail extends DraftOrderSummary {
  branchId: string;
  items: Array<{
    id: string;
    productId: string;
    variantId?: string;
    productName: string;
    unit: string;
    quantity: number;
    unitPrice: number;
    discount: number;
    total: number;
    /** 00208: ghi chú riêng từng mã hàng — giữ khi mở lại đơn để sửa. */
    note?: string;
  }>;
}

export interface SaveSalesOrderItemInput {
  productId: string;
  quantity: number;
  unitPrice: number;
  note?: string | null;
}

export interface SaveSalesOrderInput {
  orderId?: string | null;
  requestedCode?: string | null;
  branchId: string;
  customerId?: string | null;
  deliveryFee?: number;
  note?: string | null;
  partnerId?: string | null;
  receiverName?: string | null;
  receiverPhone?: string | null;
  receiverAddress?: string | null;
  items: SaveSalesOrderItemInput[];
}

export interface SaveSalesOrderResult {
  orderId: string;
  orderCode: string;
  total: number;
  shipmentId: string | null;
  shipmentCode: string | null;
  created: boolean;
}

export async function saveSalesOrderAtomic(
  input: SaveSalesOrderInput,
): Promise<SaveSalesOrderResult> {
  const supabase = getClient();
  const { data, error } = await (supabase.rpc as any)(
    "save_sales_order_atomic",
    {
      p_order_id: input.orderId ?? null,
      p_requested_code: input.requestedCode ?? null,
      p_branch_id: input.branchId,
      p_customer_id: input.customerId ?? null,
      p_items: input.items.map((item) => ({
        product_id: item.productId,
        quantity: Number(item.quantity),
        unit_price: Number(item.unitPrice),
        note: item.note ?? null,
      })),
      p_delivery_fee: Number(input.deliveryFee ?? 0),
      p_note: input.note ?? null,
      p_partner_id: input.partnerId ?? null,
      p_receiver_name: input.receiverName ?? null,
      p_receiver_phone: input.receiverPhone ?? null,
      p_receiver_address: input.receiverAddress ?? null,
    },
  );
  if (error) handleError(error, "saveSalesOrderAtomic");

  const result = data as Record<string, unknown> | null;
  if (!result?.order_id || !result.order_code) {
    throw new Error("Máy chủ không trả về kết quả lưu đơn đặt hàng hợp lệ.");
  }
  return {
    orderId: String(result.order_id),
    orderCode: String(result.order_code),
    total: Number(result.total ?? 0),
    shipmentId: result.shipment_id ? String(result.shipment_id) : null,
    shipmentCode: result.shipment_code ? String(result.shipment_code) : null,
    created: Boolean(result.created),
  };
}

// ============================================================
// F9 — Save draft (no stock change, no cash transaction)
// ============================================================

/**
 * Create a new invoice with status='draft'.
 * - Generates invoice code via RPC `next_code('invoice')`.
 * - Inserts invoice + invoice_items.
 * - Does NOT touch products.stock, stock_movements, or cash_transactions.
 *
 * Stock/cash side-effects are deferred to `completeDraftOrder`.
 *
 * CEO 04/05/2026 — Auto-save & recovery upgrade (Sprint POS-RECOVERY-1):
 * - Param `options.sessionId` (UUID) làm anchor: nếu đã có draft với
 *   session_id này → UPDATE in-place. Nếu chưa → INSERT mới.
 * - `options.autoSaved=true` cho auto-save background (TTL 30 ngày qua
 *   cleanup_expired_auto_drafts). False = F9 manual (giữ vĩnh viễn).
 * - sessionId KHÔNG truyền → behavior cũ (INSERT mỗi lần — F9 cổ điển).
 */
export async function saveDraftOrder(
  input: PosCheckoutInput,
  options?: {
    /** UUID anchor — upsert by (tenant_id, client_session_id). */
    sessionId?: string;
    /** TRUE = auto-save background (TTL 30d). FALSE = F9 manual sticky. */
    autoSaved?: boolean;
  },
): Promise<{ invoiceId: string; invoiceCode: string }> {
  const supabase = getClient();
  const { data, error } = await (supabase.rpc as any)(
    "save_pos_draft_atomic",
    {
      p_branch_id: input.branchId,
      p_customer_id: input.customerId ?? null,
      p_items: input.items,
      p_payment_method: input.paymentMethod,
      p_subtotal: input.subtotal,
      p_discount_amount: input.discountAmount,
      p_total: input.total,
      p_shipping_fee: input.shippingFee ?? 0,
      p_note: input.note ?? null,
      p_client_session_id: options?.sessionId ?? null,
      p_auto_saved: options?.autoSaved ?? false,
    },
  );
  if (error) handleError(error, "saveDraftOrder.atomic");

  const result = data as Record<string, unknown> | null;
  if (!result?.invoice_id || !result.invoice_code) {
    throw new Error("Máy chủ không trả về kết quả lưu đơn nháp hợp lệ.");
  }
  return {
    invoiceId: String(result.invoice_id),
    invoiceCode: String(result.invoice_code),
  };
}

// ============================================================
// List drafts — for resume picker
// ============================================================

/**
 * List draft invoices (status='draft') for a given branch.
 * Returns a lightweight summary — includes item count via a second query
 * (Supabase PostgREST doesn't easily support COUNT subqueries in a single
 * round-trip without an RPC).
 */
export async function listDraftOrders(
  branchId?: string,
  limit: number = 50,
): Promise<DraftOrderSummary[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // Sort by updated_at DESC để recovery dialog hiện nháp mới nhất lên đầu
  // (auto-save liên tục refresh updated_at qua trigger handle_updated_at).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from("invoices")
    .select(
      "id, code, customer_id, customer_name, total, subtotal, discount_amount, note, created_at, updated_at, auto_saved, client_session_id, created_by, profiles!invoices_created_by_fkey(full_name), invoice_items(product_name)",
    )
    .eq("tenant_id", tenantId)
    .eq("status", "draft")
    // 00173: ẩn đơn xóa mềm + KHÔNG trộn đơn đặt hàng (source='order') vào list
    // nháp POS — tránh xóa nhầm; đơn đặt hàng quản ở trang Đặt hàng. source có
    // thể NULL (nháp cũ) nên dùng (is null OR neq order).
    .is("deleted_at", null)
    .or("source.is.null,source.neq.order")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (branchId) query = query.eq("branch_id", branchId);

  const { data, error } = await query;
  if (error) handleError(error, "listDraftOrders");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any) => {
    const items = Array.isArray(row.invoice_items) ? row.invoice_items : [];
    const profile = row.profiles as { full_name?: string } | null;
    return {
      id: row.id,
      code: row.code,
      customerId: row.customer_id,
      customerName: row.customer_name ?? "Khách lẻ",
      total: row.total ?? 0,
      subtotal: row.subtotal ?? 0,
      discountAmount: row.discount_amount ?? 0,
      itemCount: items.length,
      note: row.note,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      createdByName: profile?.full_name ?? undefined,
      // 3 tên SP đầu cho preview card (recovery dialog)
      itemsSummary: items
        .slice(0, 3)
        .map((it: { product_name?: string }) => it.product_name ?? "")
        .filter(Boolean),
      autoSaved: row.auto_saved ?? false,
      clientSessionId: row.client_session_id ?? null,
    };
  });
}

/**
 * Load a single draft invoice with its items — used when the cashier
 * re-opens a draft to finish checkout.
 */
export async function getDraftOrderById(
  invoiceId: string
): Promise<DraftOrderDetail | null> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("invoices")
    .select(
      "id, code, branch_id, customer_id, customer_name, subtotal, discount_amount, delivery_fee, total, note, created_at, updated_at, status, auto_saved, client_session_id, source, invoice_items(*)",
    )
    .eq("tenant_id", tenantId)
    .eq("id", invoiceId)
    // 00173: không mở lại đơn đã xóa mềm.
    .is("deleted_at", null)
    .single();
  if (error) handleError(error, "getDraftOrderById");
  if (!data) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = data as any;
  return {
    id: raw.id,
    code: raw.code,
    branchId: raw.branch_id,
    customerId: raw.customer_id,
    customerName: raw.customer_name ?? "Khách lẻ",
    subtotal: raw.subtotal ?? 0,
    discountAmount: raw.discount_amount ?? 0,
    total: raw.total ?? 0,
    itemCount: Array.isArray(raw.invoice_items) ? raw.invoice_items.length : 0,
    note: raw.note,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    autoSaved: raw.auto_saved ?? false,
    clientSessionId: raw.client_session_id ?? null,
    source: raw.source ?? null,
    deliveryFee: Number(raw.delivery_fee ?? 0),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    items: (raw.invoice_items ?? []).map((it: any) => ({
      id: it.id,
      productId: it.product_id,
      variantId: it.variant_id ?? undefined,
      productName: it.product_name,
      unit: it.unit ?? "Cái",
      quantity: it.quantity,
      unitPrice: it.unit_price,
      discount: it.discount ?? 0,
      total: it.total ?? 0,
      note: it.note ?? undefined, // 00208 — kẻo mở nháp rớt ghi chú món
    })),
  };
}

/**
 * CEO 08/07/2026 — VÁ BUG TRÙNG ĐƠN + NỢ ẢO.
 *
 * Đơn nháp tạo từ dialog "Đặt hàng" (Đơn đặt hàng) KHÔNG có `client_session_id`
 * (không qua phiên POS). Khi nhân viên mở đơn đó trong POS (?draftId) để chuyển
 * thành hóa đơn rồi SỬA → `useAutoSaveDraft` chạy `saveDraftOrder` với session
 * POS mới → KHÔNG khớp `client_session_id` của đơn → TẠO NHÁP MỚI (mã mới) →
 * `setLoadedDraftId` trỏ sang nháp mới → Thanh toán hoàn tất NHÁP MỚI, đơn gốc
 * KẸT "phiếu tạm" → 2 đơn trùng + nợ ảo (đơn gốc vẫn cộng nợ KH qua trigger 00130).
 *
 * Fix: khi mở 1 đơn nháp CHƯA có session vào POS → GẮN session hiện tại vào đơn
 * → auto-save UPDATE đúng đơn này, completeDraftOrder hoàn tất đúng đơn này (giữ
 * nguyên mã). Chỉ set khi status còn 'draft' (không đụng hóa đơn đã hoàn tất).
 */
export async function adoptDraftSession(
  invoiceId: string,
  sessionId: string,
): Promise<void> {
  if (!invoiceId || !sessionId) return;
  const supabase = getClient();
  const { data, error } = await (supabase.rpc as any)(
    "adopt_pos_draft_session_atomic",
    { p_invoice_id: invoiceId, p_client_session_id: sessionId },
  );
  if (error) handleError(error, "adoptDraftSession.atomic");
  const result = data as Record<string, unknown> | null;
  if (!result?.invoice_id) {
    throw new Error("Máy chủ không xác nhận phiên của đơn nháp.");
  }
}

// ============================================================
// F10 on a draft — convert draft → completed
// ============================================================

/**
 * Convert a saved draft invoice into a completed sale:
 *  1. Load invoice + items
 *  2. Validate status === 'draft'
 *  3. UPDATE invoices (status='completed', paid, debt, payment_method)
 *  4. applyStockDecrement (stock_movements + products.stock)
 *  5. createAutoCashReceipt (if paid > 0)
 */
/**
 * CEO 29/05/2026: Tìm đơn nháp (status='draft') theo client_session_id.
 * Dùng ở POS handleComplete: nếu loadedDraftId chưa kịp set (auto-save vừa tạo
 * draft) → tra theo session để hoàn tất ĐÚNG đơn nháp đó (completeDraftOrder)
 * thay vì posCheckout (server sẽ từ chối "still draft" → kẹt nháp).
 * Best-effort: lỗi → trả null để checkout đi nhánh thường.
 */
export async function findDraftIdBySession(sessionId: string): Promise<string | null> {
  if (!sessionId) return null;
  try {
    const supabase = getClient();
    const tenantId = await getCurrentTenantId();
    // client_session_id chưa có trong Supabase generated types (migration 00048
    // chưa regen) → cast any cho query filter.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("invoices")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("client_session_id", sessionId)
      .eq("status", "draft")
      // 00173: bỏ qua đơn đã xóa mềm.
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return null;
    return (data?.id as string) ?? null;
  } catch {
    return null;
  }
}

export async function completeDraftOrder(
  invoiceId: string,
  payment: {
    method: "cash" | "transfer" | "card" | "mixed";
    paid: number;
    tenantId: string;
    branchId: string;
    createdBy: string;
    customerId?: string | null;
    items: PosCheckoutItem[];
    paymentBreakdown?: import("./pos-checkout").PaymentBreakdownItem[];
    shiftId?: string | null;
    promotionId?: string | null;
    couponCode?: string | null;
    loyaltyPoints?: number;
    discountSource?: PosCheckoutInput["discountSource"];
    orderDiscountAmount?: number;
    discountOtpId?: string | null;
    discountReason?: string | null;
    shippingFee?: number;
    orderVatRate?: number;
    amountTendered?: number | null;
    customerCredit?: number;
    allowBomShortage?: boolean;
  },
): Promise<{
  invoiceCode: string;
  total?: number;
  paid?: number;
  debt?: number;
  taxAmount?: number;
  discountAmount?: number;
}> {
  const supabase = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "complete_draft_atomic_v4",
    {
      p_invoice_id: invoiceId,
      p_customer_id: payment.customerId ?? null,
      p_items: payment.items,
      p_method: payment.method,
      p_paid: payment.paid,
      p_payment_breakdown: payment.paymentBreakdown ?? null,
      p_shift_id: payment.shiftId ?? null,
      p_promotion_id: payment.promotionId ?? null,
      p_coupon_code: payment.couponCode ?? null,
      p_loyalty_points: payment.loyaltyPoints ?? 0,
      p_discount_source: payment.discountSource ?? null,
      p_order_discount: payment.orderDiscountAmount ?? 0,
      p_discount_otp_id: payment.discountOtpId ?? null,
      p_discount_reason: payment.discountReason ?? null,
      p_shipping_fee: payment.shippingFee ?? 0,
      p_order_vat_rate: payment.orderVatRate ?? 0,
      p_allow_bom_shortage: payment.allowBomShortage ?? false,
      p_amount_tendered: payment.amountTendered ?? payment.paid,
      p_customer_credit: payment.customerCredit ?? 0,
    },
  );

  if (error) {
    if (
      error.message === "POS_PRICE_CHANGED" ||
      error.message === "POS_DISCOUNT_CHANGED"
    ) {
      throw new Error(`${error.message}|${error.details ?? "{}"}`);
    }
    if (
      error.code === "PGRST202" ||
      /complete_draft_atomic_v4|schema cache/i.test(error.message)
    ) {
      throw new Error(
        "Chưa có migration 00253. Không thể thanh toán đơn nháp an toàn.",
      );
    }
    handleError(error, "completeDraftOrder:atomic_v4");
  }

  const result = data as {
    invoice_code?: string;
    total?: number;
    paid?: number;
    debt?: number;
    tax_amount?: number;
    discount_amount?: number;
  } | null;
  if (!result?.invoice_code) {
    throw new Error("Phản hồi thanh toán thiếu mã hóa đơn.");
  }
  return {
    invoiceCode: result.invoice_code,
    total: result.total,
    paid: result.paid,
    debt: result.debt,
    taxAmount: result.tax_amount,
    discountAmount: result.discount_amount,
  };
}

// ============================================================
// Delete draft (SOFT-delete — 00173; never touches completed or đơn đặt hàng)
// ============================================================

export async function deleteDraftOrder(
  invoiceId: string,
  opts?: { onlyAutoSaved?: boolean },
): Promise<void> {
  const supabase = getClient();
  const { data, error } = await (supabase.rpc as any)(
    "soft_delete_pos_draft_atomic",
    {
      p_invoice_id: invoiceId,
      p_only_auto_saved: opts?.onlyAutoSaved ?? false,
    },
  );
  if (error) handleError(error, "deleteDraftOrder.atomic");
  if (!data) {
    throw new Error("Máy chủ không trả về kết quả xử lý đơn nháp.");
  }
}

// ============================================================
// Duplicate invoice — clone existing invoice → create new draft
// Sprint UX-1 Stage 3 (CEO 04/05/2026): Sao chép action top user request.
// Lý do: kế toán thường tạo phiếu giống tháng trước, chỉ đổi vài thông số.
// ============================================================

/**
 * Sao chép invoice (bất kỳ status nào) → tạo invoice DRAFT mới với cùng
 * customer, items, payment method, note. Status mới = 'draft' để cashier
 * sửa trước khi finalize.
 *
 * KHÔNG sao chép: paid, debt, audit_log (mới = chưa thanh toán + chưa
 * có lịch sử). Code mới qua next_code RPC.
 *
 * Trả về { invoiceId, invoiceCode } của bản copy mới — caller có thể
 * router.push("/don-hang/hoa-don?id=" + id) để mở edit ngay.
 */
export async function duplicateInvoice(
  sourceInvoiceId: string,
): Promise<{ invoiceId: string; invoiceCode: string }> {
  const supabase = getClient();
  const context = await getCurrentContext();
  const { data, error } = await (supabase.rpc as any)(
    "duplicate_invoice_to_order_atomic",
    {
      p_source_invoice_id: sourceInvoiceId,
      p_target_branch_id: context.branchId,
    },
  );
  if (error) handleError(error, "duplicateInvoice");

  const result = data as Record<string, unknown> | null;
  if (!result?.invoice_id || !result.invoice_code) {
    throw new Error("Máy chủ không trả về bản sao hóa đơn hợp lệ.");
  }
  return {
    invoiceId: String(result.invoice_id),
    invoiceCode: String(result.invoice_code),
  };
}
