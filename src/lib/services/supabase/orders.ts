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
import {
  posCheckout,
  applyStockDecrement,
  createAutoCashReceipt,
  type PosCheckoutInput,
  type PosCheckoutResult,
  type PosCheckoutItem,
} from "./pos-checkout";
import { recordAuditLog } from "./audit";
import type { Database } from "@/lib/supabase/types";

type InvoiceInsert = Database["public"]["Tables"]["invoices"]["Insert"];
type InvoiceItemInsert = Database["public"]["Tables"]["invoice_items"]["Insert"];

// ============================================================
// Sales Orders — real Supabase queries against `sales_orders`
// ============================================================

const STATUS_LABEL: Record<string, string> = {
  new: "Mới",
  confirmed: "Đã xác nhận",
  delivering: "Đang giao",
  completed: "Hoàn thành",
  cancelled: "Đã hủy",
};

export async function getOrders(
  params: QueryParams
): Promise<QueryResult<SalesOrder>> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const { from, to } = getPaginationRange(params);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from("sales_orders")
    .select(
      "*, profiles!sales_orders_created_by_fkey(full_name), branches!sales_orders_branch_id_fkey(name)",
      { count: "exact" },
    )
    .eq("tenant_id", tenantId);

  // Search by code or customer_name. Escape % để tránh wildcard injection.
  if (params.search) {
    const esc = params.search.replace(/[%_]/g, "\\$&");
    query = query.or(
      `code.ilike.%${esc}%,customer_name.ilike.%${esc}%,customer_phone.ilike.%${esc}%`,
    );
  }

  // Filter: status
  if (params.filters?.status && params.filters.status !== "all") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query = query.eq("status", params.filters.status as any);
  }

  // Filter: branch
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
      code: row.code,
      date: row.created_at,
      customerName: row.customer_name ?? "",
      customerPhone: row.customer_phone ?? "",
      totalAmount: row.total ?? 0,
      status: row.status,
      statusName: STATUS_LABEL[row.status] ?? row.status,
      createdBy: row.created_by ?? "",
      createdByName: profile?.full_name ?? "",
      branchId: row.branch_id ?? undefined,
      branchName: branch?.name ?? undefined,
    };
  });

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
 */
export async function saveDraftOrder(
  input: PosCheckoutInput
): Promise<{ invoiceId: string; invoiceCode: string }> {
  const supabase = getClient();

  // 1. Generate invoice code
  const { data: code, error: codeErr } = await supabase.rpc("next_code", {
    p_tenant_id: input.tenantId,
    p_entity_type: "invoice",
  });
  if (codeErr) handleError(codeErr, "saveDraftOrder:next_code");
  const invoiceCode = code ?? `HD${Date.now()}`;

  // 2. Insert draft invoice
  const invoiceData = {
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
  } satisfies InvoiceInsert;

  const { data: invoice, error: invoiceErr } = await supabase
    .from("invoices")
    .insert(invoiceData)
    .select("id, code")
    .single();
  if (invoiceErr) handleError(invoiceErr, "saveDraftOrder:invoice");
  if (!invoice) throw new Error("Không lưu được đơn nháp");

  // 3. Insert invoice_items
  const itemsData: InvoiceItemInsert[] = input.items.map((item) => ({
    invoice_id: invoice.id,
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
  limit: number = 50
): Promise<DraftOrderSummary[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  let query = supabase
    .from("invoices")
    .select(
      "id, code, customer_id, customer_name, total, subtotal, discount_amount, note, created_at, invoice_items(count)"
    )
    .eq("tenant_id", tenantId)
    .eq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (branchId) query = query.eq("branch_id", branchId);

  const { data, error } = await query;
  if (error) handleError(error, "listDraftOrders");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any) => ({
    id: row.id,
    code: row.code,
    customerId: row.customer_id,
    customerName: row.customer_name ?? "Khách lẻ",
    total: row.total ?? 0,
    subtotal: row.subtotal ?? 0,
    discountAmount: row.discount_amount ?? 0,
    // invoice_items(count) returns [{ count: N }]
    itemCount: Array.isArray(row.invoice_items) && row.invoice_items[0]?.count
      ? row.invoice_items[0].count
      : 0,
    note: row.note,
    createdAt: row.created_at,
  }));
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

  const { data, error } = await supabase
    .from("invoices")
    .select(
      "id, code, branch_id, customer_id, customer_name, subtotal, discount_amount, total, note, created_at, status, invoice_items(*)"
    )
    .eq("tenant_id", tenantId)
    .eq("id", invoiceId)
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
  }
): Promise<{ invoiceCode: string }> {
  const supabase = getClient();

  // 1. ATOMIC status flip: UPDATE + WHERE status='draft' claims this invoice.
  //    If two concurrent calls race, only one matches and succeeds.
  const paid = payment.paid;

  const { data: invoice, error: updErr } = await supabase
    .from("invoices")
    .update({
      status: "completed",
      paid,
      debt: 0, // placeholder — will recompute below
      payment_method: payment.method,
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
    },
    payment.paymentBreakdown
  );

  return { invoiceCode: invoice.code };
}

// ============================================================
// Delete draft (cleanup only — never delete completed)
// ============================================================

export async function deleteDraftOrder(invoiceId: string): Promise<void> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // ATOMIC: Delete invoice WHERE status='draft' FIRST to claim it.
  // If a concurrent completeDraftOrder already flipped status to 'completed',
  // this delete matches 0 rows and we bail safely.
  // invoice_items have ON DELETE CASCADE from the FK, so they are auto-deleted.
  const { data: deleted, error: invErr } = await supabase
    .from("invoices")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", invoiceId)
    .eq("status", "draft")
    .select("id")
    .maybeSingle();
  if (invErr) handleError(invErr, "deleteDraftOrder:invoice");
  if (!deleted) {
    // Either not found or not a draft — safe to ignore
    return;
  }
}
