/**
 * POS Checkout Service
 *
 * Atomically creates invoice + invoice_items + stock_movements + cash_transaction
 * for a completed POS sale.
 *
 * The stock-decrement logic is extracted into `applyStockDecrement` so that
 * it can be reused from `orders.ts` → `completeDraftOrder` (F10 on a saved draft).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getClient, handleError } from "./base";
import type { Database } from "@/lib/supabase/types";

type InvoiceInsert = Database["public"]["Tables"]["invoices"]["Insert"];
type InvoiceItemInsert = Database["public"]["Tables"]["invoice_items"]["Insert"];
type StockMovementInsert = Database["public"]["Tables"]["stock_movements"]["Insert"];
type CashTransactionInsert = Database["public"]["Tables"]["cash_transactions"]["Insert"];

// ============================================================
// Types
// ============================================================

export interface PosCheckoutItem {
  productId: string;
  productName: string;
  unit?: string;
  quantity: number;
  unitPrice: number;
  discount: number;
}

export interface PosCheckoutInput {
  tenantId: string;
  branchId: string;
  createdBy: string;
  customerId?: string | null;
  customerName: string;
  items: PosCheckoutItem[];
  paymentMethod: "cash" | "transfer" | "card" | "mixed";
  subtotal: number;
  discountAmount: number;
  total: number;
  paid: number;
  note?: string;
}

export interface PosCheckoutResult {
  invoiceId: string;
  invoiceCode: string;
}

export interface StockDecrementContext {
  tenantId: string;
  branchId: string;
  createdBy: string;
  invoiceCode: string;
}

// ============================================================
// Private: decrement stock + write stock_movements
// ============================================================

/**
 * Apply stock decrement for a given invoice.
 * - Inserts one `stock_movements` row per item (type='out', reference=invoice).
 * - Decrements `products.stock` with a basic re-fetch loop.
 *
 * NOT atomic across items (a future RPC will harden this). For now we accept
 * the race-condition risk, which is acceptable for a single-cashier terminal.
 *
 * Exported (non-public API) so that `completeDraftOrder` in `orders.ts`
 * can call it when converting a draft → completed.
 */
export async function applyStockDecrement(
  supabase: SupabaseClient<Database>,
  invoiceId: string,
  items: PosCheckoutItem[],
  ctx: StockDecrementContext
): Promise<void> {
  // 1. Insert stock_movements
  // Convention: `quantity` is ALWAYS positive (magnitude). `type` carries the
  // direction — 'in' adds, 'out' subtracts. Matches the production RPC and the
  // 4 wholesale dialogs (manufacturing/internal/disposal/purchase-return).
  // Aggregations should sum |quantity| filtered by type, never sum the raw
  // signed value. The pre-F4 negative-quantity convention here was the only
  // exception in the codebase and is now removed.
  const stockMovements: StockMovementInsert[] = items.map((item) => ({
    tenant_id: ctx.tenantId,
    branch_id: ctx.branchId,
    product_id: item.productId,
    type: "out" as const,
    quantity: item.quantity,
    reference_type: "invoice",
    reference_id: invoiceId,
    note: `POS bán hàng - ${ctx.invoiceCode}`,
    created_by: ctx.createdBy,
  }));

  const { error: stockError } = await supabase
    .from("stock_movements")
    .insert(stockMovements);
  if (stockError) handleError(stockError, "applyStockDecrement:movements");

  // 2. Decrement products.stock (per-row fetch-then-update loop)
  // Stock CAN go negative — represents "owe to warehouse" / oversold state.
  // Frontend warns the cashier; backend records the truth so the ledger
  // (stock_movements) and the snapshot field (products.stock) stay in sync.
  for (const item of items) {
    const { data: product, error: selErr } = await supabase
      .from("products")
      .select("stock")
      .eq("id", item.productId)
      .single();
    if (selErr) handleError(selErr, "applyStockDecrement:select");
    if (!product) continue;

    const currentStock = product.stock ?? 0;
    const nextStock = currentStock - item.quantity;
    const { error: updErr } = await supabase
      .from("products")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ stock: nextStock } as any)
      .eq("id", item.productId);
    if (updErr) handleError(updErr, "applyStockDecrement:update");
  }
}

// ============================================================
// Private: auto-create cash_transaction (phiếu thu)
// ============================================================

/**
 * Create a "phiếu thu" (income cash transaction) tied to the invoice.
 * Called whenever a sale actually receives money (paid > 0).
 *
 * Keeps sổ quỹ automatically in sync with doanh thu POS.
 *
 * Note: `cash_transactions.payment_method` only accepts cash | transfer | card.
 * POS "mixed" gets mapped to "cash" (dominant default) — a future improvement
 * can split the row when partial multi-method payments are supported.
 */
export async function createAutoCashReceipt(
  supabase: SupabaseClient<Database>,
  invoiceId: string,
  invoiceCode: string,
  amount: number,
  paymentMethod: "cash" | "transfer" | "card" | "mixed",
  ctx: { tenantId: string; branchId: string; createdBy: string; customerName: string }
): Promise<void> {
  if (amount <= 0) return; // Nợ 100% — chưa thu tiền

  // 1. Generate code PT00001
  const { data: code, error: codeErr } = await supabase.rpc("next_code", {
    p_tenant_id: ctx.tenantId,
    p_entity_type: "cash_receipt",
  });
  if (codeErr) handleError(codeErr, "createAutoCashReceipt:next_code");
  const cashCode = code ?? `PT${Date.now()}`;

  // 2. Map mixed → cash for cash_transactions schema
  const cashPaymentMethod: "cash" | "transfer" | "card" =
    paymentMethod === "mixed" ? "cash" : paymentMethod;

  const cashData: CashTransactionInsert = {
    tenant_id: ctx.tenantId,
    branch_id: ctx.branchId,
    code: cashCode,
    type: "receipt",
    category: "Bán hàng",
    amount,
    counterparty: ctx.customerName,
    payment_method: cashPaymentMethod,
    reference_type: "invoice",
    reference_id: invoiceId,
    note: `Thu tiền hoá đơn ${invoiceCode}`,
    created_by: ctx.createdBy,
  };

  const { error: cashErr } = await supabase
    .from("cash_transactions")
    .insert(cashData);
  if (cashErr) handleError(cashErr, "createAutoCashReceipt:insert");
}

// ============================================================
// Public: posCheckout (direct F10 path — fresh cart → completed invoice)
// ============================================================

export async function posCheckout(input: PosCheckoutInput): Promise<PosCheckoutResult> {
  const supabase = getClient();

  // 1. Generate invoice code via RPC
  const { data: code, error: codeError } = await supabase.rpc("next_code", {
    p_tenant_id: input.tenantId,
    p_entity_type: "invoice",
  });
  if (codeError) handleError(codeError, "posCheckout:next_code");
  const invoiceCode = code ?? `HD${Date.now()}`;

  // 2. Insert invoice (status = completed)
  const invoiceData = {
    tenant_id: input.tenantId,
    branch_id: input.branchId,
    code: invoiceCode,
    customer_id: input.customerId ?? null,
    customer_name: input.customerName || "Khách lẻ",
    status: "completed" as const,
    subtotal: input.subtotal,
    discount_amount: input.discountAmount,
    total: input.total,
    paid: input.paid,
    debt: Math.max(0, input.total - input.paid),
    payment_method: input.paymentMethod,
    note: input.note ?? null,
    created_by: input.createdBy,
  } satisfies InvoiceInsert;

  const { data: invoice, error: invoiceError } = await supabase
    .from("invoices")
    .insert(invoiceData)
    .select("id, code")
    .single();
  if (invoiceError) handleError(invoiceError, "posCheckout:invoice");
  if (!invoice) throw new Error("Không tạo được hóa đơn");

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

  const { error: itemsError } = await supabase
    .from("invoice_items")
    .insert(itemsData);
  if (itemsError) handleError(itemsError, "posCheckout:items");

  // 4. Decrement stock (+ stock_movements)
  await applyStockDecrement(supabase, invoice.id, input.items, {
    tenantId: input.tenantId,
    branchId: input.branchId,
    createdBy: input.createdBy,
    invoiceCode: invoice.code,
  });

  // 5. Auto-create cash transaction (phiếu thu) — M4.C
  await createAutoCashReceipt(
    supabase,
    invoice.id,
    invoice.code,
    input.paid,
    input.paymentMethod,
    {
      tenantId: input.tenantId,
      branchId: input.branchId,
      createdBy: input.createdBy,
      customerName: input.customerName || "Khách lẻ",
    }
  );

  return {
    invoiceId: invoice.id,
    invoiceCode: invoice.code,
  };
}
