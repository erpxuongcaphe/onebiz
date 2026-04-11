/**
 * Payment Recording Service — ghi nhận thanh toán từng phần
 *
 * recordInvoicePayment()  → KH trả nợ hóa đơn (phiếu thu + update invoice.paid/debt + customer.debt)
 * recordPurchasePayment() → Trả nợ NCC (phiếu chi + update PO.paid/debt + supplier.debt)
 */

import { getClient, getCurrentContext, handleError } from "./base";
import { nextEntityCode } from "./stock-adjustments";
import type { Database } from "@/lib/supabase/types";

type CashTransactionInsert = Database["public"]["Tables"]["cash_transactions"]["Insert"];

export interface RecordPaymentInput {
  /** invoice or purchase_order ID */
  referenceId: string;
  amount: number;
  paymentMethod: "cash" | "transfer" | "card";
  note?: string;
}

export interface RecordPaymentResult {
  cashTransactionId: string;
  cashCode: string;
  newPaid: number;
  newDebt: number;
}

/**
 * Ghi nhận thanh toán cho hóa đơn bán (KH trả nợ).
 *
 * 1. Validate amount ≤ remaining debt
 * 2. Create cash_transaction (type='receipt')
 * 3. Update invoices.paid += amount, invoices.debt -= amount
 * 4. Update customers.debt -= amount (if customer_id exists)
 */
export async function recordInvoicePayment(
  input: RecordPaymentInput
): Promise<RecordPaymentResult> {
  const supabase = getClient();
  const ctx = await getCurrentContext();

  // 1. Fetch invoice current state
  const { data: inv, error: fetchErr } = await supabase
    .from("invoices")
    .select("id, code, customer_id, customer_name, total, paid, debt, status")
    .eq("id", input.referenceId)
    .single();

  if (fetchErr) handleError(fetchErr, "recordInvoicePayment.fetch");
  if (!inv) throw new Error("Không tìm thấy hóa đơn");

  const currentDebt = Number(inv.debt ?? 0);
  const currentPaid = Number(inv.paid ?? 0);

  if (currentDebt <= 0) {
    throw new Error("Hóa đơn này không còn công nợ");
  }
  if (input.amount <= 0) {
    throw new Error("Số tiền thanh toán phải lớn hơn 0");
  }
  if (input.amount > currentDebt) {
    throw new Error(
      `Số tiền thanh toán (${input.amount}) vượt quá công nợ còn lại (${currentDebt})`
    );
  }

  const newPaid = currentPaid + input.amount;
  const newDebt = currentDebt - input.amount;

  // 2. Create cash receipt (phiếu thu)
  const cashCode = await nextEntityCode("cash_receipt", { tenantId: ctx.tenantId });

  const cashData: CashTransactionInsert = {
    tenant_id: ctx.tenantId,
    branch_id: ctx.branchId,
    code: cashCode,
    type: "receipt",
    category: "Thu nợ khách hàng",
    amount: input.amount,
    counterparty: inv.customer_name,
    payment_method: input.paymentMethod,
    reference_type: "invoice",
    reference_id: inv.id,
    note: input.note || `Thu nợ hóa đơn ${inv.code}`,
    created_by: ctx.userId,
  };

  const { data: cashRow, error: cashErr } = await supabase
    .from("cash_transactions")
    .insert(cashData)
    .select("id")
    .single();
  if (cashErr) handleError(cashErr, "recordInvoicePayment.cash");

  // 3. Update invoice paid/debt
  const { error: invUpd } = await supabase
    .from("invoices")
    .update({ paid: newPaid, debt: newDebt } as Record<string, unknown>)
    .eq("id", inv.id);
  if (invUpd) handleError(invUpd, "recordInvoicePayment.invoice_update");

  // 4. Update customer.debt if customer_id exists
  if (inv.customer_id) {
    const { data: cust, error: custFetch } = await supabase
      .from("customers")
      .select("debt")
      .eq("id", inv.customer_id)
      .single();

    if (!custFetch && cust) {
      const custNewDebt = Math.max(0, Number(cust.debt ?? 0) - input.amount);
      const { error: custUpd } = await supabase
        .from("customers")
        .update({ debt: custNewDebt } as Record<string, unknown>)
        .eq("id", inv.customer_id);
      if (custUpd) handleError(custUpd, "recordInvoicePayment.customer_update");
    }
  }

  return {
    cashTransactionId: cashRow.id,
    cashCode,
    newPaid,
    newDebt,
  };
}

/**
 * Ghi nhận thanh toán cho đơn nhập hàng (trả nợ NCC).
 *
 * 1. Validate amount ≤ remaining debt
 * 2. Create cash_transaction (type='payment')
 * 3. Update purchase_orders.paid += amount, purchase_orders.debt -= amount
 * 4. Update suppliers.debt -= amount (if supplier_id exists)
 */
export async function recordPurchasePayment(
  input: RecordPaymentInput
): Promise<RecordPaymentResult> {
  const supabase = getClient();
  const ctx = await getCurrentContext();

  // 1. Fetch PO current state
  const { data: po, error: fetchErr } = await supabase
    .from("purchase_orders")
    .select("id, code, supplier_id, supplier_name, total, paid, debt, status")
    .eq("id", input.referenceId)
    .single();

  if (fetchErr) handleError(fetchErr, "recordPurchasePayment.fetch");
  if (!po) throw new Error("Không tìm thấy đơn nhập hàng");

  const currentDebt = Number(po.debt ?? 0);
  const currentPaid = Number(po.paid ?? 0);

  if (currentDebt <= 0) {
    throw new Error("Đơn nhập hàng này không còn công nợ");
  }
  if (input.amount <= 0) {
    throw new Error("Số tiền thanh toán phải lớn hơn 0");
  }
  if (input.amount > currentDebt) {
    throw new Error(
      `Số tiền thanh toán (${input.amount}) vượt quá công nợ còn lại (${currentDebt})`
    );
  }

  const newPaid = currentPaid + input.amount;
  const newDebt = currentDebt - input.amount;

  // 2. Create cash payment (phiếu chi — trả nợ NCC)
  const cashCode = await nextEntityCode("cash_payment", { tenantId: ctx.tenantId });

  const cashData: CashTransactionInsert = {
    tenant_id: ctx.tenantId,
    branch_id: ctx.branchId,
    code: cashCode,
    type: "payment",
    category: "Trả nợ nhà cung cấp",
    amount: input.amount,
    counterparty: po.supplier_name,
    payment_method: input.paymentMethod,
    reference_type: "purchase_order",
    reference_id: po.id,
    note: input.note || `Trả nợ đơn nhập hàng ${po.code}`,
    created_by: ctx.userId,
  };

  const { data: cashRow, error: cashErr } = await supabase
    .from("cash_transactions")
    .insert(cashData)
    .select("id")
    .single();
  if (cashErr) handleError(cashErr, "recordPurchasePayment.cash");

  // 3. Update PO paid/debt
  const { error: poUpd } = await supabase
    .from("purchase_orders")
    .update({ paid: newPaid, debt: newDebt } as Record<string, unknown>)
    .eq("id", po.id);
  if (poUpd) handleError(poUpd, "recordPurchasePayment.po_update");

  // 4. Update supplier.debt if supplier_id exists
  if (po.supplier_id) {
    const { data: sup, error: supFetch } = await supabase
      .from("suppliers")
      .select("debt")
      .eq("id", po.supplier_id)
      .single();

    if (!supFetch && sup) {
      const supNewDebt = Math.max(0, Number(sup.debt ?? 0) - input.amount);
      const { error: supUpd } = await supabase
        .from("suppliers")
        .update({ debt: supNewDebt } as Record<string, unknown>)
        .eq("id", po.supplier_id);
      if (supUpd) handleError(supUpd, "recordPurchasePayment.supplier_update");
    }
  }

  return {
    cashTransactionId: cashRow.id,
    cashCode,
    newPaid,
    newDebt,
  };
}

/**
 * Get payment history for an invoice or purchase order.
 */
export async function getPaymentHistory(
  referenceType: "invoice" | "purchase_order",
  referenceId: string
) {
  const supabase = getClient();

  const { data, error } = await supabase
    .from("cash_transactions")
    .select("id, code, type, amount, payment_method, note, created_at")
    .eq("reference_type", referenceType)
    .eq("reference_id", referenceId)
    .order("created_at", { ascending: false });

  if (error) handleError(error, "getPaymentHistory");

  return (data ?? []).map((row) => ({
    id: row.id,
    code: row.code,
    type: row.type as "receipt" | "payment",
    amount: row.amount,
    paymentMethod: row.payment_method,
    note: row.note,
    date: row.created_at,
  }));
}
