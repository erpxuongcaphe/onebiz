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
import { getClient, getPaginationRange, handleError, getCurrentTenantId } from "./base";
import { isRpcUnavailable } from "./rpc-utils";
import {
  posCheckout,
  applyStockDecrement,
  createAutoCashReceipt,
  type PosCheckoutInput,
  type PosCheckoutResult,
  type PosCheckoutItem,
} from "./pos-checkout";
import { recordAuditLog } from "./audit";
import { applyCreatedAtRangeFilter } from "@/lib/utils/list-date-preset-range";
import type { Database } from "@/lib/supabase/types";

type InvoiceInsert = Database["public"]["Tables"]["invoices"]["Insert"];
type InvoiceItemInsert = Database["public"]["Tables"]["invoice_items"]["Insert"];

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

  // CEO 14/07: đơn đã xuất hóa đơn (fulfilled_by_id) KHÔNG còn là đơn "chưa xử
  // lý" — POS "Xử lý đặt hàng" truyền excludeFulfilled để không nạp lại đơn đã
  // bán (chống xử lý trùng). Trang Đơn đặt hàng KHÔNG truyền → vẫn hiện (badge).
  if (params.filters?.excludeFulfilled) {
    query = query.is("fulfilled_by_id", null);
  }

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
  orderId: string
): Promise<{ invoiceId: string; invoiceCode: string }> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // 1. ATOMIC claim — flip sales_order status
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const { data: claimed, error: claimErr } = await sb
    .from("sales_orders")
    .update({ status: "completed" })
    .eq("tenant_id", tenantId)
    .eq("id", orderId)
    .in("status", ["confirmed", "delivering"])
    .select("id, code, customer_id, customer_name, total, tenant_id, branch_id, created_by")
    .maybeSingle();
  if (claimErr) handleError(claimErr, "completeSalesOrder:claim");
  if (!claimed) {
    const { data: existing } = await sb
      .from("sales_orders")
      .select("status")
      .eq("tenant_id", tenantId)
      .eq("id", orderId)
      .single();
    if (!existing) throw new Error("Không tìm thấy đơn hàng bán");
    throw new Error(
      `Đơn hàng đã được xử lý (trạng thái: ${existing.status}). Không thể hoàn tất lại.`
    );
  }
  const order = claimed;

  // 2. Load sales_order_items — scope qua order_id (đã verify ownership ở step 1)
  const { data: soItems, error: soItemsErr } = await sb
    .from("sales_order_items")
    .select("id, product_id, product_name, unit, quantity, unit_price, discount, total")
    .eq("order_id", orderId);
  if (soItemsErr) handleError(soItemsErr, "completeSalesOrder:items");
  if (!soItems || soItems.length === 0) {
    throw new Error("Đơn hàng không có sản phẩm nào");
  }

  // 3. Create invoice (completed)
  const { data: invCode, error: codeErr } = await supabase.rpc("next_code", {
    p_tenant_id: order.tenant_id,
    p_entity_type: "invoice",
  });
  if (codeErr) handleError(codeErr, "completeSalesOrder:invoice_code");
  const invoiceCode = invCode ?? `HD${Date.now()}`;

  const totalAmount = Number(order.total ?? 0);

  const invoiceData: InvoiceInsert = {
    tenant_id: order.tenant_id,
    branch_id: order.branch_id,
    code: invoiceCode,
    customer_id: order.customer_id ?? null,
    customer_name: order.customer_name || "Khách lẻ",
    status: "completed",
    subtotal: totalAmount,
    discount_amount: 0,
    total: totalAmount,
    paid: totalAmount,
    debt: 0,
    payment_method: "cash",
    note: `Tạo tự động từ đơn hàng ${order.code}`,
    created_by: order.created_by,
  };

  const { data: invoice, error: invErr } = await supabase
    .from("invoices")
    .insert(invoiceData)
    .select("id, code")
    .single();
  if (invErr) handleError(invErr, "completeSalesOrder:invoice_insert");
  if (!invoice) throw new Error("Không tạo được hóa đơn");

  // 4. Create invoice_items from SO items
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const invoiceItems: InvoiceItemInsert[] = (soItems as any[]).map((it: any) => ({
    invoice_id: invoice.id,
    product_id: it.product_id,
    product_name: it.product_name ?? "",
    unit: it.unit ?? "Cái",
    quantity: Number(it.quantity ?? 0),
    unit_price: Number(it.unit_price ?? 0),
    discount: Number(it.discount ?? 0),
    total: Number(it.total ?? 0),
  }));

  const { error: iiErr } = await supabase.from("invoice_items").insert(invoiceItems);
  if (iiErr) handleError(iiErr, "completeSalesOrder:invoice_items");

  // 5. Decrement stock
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const checkoutItems: PosCheckoutItem[] = (soItems as any[]).map((it: any) => ({
    productId: it.product_id,
    productName: it.product_name ?? "",
    unit: it.unit ?? "Cái",
    quantity: Number(it.quantity ?? 0),
    unitPrice: Number(it.unit_price ?? 0),
    discount: Number(it.discount ?? 0),
  }));

  await applyStockDecrement(supabase, invoice.id, checkoutItems, {
    tenantId: order.tenant_id,
    branchId: order.branch_id,
    createdBy: order.created_by,
    invoiceCode: invoice.code,
  });

  // 6. Auto cash receipt
  await createAutoCashReceipt(
    supabase,
    invoice.id,
    invoice.code,
    totalAmount,
    "cash",
    {
      tenantId: order.tenant_id,
      branchId: order.branch_id,
      createdBy: order.created_by,
      customerName: order.customer_name || "Khách lẻ",
    }
  );

  return { invoiceId: invoice.id, invoiceCode: invoice.code };
}

// ============================================================
// Cancel Sales Order
// ============================================================

export async function cancelSalesOrder(orderId: string): Promise<void> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  // Snapshot trước khi flip để có data cho audit log
  const { data: prev } = await sb
    .from("sales_orders")
    .select("code, customer_name, total, status")
    .eq("tenant_id", tenantId)
    .eq("id", orderId)
    .maybeSingle();

  const { data: claimed, error: claimErr } = await sb
    .from("sales_orders")
    .update({ status: "cancelled" })
    .eq("tenant_id", tenantId)
    .eq("id", orderId)
    .in("status", ["new", "confirmed"])
    .select("id")
    .maybeSingle();
  if (claimErr) handleError(claimErr, "cancelSalesOrder");
  if (!claimed) {
    const { data: existing } = await sb
      .from("sales_orders")
      .select("status")
      .eq("tenant_id", tenantId)
      .eq("id", orderId)
      .single();
    if (!existing) throw new Error("Không tìm thấy đơn hàng bán");
    throw new Error(
      `Không thể hủy đơn ở trạng thái "${existing.status}".`
    );
  }

  await recordAuditLog({
    entityType: "sales_order",
    entityId: orderId,
    action: "cancel",
    oldData: (prev as Record<string, unknown>) ?? null,
    newData: { status: "cancelled" },
  });
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

  const { data, error } = await supabase
    .from("invoice_items")
    .select(
      "id, product_id, product_name, unit, quantity, unit_price, discount, total",
    )
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
}

export interface DraftOrderDetail extends DraftOrderSummary {
  branchId: string;
  items: Array<{
    id: string;
    productId: string;
    productName: string;
    unit: string;
    quantity: number;
    unitPrice: number;
    discount: number;
    total: number;
  }>;
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
  const autoSaved = options?.autoSaved ?? false;

  // ── Upsert path: nếu có sessionId, tìm row existing trước ──
  if (options?.sessionId) {
    // Cast as any vì supabase types chưa gen sau migration 00048
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing } = await (supabase as any)
      .from("invoices")
      .select("id, code, status, source")
      .eq("tenant_id", input.tenantId)
      .eq("client_session_id", options.sessionId)
      // 00173: bỏ qua row đã xóa mềm → coi như chưa có → INSERT mới (không hồi sinh).
      .is("deleted_at", null)
      .maybeSingle();

    if (existing) {
      // Đã có row với sessionId này
      if (existing.status !== "draft") {
        // Đã được hoàn tất hoặc huỷ → KHÔNG update (idempotency safety net).
        // Client coi như success, return existing → tránh tạo dup.
        return { invoiceId: existing.id, invoiceCode: existing.code };
      }
      // Status='draft' → UPDATE fields + replace items. Truyền source để
      // updateDraftOrderInternal KHÔNG lật auto_saved cho đơn đặt hàng (00173).
      return await updateDraftOrderInternal(existing.id, input, autoSaved, existing.source);
    }
  }

  // ── Insert path (mới) ──
  // 1. CEO 10/07: nháp POS lấy dãy 'pos_draft' (NH...), KHÔNG lấy 'invoice' (HD)
  //    nữa — số HD chỉ cấp khi THANH TOÁN (complete_draft_atomic v2). Nhờ vậy
  //    nháp hủy không làm lỗ số hóa đơn hoàn thành.
  const { data: code, error: codeErr } = await supabase.rpc("next_code", {
    p_tenant_id: input.tenantId,
    p_entity_type: "pos_draft",
  });
  if (codeErr) handleError(codeErr, "saveDraftOrder:next_code");
  const invoiceCode = code ?? `NH${Date.now()}`;

  // 2. Insert draft invoice
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const invoiceData: any = {
    tenant_id: input.tenantId,
    branch_id: input.branchId,
    code: invoiceCode,
    customer_id: input.customerId ?? null,
    customer_name: input.customerName || "Khách lẻ",
    status: "draft" as const,
    subtotal: input.subtotal,
    discount_amount: input.discountAmount,
    total: input.total,
    paid: 0,
    debt: input.total,
    payment_method: input.paymentMethod,
    note: input.note ?? null,
    created_by: input.createdBy,
    // 00048: idempotency + auto-save tracking
    client_session_id: options?.sessionId ?? null,
    auto_saved: autoSaved,
  };

  let invoice: { id: string; code: string } | null = null;
  try {
    const result = await supabase
      .from("invoices")
      .insert(invoiceData as InvoiceInsert)
      .select("id, code")
      .single();
    if (result.error) {
      // Race condition: 2 calls cùng sessionId race INSERT → lần 2 fail
      // 23505 (unique_violation). Retry SELECT để return existing.
      if (
        (result.error.code === "23505" || result.error.message?.includes("client_session_id_unique")) &&
        options?.sessionId
      ) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: raced } = await (supabase as any)
          .from("invoices")
          .select("id, code, status, source")
          .eq("tenant_id", input.tenantId)
          .eq("client_session_id", options.sessionId)
          .single();
        if (raced && raced.status === "draft") {
          // Race lost — UPDATE row của winner thay vì INSERT
          return await updateDraftOrderInternal(raced.id, input, autoSaved, raced.source);
        }
        if (raced) {
          // Đã completed → return existing
          return { invoiceId: raced.id, invoiceCode: raced.code };
        }
      }
      handleError(result.error, "saveDraftOrder:invoice");
    }
    invoice = result.data;
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handleError(err as any, "saveDraftOrder:invoice");
  }
  if (!invoice) throw new Error("Không lưu được đơn nháp");

  // 3. Insert invoice_items
  const itemsData: InvoiceItemInsert[] = input.items.map((item) => ({
    invoice_id: invoice!.id,
    product_id: item.productId,
    product_name: item.productName,
    unit: item.unit ?? "Cái",
    quantity: item.quantity,
    unit_price: item.unitPrice,
    discount: item.discount,
    total: item.quantity * item.unitPrice - item.discount,
  }));

  if (itemsData.length > 0) {
    const { error: itemsErr } = await supabase
      .from("invoice_items")
      .insert(itemsData);
    if (itemsErr) handleError(itemsErr, "saveDraftOrder:items");
  }

  return { invoiceId: invoice.id, invoiceCode: invoice.code };
}

/**
 * Internal: UPDATE existing draft (auto-save flow).
 * - Update invoice fields + auto_saved flag
 * - DELETE old items + INSERT new (simpler than diff)
 * - Trigger handle_updated_at refresh updated_at → TTL 30d tính đúng
 */
async function updateDraftOrderInternal(
  invoiceId: string,
  input: PosCheckoutInput,
  autoSaved: boolean,
  existingSource?: string | null,
): Promise<{ invoiceId: string; invoiceCode: string }> {
  const supabase = getClient();

  // 1. UPDATE invoice (chỉ update field thay đổi). WHERE status='draft'
  // safety: nếu race condition đã flip sang completed → KHÔNG update.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updatePayload: any = {
    customer_id: input.customerId ?? null,
    customer_name: input.customerName || "Khách lẻ",
    subtotal: input.subtotal,
    discount_amount: input.discountAmount,
    total: input.total,
    debt: input.total,
    payment_method: input.paymentMethod,
    note: input.note ?? null,
  };
  // 00173 — FIX MẤT ĐƠN: chỉ đơn NHÁP POS mới gắn auto_saved (để cleanup dọn).
  // Đơn ĐẶT HÀNG (source='order') KHÔNG được lật auto_saved=true — nếu lật thì
  // dọn-giỏ-trống + cleanup 30 ngày sẽ ăn mất đơn thật. Giữ nguyên cột cũ.
  if (existingSource !== "order") {
    updatePayload.auto_saved = autoSaved;
  }

  const { data: updated, error: updErr } = await (supabase as any)
    .from("invoices")
    .update(updatePayload)
    .eq("tenant_id", input.tenantId)
    .eq("id", invoiceId)
    .eq("status", "draft")
    // 00173: không cập nhật row đã xóa mềm.
    .is("deleted_at", null)
    .select("id, code")
    .maybeSingle();
  if (updErr) handleError(updErr, "updateDraftOrderInternal:update");
  if (!updated) {
    // Đã không còn ở trạng thái draft → idempotent return existing
    const { data: snap } = await supabase
      .from("invoices")
      .select("id, code")
      .eq("id", invoiceId)
      .single();
    if (snap) return { invoiceId: snap.id, invoiceCode: snap.code };
    throw new Error("Không tìm thấy đơn nháp để cập nhật");
  }

  // 2. DELETE old items + INSERT new
  await supabase.from("invoice_items").delete().eq("invoice_id", invoiceId);

  if (input.items.length > 0) {
    const itemsData: InvoiceItemInsert[] = input.items.map((item) => ({
      invoice_id: invoiceId,
      product_id: item.productId,
      product_name: item.productName,
      unit: item.unit ?? "Cái",
      quantity: item.quantity,
      unit_price: item.unitPrice,
      discount: item.discount,
      total: item.quantity * item.unitPrice - item.discount,
    }));

    const { error: itemsErr } = await supabase
      .from("invoice_items")
      .insert(itemsData);
    if (itemsErr) handleError(itemsErr, "updateDraftOrderInternal:items");
  }

  return { invoiceId: updated.id, invoiceCode: updated.code };
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
      "id, code, branch_id, customer_id, customer_name, subtotal, discount_amount, total, note, created_at, updated_at, status, auto_saved, client_session_id, invoice_items(*)",
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    items: (raw.invoice_items ?? []).map((it: any) => ({
      id: it.id,
      productId: it.product_id,
      productName: it.product_name,
      unit: it.unit ?? "Cái",
      quantity: it.quantity,
      unitPrice: it.unit_price,
      discount: it.discount ?? 0,
      total: it.total ?? 0,
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
  const tenantId = await getCurrentTenantId();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("invoices")
    .update({ client_session_id: sessionId })
    .eq("tenant_id", tenantId)
    .eq("id", invoiceId)
    .eq("status", "draft");
  if (error) handleError(error, "adoptDraftSession");
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
    /** Tách thanh toán hỗn hợp — truyền khi method="mixed" */
    paymentBreakdown?: import("./pos-checkout").PaymentBreakdownItem[];
    /**
     * CEO 05/06/2026 FIX BUG KẾT CA 0Đ:
     * shiftId của ca cashier đang mở — PHẢI truyền để link vào:
     *  - invoices.shift_id (nếu nháp tạo trước khi mở ca)
     *  - cash_transactions.shift_id (qua createAutoCashReceipt)
     * Nếu null → cash_transactions.shift_id=null → RPC close_shift_atomic
     * filter `WHERE shift_id = p_shift_id` không match → tổng = 0đ.
     */
    shiftId?: string | null;
  }
): Promise<{ invoiceCode: string }> {
  const supabase = getClient();
  const paid = payment.paid;
  const shiftId = payment.shiftId ?? null;

  // P0-7 13/06/2026: Ưu tiên gọi RPC atomic. Nếu thành công → 5 op chạy
  // trong 1 transaction PG → all-or-nothing → không có ghost invoice.
  // Fallback xuống luồng cũ (5 op rời) nếu RPC chưa apply (migration 00139
  // chưa chạy). Sau khi verify ngon 24-48h → xoá fallback.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: atomicData, error: atomicError } = await (supabase.rpc as any)(
      "complete_draft_atomic",
      {
        p_invoice_id: invoiceId,
        p_tenant_id: payment.tenantId,
        p_branch_id: payment.branchId,
        p_created_by: payment.createdBy,
        p_method: payment.method,
        p_paid: paid,
        p_payment_breakdown: payment.paymentBreakdown ?? null,
        p_shift_id: shiftId,
      },
    );
    if (!atomicError && atomicData) {
      const result = atomicData as { invoice_code?: string };
      if (result.invoice_code) {
        return { invoiceCode: result.invoice_code };
      }
    }
    if (atomicError && !isRpcUnavailable(atomicError)) {
      // RPC có nhưng raise exception (vd "Đơn này đã được xử lý...").
      // Throw thẳng để cashier thấy lỗi rõ ràng, KHÔNG fallback (tránh
      // double xử lý nếu RPC đã claim được status=completed).
      handleError(atomicError, "completeDraftOrder:atomic_rpc");
    }
    // RPC unavailable (migration chưa chạy) → fallback xuống luồng cũ.
    console.warn(
      "[completeDraftOrder] RPC complete_draft_atomic chưa có (migration 00139), fallback 5-step legacy",
    );
  } catch (err) {
    // RPC throw client-side (vd network) → throw lại để cashier biết.
    if (err instanceof Error && /draft|đã được xử lý|status/i.test(err.message)) {
      throw err;
    }
    console.warn("[completeDraftOrder] RPC exception, fallback legacy:", err);
  }

  // ─── LEGACY 5-step path (kept 24-48h sau khi apply migration 00139) ───
  // 1. ATOMIC status flip: UPDATE + WHERE status='draft' claims this invoice.
  //    If two concurrent calls race, only one matches and succeeds.

  const { data: invoice, error: updErr } = await supabase
    .from("invoices")
    .update({
      status: "completed",
      paid,
      debt: 0, // placeholder — will recompute below
      payment_method: payment.method,
      // Link shift_id vào invoice — nháp tạo trước khi mở ca cũng được claim
      // bởi ca khi cashier hoàn tất. Nếu shiftId=null thì giữ giá trị cũ.
      ...(shiftId ? { shift_id: shiftId } : {}),
    })
    .eq("tenant_id", payment.tenantId)
    .eq("id", invoiceId)
    .eq("status", "draft")
    .select("id, code, status, total, customer_name, branch_id, tenant_id")
    .maybeSingle();
  if (updErr) handleError(updErr, "completeDraftOrder:update");
  if (!invoice) {
    // Either not found or already completed by another call
    const { data: existing } = await supabase
      .from("invoices")
      .select("status")
      .eq("tenant_id", payment.tenantId)
      .eq("id", invoiceId)
      .single();
    if (!existing) throw new Error("Không tìm thấy đơn nháp");
    throw new Error(`Đơn này đã được xử lý (trạng thái: ${existing.status}). Không thể hoàn tất lại.`);
  }

  const total = invoice.total ?? 0;
  const debt = Math.max(0, total - paid);

  // Update debt (computed from real total)
  if (debt !== 0) {
    await supabase
      .from("invoices")
      .update({ debt })
      .eq("tenant_id", payment.tenantId)
      .eq("id", invoiceId);
  }

  // Load invoice_items for stock decrement — scope qua invoice_id (đã verify ownership)
  const { data: itemsRaw, error: itemsErr } = await supabase
    .from("invoice_items")
    .select("*")
    .eq("invoice_id", invoiceId);
  if (itemsErr) handleError(itemsErr, "completeDraftOrder:items");

  // 3. Build items payload for stock decrement
  const rawItems = itemsRaw ?? [];
  const items: PosCheckoutItem[] = rawItems.map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (it: any) => ({
      productId: it.product_id,
      productName: it.product_name,
      unit: it.unit,
      quantity: it.quantity,
      unitPrice: it.unit_price,
      discount: it.discount ?? 0,
    })
  );

  // 4. Decrement stock
  await applyStockDecrement(supabase, invoiceId, items, {
    tenantId: payment.tenantId,
    branchId: payment.branchId,
    createdBy: payment.createdBy,
    invoiceCode: invoice.code,
  });

  // 5. Cash transaction — hỗ trợ tách thanh toán hỗn hợp
  // CEO 05/06/2026 FIX KẾT CA 0Đ: truyền shiftId xuống → cash_transactions.shift_id
  await createAutoCashReceipt(
    supabase,
    invoiceId,
    invoice.code,
    paid,
    payment.method,
    {
      tenantId: payment.tenantId,
      branchId: payment.branchId,
      createdBy: payment.createdBy,
      customerName: invoice.customer_name ?? "Khách lẻ",
      shiftId,
    },
    payment.paymentBreakdown
  );

  return { invoiceCode: invoice.code };
}

// ============================================================
// Delete draft (SOFT-delete — 00173; never touches completed or đơn đặt hàng)
// ============================================================

export async function deleteDraftOrder(
  invoiceId: string,
  opts?: { onlyAutoSaved?: boolean },
): Promise<void> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // 00173 SOFT-DELETE: KHÔNG xóa cứng nữa — SET deleted_at (khôi phục được bằng
  // cách set NULL lại). Claim WHERE status='draft'; nếu completeDraftOrder đã
  // flip 'completed' thì khớp 0 dòng, bail an toàn.
  // GUARD TRIỆT ĐỂ chống mất đơn đặt hàng:
  //  - KHÔNG BAO GIỜ đụng source='order' (đơn đặt hàng chỉ được "Hủy" ở trang
  //    Đặt hàng, giữ bản ghi) — kể cả khi nó lỡ bị auto-save lật auto_saved.
  //    source có thể NULL (nháp POS cũ) → dùng (is null OR neq order).
  //  - chưa bị xóa mềm (deleted_at IS NULL) → idempotent.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let delQuery = (supabase as any)
    .from("invoices")
    .update({ deleted_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("id", invoiceId)
    .eq("status", "draft")
    .is("deleted_at", null)
    .or("source.is.null,source.neq.order");
  // CEO 16/06/2026 — onlyAutoSaved: dọn-giỏ-trống chỉ được xóa nháp KỸ THUẬT
  // (auto_saved=true). Nháp bấm "Nháp" tay (auto_saved=false, sticky) KHÔNG bị
  // auto-xóa. Guard này vẫn giữ nguyên tác dụng.
  if (opts?.onlyAutoSaved) delQuery = delQuery.eq("auto_saved", true);

  const { data: deleted, error: invErr } = await delQuery
    .select("id")
    .maybeSingle();
  if (invErr) handleError(invErr, "deleteDraftOrder:invoice");
  if (!deleted) {
    // Either not found or not a draft — safe to ignore
    return;
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
  const tenantId = await getCurrentTenantId();

  // 1. Load source invoice + items
  const { data: source, error: srcErr } = await supabase
    .from("invoices")
    .select("*, invoice_items(*)")
    .eq("tenant_id", tenantId)
    .eq("id", sourceInvoiceId)
    .single();
  if (srcErr) handleError(srcErr, "duplicateInvoice:source");
  if (!source) throw new Error("Không tìm thấy hoá đơn để sao chép");

  // 2. Generate new code
  const { data: code, error: codeErr } = await supabase.rpc("next_code", {
    p_tenant_id: tenantId,
    p_entity_type: "invoice",
  });
  if (codeErr) handleError(codeErr, "duplicateInvoice:next_code");
  const newCode = code ?? `HD${Date.now()}`;

  // 3. Insert new draft với cùng customer/payment, RESET paid+debt
  const profile = await import("./base").then((m) => m.getCurrentContext());
  if (!profile) throw new Error("Không xác định được người dùng hiện tại");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const newInvoice: any = {
    tenant_id: tenantId,
    branch_id: profile.branchId,
    code: newCode,
    customer_id: source.customer_id,
    customer_name: source.customer_name,
    status: "draft",
    subtotal: source.subtotal,
    discount_amount: source.discount_amount,
    total: source.total,
    paid: 0,
    debt: source.total,
    payment_method: source.payment_method,
    note: source.note ? `[Sao chép từ ${source.code}] ${source.note}` : `[Sao chép từ ${source.code}]`,
    created_by: profile.userId,
  };

  const { data: invoice, error: invErr } = await supabase
    .from("invoices")
    .insert(newInvoice as InvoiceInsert)
    .select("id, code")
    .single();
  if (invErr) handleError(invErr, "duplicateInvoice:insert");
  if (!invoice) throw new Error("Không tạo được bản sao hoá đơn");

  // 4. Clone items (reset id, link new invoice_id)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sourceItems = (source.invoice_items ?? []) as any[];
  if (sourceItems.length > 0) {
    const itemsData: InvoiceItemInsert[] = sourceItems.map((it) => ({
      invoice_id: invoice.id,
      product_id: it.product_id,
      product_name: it.product_name,
      unit: it.unit ?? "Cái",
      quantity: it.quantity,
      unit_price: it.unit_price,
      discount: it.discount ?? 0,
      vat_rate: it.vat_rate ?? 0,
      vat_amount: it.vat_amount ?? 0,
      total: it.total,
    }));
    const { error: itemsErr } = await supabase
      .from("invoice_items")
      .insert(itemsData);
    if (itemsErr) handleError(itemsErr, "duplicateInvoice:items");
  }

  return { invoiceId: invoice.id, invoiceCode: invoice.code };
}
