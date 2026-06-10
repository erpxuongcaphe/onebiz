/**
 * Payment Recording Service — ghi nhận thanh toán từng phần
 *
 * recordInvoicePayment()  → KH trả nợ hóa đơn (phiếu thu + update invoice.paid/debt + customer.debt)
 * recordPurchasePayment() → Trả nợ NCC (phiếu chi + update PO.paid/debt + supplier.debt)
 *
 * Sprint SỔ-QUỸ-2: chuyển sang gọi Postgres RPC atomic (migration 00046).
 * Trước đây client chạy 4 step không atomic → fail giữa chừng → cash đã
 * ghi mà debt chưa giảm → công nợ ảo.
 *
 * Fallback: nếu RPC chưa migrate (404), tự động chạy code 4-step cũ.
 */

import { getClient, getCurrentContext, handleError } from "./base";
import { nextEntityCode } from "./stock-adjustments";
import { recordAuditLog } from "./audit";
import type { Database } from "@/lib/supabase/types";

type CashTransactionInsert = Database["public"]["Tables"]["cash_transactions"]["Insert"];

export interface RecordPaymentInput {
  /** invoice or purchase_order ID */
  referenceId: string;
  amount: number;
  paymentMethod: "cash" | "transfer" | "card" | "ewallet";
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

  // Try atomic RPC (migration 00046) trước. Nếu chưa migrate → fall back
  // 4-step legacy (không atomic).
  // RPC names cast as never vì supabase generated types chưa biết RPC mới.
  try {
    const { data, error } = await supabase.rpc(
      "record_invoice_payment" as never,
      {
        p_invoice_id: input.referenceId,
        p_amount: input.amount,
        p_payment_method: input.paymentMethod,
        p_note: input.note ?? null,
        p_branch_id: ctx.branchId,
        p_user_id: ctx.userId,
      } as never,
    );
    if (!error && data) {
      const r = data as unknown as Record<string, unknown>;
      // Audit log: thanh toán hóa đơn là thao tác tài chính nhạy cảm.
      // CEO cần trace ai thu nợ KH nào, bao nhiêu, khi nào.
      await recordAuditLog({
        entityType: "invoice",
        entityId: input.referenceId,
        action: "payment",
        newData: {
          cash_transaction_id: r.cash_transaction_id,
          cash_code: r.cash_code,
          amount: input.amount,
          payment_method: input.paymentMethod,
          new_paid: r.new_paid,
          new_debt: r.new_debt,
        },
      });
      return {
        cashTransactionId: r.cash_transaction_id as string,
        cashCode: r.cash_code as string,
        newPaid: Number(r.new_paid ?? 0),
        newDebt: Number(r.new_debt ?? 0),
      };
    }
    // RPC chưa tồn tại (PGRST202 hoặc 404) — fall back legacy
    if (error && !/(does not exist|404|PGRST202)/i.test(error.message)) {
      handleError(error, "recordInvoicePayment.rpc");
    }
  } catch (err) {
    console.warn(
      "[recordInvoicePayment] RPC unavailable, falling back to 4-step:",
      err,
    );
  }

  // 1. Fetch invoice current state (filter tenant defense)
  const { data: inv, error: fetchErr } = await supabase
    .from("invoices")
    .select("id, code, customer_id, customer_name, total, paid, debt, status")
    .eq("tenant_id", ctx.tenantId)
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
    // Cast vì DB types chưa biết "ewallet" (migration 00046 mở rộng enum).
    // RPC path đã bypass type check; legacy path vẫn cần cast.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    payment_method: input.paymentMethod as any,
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
    .eq("tenant_id", ctx.tenantId)
    .eq("id", inv.id);
  if (invUpd) handleError(invUpd, "recordInvoicePayment.invoice_update");

  // 4. customers.debt — KHÔNG cần update tay nữa.
  //    CEO 06/06/2026 Phase 5 research (Odoo + SAP B1 + PostgreSQL best
  //    practice): trigger 00130 trên invoices đã tự recompute
  //    customers.debt = SUM(invoices.debt) WHERE status='completed' rồi.
  //    App-side write ở đây + trigger = race condition → KH Xưởng
  //    Premium BL bị ghi nhầm 280k thay vì 140k.
  //    Single Source of Truth = trigger. Đây là pattern Odoo 17 chọn.

  // Audit log cho legacy path (RPC path đã audit ở trên).
  await recordAuditLog({
    entityType: "invoice",
    entityId: inv.id,
    action: "payment",
    newData: {
      cash_transaction_id: cashRow.id,
      cash_code: cashCode,
      amount: input.amount,
      payment_method: input.paymentMethod,
      new_paid: newPaid,
      new_debt: newDebt,
    },
  });

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

  // Try atomic RPC (migration 00046)
  try {
    const { data, error } = await supabase.rpc(
      "record_purchase_payment" as never,
      {
        p_purchase_order_id: input.referenceId,
        p_amount: input.amount,
        p_payment_method: input.paymentMethod,
        p_note: input.note ?? null,
        p_branch_id: ctx.branchId,
        p_user_id: ctx.userId,
      } as never,
    );
    if (!error && data) {
      const r = data as unknown as Record<string, unknown>;
      await recordAuditLog({
        entityType: "purchase_order",
        entityId: input.referenceId,
        action: "payment",
        newData: {
          cash_transaction_id: r.cash_transaction_id,
          cash_code: r.cash_code,
          amount: input.amount,
          payment_method: input.paymentMethod,
          new_paid: r.new_paid,
          new_debt: r.new_debt,
        },
      });
      return {
        cashTransactionId: r.cash_transaction_id as string,
        cashCode: r.cash_code as string,
        newPaid: Number(r.new_paid ?? 0),
        newDebt: Number(r.new_debt ?? 0),
      };
    }
    if (error && !/(does not exist|404|PGRST202)/i.test(error.message)) {
      handleError(error, "recordPurchasePayment.rpc");
    }
  } catch (err) {
    console.warn(
      "[recordPurchasePayment] RPC unavailable, falling back to 4-step:",
      err,
    );
  }

  // 1. Fetch PO current state (filter tenant defense)
  const { data: po, error: fetchErr } = await supabase
    .from("purchase_orders")
    .select("id, code, supplier_id, supplier_name, total, paid, debt, status")
    .eq("tenant_id", ctx.tenantId)
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
    // Cast vì DB types chưa biết "ewallet" (migration 00046 mở rộng enum).
    // RPC path đã bypass type check; legacy path vẫn cần cast.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    payment_method: input.paymentMethod as any,
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
    .eq("tenant_id", ctx.tenantId)
    .eq("id", po.id);
  if (poUpd) handleError(poUpd, "recordPurchasePayment.po_update");

  // 4. suppliers.debt — KHÔNG cần update tay nữa (CEO 10/06/2026, audit P1).
  //    Trigger trg_purchase_orders_sync_supplier_debt (migration 00130) đã
  //    AFTER UPDATE OF debt trên purchase_orders → tự recompute
  //    suppliers.debt = SUM(PO completed/partial) rồi. Trừ tay ở đây = trừ
  //    2 lần (giống bug RPC 00046 đã fix ở 00134). Đồng bộ với customer side
  //    (đã gỡ trước đó). Giữ fallback path "tinh khiết" — chỉ update PO.debt.

  // Audit log cho legacy path
  await recordAuditLog({
    entityType: "purchase_order",
    entityId: po.id,
    action: "payment",
    newData: {
      cash_transaction_id: cashRow.id,
      cash_code: cashCode,
      amount: input.amount,
      payment_method: input.paymentMethod,
      new_paid: newPaid,
      new_debt: newDebt,
    },
  });

  return {
    cashTransactionId: cashRow.id,
    cashCode,
    newPaid,
    newDebt,
  };
}

/**
 * CEO 03/06/2026 — Sprint 3 (Công nợ C1): Get all unpaid invoices for a customer.
 * Dùng cho dialog "Thu tổng nợ KH" — list HĐ debt > 0, sort oldest first cho
 * auto-allocate FIFO. Filter status != 'cancelled' để bỏ HĐ đã huỷ.
 */
export interface OpenInvoiceLine {
  id: string;
  code: string;
  date: string;
  total: number;
  paid: number;
  debt: number;
  ageDays: number;
}

export async function getOpenInvoicesByCustomer(
  customerId: string,
): Promise<OpenInvoiceLine[]> {
  const supabase = getClient();
  const ctx = await getCurrentContext();

  const { data, error } = await supabase
    .from("invoices")
    .select("id, code, created_at, total, paid, debt, status")
    .eq("tenant_id", ctx.tenantId)
    .eq("customer_id", customerId)
    .gt("debt", 0)
    .neq("status", "cancelled")
    .order("created_at", { ascending: true });

  if (error) handleError(error, "getOpenInvoicesByCustomer");

  const now = Date.now();
  return (data ?? []).map((row) => {
    const created = new Date(row.created_at as string).getTime();
    const ageDays = Math.max(0, Math.floor((now - created) / 86400000));
    return {
      id: row.id as string,
      code: row.code as string,
      date: row.created_at as string,
      total: Number(row.total ?? 0),
      paid: Number(row.paid ?? 0),
      debt: Number(row.debt ?? 0),
      ageDays,
    };
  });
}

/**
 * Get all unpaid purchase orders for a supplier (dialog "Trả tổng nợ NCC").
 */
export interface OpenPurchaseLine {
  id: string;
  code: string;
  date: string;
  total: number;
  paid: number;
  debt: number;
  ageDays: number;
}

export async function getOpenPurchasesBySupplier(
  supplierId: string,
): Promise<OpenPurchaseLine[]> {
  const supabase = getClient();
  const ctx = await getCurrentContext();

  const { data, error } = await supabase
    .from("purchase_orders")
    .select("id, code, created_at, total, paid, debt, status")
    .eq("tenant_id", ctx.tenantId)
    .eq("supplier_id", supplierId)
    .gt("debt", 0)
    .neq("status", "cancelled")
    .order("created_at", { ascending: true });

  if (error) handleError(error, "getOpenPurchasesBySupplier");

  const now = Date.now();
  return (data ?? []).map((row) => {
    const created = new Date(row.created_at as string).getTime();
    const ageDays = Math.max(0, Math.floor((now - created) / 86400000));
    return {
      id: row.id as string,
      code: row.code as string,
      date: row.created_at as string,
      total: Number(row.total ?? 0),
      paid: Number(row.paid ?? 0),
      debt: Number(row.debt ?? 0),
      ageDays,
    };
  });
}

/**
 * Get payment history for an invoice or purchase order.
 */
export async function getPaymentHistory(
  referenceType: "invoice" | "purchase_order",
  referenceId: string
) {
  const supabase = getClient();
  const ctx = await getCurrentContext();

  const { data, error } = await supabase
    .from("cash_transactions")
    .select("id, code, type, amount, payment_method, note, created_at")
    .eq("tenant_id", ctx.tenantId)
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
