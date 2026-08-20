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
 * Fail closed: nếu RPC lỗi hoặc chưa migrate thì dừng, tuyệt đối không ghi
 * nhiều bước ở client vì có thể tạo phiếu quỹ nhưng chưa cập nhật công nợ.
 */

import { getClient, getCurrentContext, handleError } from "./base";

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
  await getCurrentContext();

  const { data, error } = await supabase.rpc(
    "record_invoice_payment" as never,
    {
      p_invoice_id: input.referenceId,
      p_amount: input.amount,
      p_payment_method: input.paymentMethod,
      p_note: input.note ?? null,
      // Người thực hiện, công ty và chi nhánh phải được RPC tự suy ra từ phiên đăng nhập.
      p_branch_id: null,
      p_user_id: null,
    } as never,
  );
  if (error) handleError(error, "recordInvoicePayment.rpc");
  if (!data) {
    throw new Error("Không nhận được kết quả ghi nhận thanh toán hóa đơn");
  }

  const result = data as unknown as Record<string, unknown>;
  return {
    cashTransactionId: result.cash_transaction_id as string,
    cashCode: result.cash_code as string,
    newPaid: Number(result.new_paid ?? 0),
    newDebt: Number(result.new_debt ?? 0),
  };
}

/**
 * Ghi nhận thanh toán cho đơn nhập hàng (trả nợ nhà cung cấp).
 * Toàn bộ kiểm tra và cập nhật chạy trong một giao dịch Postgres.
 */
export async function recordPurchasePayment(
  input: RecordPaymentInput
): Promise<RecordPaymentResult> {
  const supabase = getClient();
  await getCurrentContext();

  const { data, error } = await supabase.rpc(
    "record_purchase_payment" as never,
    {
      p_purchase_order_id: input.referenceId,
      p_amount: input.amount,
      p_payment_method: input.paymentMethod,
      p_note: input.note ?? null,
      p_branch_id: null,
      p_user_id: null,
    } as never,
  );
  if (error) handleError(error, "recordPurchasePayment.rpc");
  if (!data) {
    throw new Error("Không nhận được kết quả ghi nhận thanh toán phiếu nhập");
  }

  const result = data as unknown as Record<string, unknown>;
  return {
    cashTransactionId: result.cash_transaction_id as string,
    cashCode: result.cash_code as string,
    newPaid: Number(result.new_paid ?? 0),
    newDebt: Number(result.new_debt ?? 0),
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
  branchId?: string | null,
): Promise<OpenInvoiceLine[]> {
  const supabase = getClient();
  const ctx = await getCurrentContext();

  let query = supabase
    .from("invoices")
    .select("id, code, ngay_chung_tu, total, paid, debt, status")
    .eq("tenant_id", ctx.tenantId)
    .eq("customer_id", customerId)
    .gt("debt", 0)
    // 20/07/2026 — chỉ HĐ hoàn tất (nháp/đặt hàng mang debt=total hiển thị,
    // không phải nợ thật; HD001438 bị thu 2 lần vì lọt nháp vào đây)
    .eq("status", "completed");

  if (branchId) query = query.eq("branch_id", branchId);
  const { data, error } = await query.order("ngay_chung_tu", { ascending: true });

  if (error) handleError(error, "getOpenInvoicesByCustomer");

  const now = Date.now();
  return (data ?? []).map((row) => {
    const created = new Date(row.ngay_chung_tu as string).getTime();
    const ageDays = Math.max(0, Math.floor((now - created) / 86400000));
    return {
      id: row.id as string,
      code: row.code as string,
      date: row.ngay_chung_tu as string,
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
  branchId?: string | null,
): Promise<OpenPurchaseLine[]> {
  const supabase = getClient();
  const ctx = await getCurrentContext();

  let query = supabase
    .from("purchase_orders")
    .select("id, code, created_at, total, paid, debt, status")
    .eq("tenant_id", ctx.tenantId)
    .eq("supplier_id", supplierId)
    .gt("debt", 0)
    // 20/07/2026 — chỉ phiếu đã nhập kho (completed/partial) mới có nợ thật
    .in("status", ["completed", "partial"]);

  if (branchId) query = query.eq("branch_id", branchId);
  const { data, error } = await query.order("created_at", { ascending: true });

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

  // 20/07: lấy cả status — phiếu ĐÃ HỦY vẫn hiện (giữ vết đối soát) nhưng
  // UI gắn badge và không cộng vào tổng (vụ HD001438 hủy PT000117).
  // Cast any: generated types chưa biết cột status của cash_transactions.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from("cash_transactions") as any)
    .select("id, code, type, amount, payment_method, note, created_at, status")
    .eq("tenant_id", ctx.tenantId)
    .eq("reference_type", referenceType)
    .eq("reference_id", referenceId)
    .order("created_at", { ascending: false });

  if (error) handleError(error, "getPaymentHistory");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((row) => ({
    id: row.id,
    code: row.code,
    type: row.type as "receipt" | "payment",
    amount: row.amount,
    paymentMethod: row.payment_method,
    note: row.note,
    date: row.created_at,
    cancelled: (row as { status?: string }).status === "cancelled",
  }));
}
