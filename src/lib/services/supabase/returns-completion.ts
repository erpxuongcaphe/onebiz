/**
 * Sales return service.
 *
 * The database RPC owns the complete transaction: document, items, stock/BOM,
 * returned quantity, refund, debt credit and audit. The browser never performs
 * partial return side-effects.
 */

import { getClient, handleError } from "./base";

export type RefundPaymentMethod = "cash" | "transfer" | "card";

export interface SalesReturnLineInput {
  invoiceItemId: string;
  quantity: number;
}

export interface CreateSalesReturnAtomicInput {
  invoiceId: string;
  items: SalesReturnLineInput[];
  refundAmount: number;
  refundPaymentMethod?: RefundPaymentMethod;
  reason?: string;
  note?: string;
  shiftId?: string | null;
}

export interface SalesReturnAtomicResult {
  returnId: string;
  code: string;
  total: number;
  refunded: number;
  debtCredit: number;
  warnings: Array<{
    code: string;
    invoice_item_id?: string;
    product_id?: string;
    product_name?: string;
  }>;
}

export async function createSalesReturnAtomic(
  input: CreateSalesReturnAtomicInput,
): Promise<SalesReturnAtomicResult> {
  if (!input.invoiceId) throw new Error("Thi\u1ebfu h\u00f3a \u0111\u01a1n g\u1ed1c");
  if (input.items.length === 0) throw new Error("C\u1ea7n \u00edt nh\u1ea5t m\u1ed9t s\u1ea3n ph\u1ea9m tr\u1ea3 l\u1ea1i");
  if (
    input.items.some(
      (item) => !item.invoiceItemId || !Number.isFinite(item.quantity) || item.quantity <= 0,
    )
  ) {
    throw new Error("D\u00f2ng s\u1ea3n ph\u1ea9m tr\u1ea3 l\u1ea1i kh\u00f4ng h\u1ee3p l\u1ec7");
  }
  if (!Number.isFinite(input.refundAmount) || input.refundAmount < 0) {
    throw new Error("S\u1ed1 ti\u1ec1n ho\u00e0n kh\u00f4ng h\u1ee3p l\u1ec7");
  }

  const supabase = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("create_sales_return_atomic", {
    p_invoice_id: input.invoiceId,
    p_items: input.items,
    p_refund_amount: input.refundAmount,
    p_refund_payment_method: input.refundPaymentMethod ?? "cash",
    p_reason: input.reason?.trim() || null,
    p_note: input.note?.trim() || null,
    p_shift_id: input.shiftId ?? null,
  });

  if (error) handleError(error, "createSalesReturnAtomic");
  if (!data || typeof data !== "object") {
    throw new Error("Kh\u00f4ng nh\u1eadn \u0111\u01b0\u1ee3c k\u1ebft qu\u1ea3 t\u1ea1o phi\u1ebfu tr\u1ea3 h\u00e0ng");
  }

  const result = data as Record<string, unknown>;
  if (!result.return_id || !result.code) {
    throw new Error("K\u1ebft qu\u1ea3 t\u1ea1o phi\u1ebfu tr\u1ea3 h\u00e0ng kh\u00f4ng \u0111\u1ea7y \u0111\u1ee7");
  }

  return {
    returnId: String(result.return_id),
    code: String(result.code),
    total: Number(result.total ?? 0),
    refunded: Number(result.refunded ?? 0),
    debtCredit: Number(result.debt_credit ?? 0),
    warnings: Array.isArray(result.warnings)
      ? (result.warnings as SalesReturnAtomicResult["warnings"])
      : [],
  };
}
