/**
 * Supabase service: Sales Orders (Đơn hàng)
 *
 * Two responsibilities:
 *
 *   1. Legacy: re-export `getOrders` / `getOrderStatuses` from mocks —
 *      a dedicated `sales_orders` table doesn't exist yet. Listing pages
 *      still hit those mocks.
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

import { getClient, handleError } from "./base";
import {
  posCheckout,
  applyStockDecrement,
  createAutoCashReceipt,
  type PosCheckoutInput,
  type PosCheckoutResult,
  type PosCheckoutItem,
} from "./pos-checkout";
import type { Database } from "@/lib/supabase/types";

type InvoiceInsert = Database["public"]["Tables"]["invoices"]["Insert"];
type InvoiceItemInsert = Database["public"]["Tables"]["invoice_items"]["Insert"];

// ============================================================
// Legacy mock re-export (kept for listing pages)
// ============================================================
export { getOrders, getOrderStatuses } from "../mock/orders";

// ============================================================
// Re-export from pos-checkout for convenience
// ============================================================
export { posCheckout };
export type { PosCheckoutInput, PosCheckoutResult, PosCheckoutItem };

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

  let query = supabase
    .from("invoices")
    .select(
      "id, code, customer_id, customer_name, total, subtotal, discount_amount, note, created_at, invoice_items(count)"
    )
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

  const { data, error } = await supabase
    .from("invoices")
    .select(
      "id, code, branch_id, customer_id, customer_name, subtotal, discount_amount, total, note, created_at, status, invoice_items(*)"
    )
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
  }
): Promise<{ invoiceCode: string }> {
  const supabase = getClient();

  // 1. Load invoice + items
  const { data: invoice, error: loadErr } = await supabase
    .from("invoices")
    .select("id, code, status, total, customer_name, branch_id, tenant_id, invoice_items(*)")
    .eq("id", invoiceId)
    .single();
  if (loadErr) handleError(loadErr, "completeDraftOrder:load");
  if (!invoice) throw new Error("Không tìm thấy đơn nháp");
  if (invoice.status !== "draft") {
    throw new Error(`Đơn này không ở trạng thái nháp (đang: ${invoice.status})`);
  }

  const total = invoice.total ?? 0;
  const paid = payment.paid;
  const debt = Math.max(0, total - paid);

  // 2. UPDATE invoices
  const { error: updErr } = await supabase
    .from("invoices")
    .update({
      status: "completed",
      paid,
      debt,
      payment_method: payment.method,
    })
    .eq("id", invoiceId);
  if (updErr) handleError(updErr, "completeDraftOrder:update");

  // 3. Build items payload for stock decrement
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawItems = (invoice as any).invoice_items ?? [];
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

  // 5. Cash transaction
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
    }
  );

  return { invoiceCode: invoice.code };
}

// ============================================================
// Delete draft (cleanup only — never delete completed)
// ============================================================

export async function deleteDraftOrder(invoiceId: string): Promise<void> {
  const supabase = getClient();

  // 1. Pre-check: only proceed if invoice is actually a draft.
  //    Without this guard, step 2 would wipe invoice_items of a *completed*
  //    invoice (the items DELETE has no status filter), corrupting the row.
  const { data: invoice, error: readErr } = await supabase
    .from("invoices")
    .select("id, status")
    .eq("id", invoiceId)
    .single();
  if (readErr) handleError(readErr, "deleteDraftOrder:read");
  if (!invoice) return; // Already gone — nothing to do.
  if (invoice.status !== "draft") {
    throw new Error(
      `Không thể xóa: hóa đơn này không ở trạng thái nháp (đang: ${invoice.status})`
    );
  }

  // 2. Delete items (safe now — we know status='draft')
  const { error: itemsErr } = await supabase
    .from("invoice_items")
    .delete()
    .eq("invoice_id", invoiceId);
  if (itemsErr) handleError(itemsErr, "deleteDraftOrder:items");

  // 3. Delete invoice — keep the status=draft guard as defense in depth
  //    (race condition: someone could complete the draft between step 1 and 3)
  const { error: invErr } = await supabase
    .from("invoices")
    .delete()
    .eq("id", invoiceId)
    .eq("status", "draft");
  if (invErr) handleError(invErr, "deleteDraftOrder:invoice");
}
