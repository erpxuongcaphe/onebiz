/**
 * Cancel Impact — tính sẵn TÁC ĐỘNG THẬT của việc hủy 1 chứng từ, lên 3 sổ
 * (Kho — Tiền — Công nợ) + điểm + vận đơn, từ chính dữ liệu chứng từ đó.
 *
 * CEO 21/07/2026: mỗi lần hủy phải hiện bảng tác động có SỐ CỤ THỂ, tách rõ
 * "máy tự ghi" vs "người phải làm tay" (hoàn tiền mặt cho khách/NCC). Đây là
 * lớp ĐỌC — không đụng dữ liệu; hàm atomic hủy mới là nơi ghi.
 *
 * Dùng chung 2 nghiệp vụ: hủy hóa đơn bán (invoice) + hủy/hoàn nhập phiếu
 * nhập (purchase). Component CancelImpactDialog render cùng 1 khuôn.
 */

import { getClient, getCurrentContext, handleError } from "./base";
import { getPaymentHistory } from "./payments";

export type CancelDocType = "invoice" | "purchase";
export type RefundMethod = "cash" | "transfer" | "card";

export interface NegativeStockRow {
  productName: string;
  available: number | null;
  needed: number;
  unit: string;
}

export interface CancelImpact {
  docType: CancelDocType;
  code: string;
  status: string;
  /** false = nháp/đặt hàng/chưa nhận → hủy KHÔNG phát sinh kho/tiền/nợ (dialog gọn tối đa). */
  hasSideEffects: boolean;
  counterpartyName: string | null;
  total: number;

  // ─── Kho ───
  stockLineCount: number;
  branchName: string | null;
  /** Hoàn nhập: dòng có nguy cơ tồn âm (đã bán/dùng bớt). Rỗng = an toàn. */
  negativeStock: NegativeStockRow[];

  // ─── Tiền (đã thu/đã trả → cần hoàn tay) ───
  /** refund_to_customer = trả khách; collect_from_supplier = đòi lại NCC; null = không có tiền đã trao. */
  cashDirection: "refund_to_customer" | "collect_from_supplier" | null;
  cashAmount: number;
  suggestedMethod: RefundMethod;
  refundMethods?: Partial<Record<RefundMethod, number>>;

  // ─── Công nợ (sẽ xóa — chỉ điều chỉnh sổ, không cần làm tay) ───
  debtAmount: number;
  /** Company-wide balance is intentionally not read by document cancellation previews. */
  counterpartyDebtBefore: number | null;

  // ─── Điểm tích lũy ───
  loyaltyPoints: number;

  // ─── Vận đơn chưa giao sẽ hủy kèm ───
  pendingShippingCount: number;
}

function normalizeMethod(m: string | null | undefined): RefundMethod {
  return m === "transfer" || m === "card" ? m : "cash";
}

/**
 * Tác động khi hủy 1 HÓA ĐƠN BÁN.
 * - Nháp/đặt hàng (chưa completed): hasSideEffects=false → chỉ gỡ đơn.
 * - Completed: hoàn kho + hoàn tiền đã thu + xóa nợ + hoàn điểm.
 */
export async function getInvoiceCancelImpact(
  invoiceId: string,
): Promise<CancelImpact> {
  const supabase = getClient();
  const ctx = await getCurrentContext();

  const { data: inv, error } = await supabase
    .from("invoices")
    .select(
      "id, code, status, total, paid, debt, payment_method, branch_id, customer_name",
    )
    .eq("tenant_id", ctx.tenantId)
    .eq("id", invoiceId)
    .single();
  if (error) handleError(error, "getInvoiceCancelImpact.fetch");
  if (!inv) throw new Error("Không tìm thấy hóa đơn");

  const hasSideEffects = inv.status === "completed";
  const debt = Number(inv.debt ?? 0);

  const base: CancelImpact = {
    docType: "invoice",
    code: inv.code,
    status: inv.status,
    hasSideEffects,
    counterpartyName: inv.customer_name ?? null,
    total: Number(inv.total ?? 0),
    stockLineCount: 0,
    branchName: null,
    negativeStock: [],
    cashDirection: null,
    cashAmount: 0,
    suggestedMethod: normalizeMethod(inv.payment_method),
    debtAmount: 0,
    counterpartyDebtBefore: null,
    loyaltyPoints: 0,
    pendingShippingCount: 0,
  };

  if (!hasSideEffects) {
    // Nháp/đặt hàng — hủy chỉ gỡ đơn + hủy vận đơn chưa giao (nếu có).
    base.pendingShippingCount = await countPendingShipping(invoiceId, ctx.tenantId);
    return base;
  }

  // ─── Completed: tính đủ tác động (chạy song song cho nhanh) ───
  const [itemCount, branchName, loyalty, pendingShipping, receipts] =
    await Promise.all([
      countInvoiceItems(invoiceId, ctx.tenantId),
      resolveBranchName(inv.branch_id, ctx.tenantId),
      sumLoyaltyEarned(invoiceId, ctx.tenantId),
      countPendingShipping(invoiceId, ctx.tenantId),
      readInvoiceReceipts(invoiceId, ctx.tenantId, inv.branch_id),
    ]);

  base.stockLineCount = itemCount;
  base.branchName = branchName;
  base.loyaltyPoints = loyalty;
  base.pendingShippingCount = pendingShipping;

  base.refundMethods = receipts;
  const refund = Object.values(receipts).reduce((sum, amount) => sum + amount, 0);
  if (refund > 0) {
    base.cashDirection = "refund_to_customer";
    base.cashAmount = refund;
  }
  if (debt > 0) {
    base.debtAmount = debt;
  }

  return base;
}

async function readInvoiceReceipts(invoiceId: string, _tenantId: string, branchId: string | null) {
  if (!branchId) throw new Error("Hóa đơn chưa xác định chi nhánh. Kiểm tra trước khi hủy.");
  const rows = await getPaymentHistory("invoice", invoiceId);
  const methods: Partial<Record<RefundMethod, number>> = {};
  for (const row of rows) {
    if (typeof row.status !== "string" || !Number.isFinite(Number(row.amount))) {
      throw new Error("Chưa xác nhận được khoản thu của hóa đơn. Vui lòng tải lại.");
    }
    if (row.type !== "receipt" || row.status !== "completed") continue;
    const method = normalizeMethod(row.paymentMethod);
    methods[method] = (methods[method] ?? 0) + Number(row.amount);
  }
  return methods;
}

/* ------------------------------------------------------------------ */
/*  Helpers (mỗi hàm 1 truy vấn nhỏ, defensive — lỗi phụ không chặn)   */
/* ------------------------------------------------------------------ */

async function countInvoiceItems(invoiceId: string, _tenantId: string): Promise<number> {
  // invoice_items KHÔNG có cột tenant_id — đã scope qua invoice_id (thuộc tenant).
  const supabase = getClient();
  const { count } = await supabase
    .from("invoice_items_scoped")
    .select("id", { count: "exact", head: true })
    .eq("invoice_id", invoiceId);
  return count ?? 0;
}

async function resolveBranchName(
  branchId: string | null | undefined,
  tenantId: string,
): Promise<string | null> {
  if (!branchId) return null;
  const supabase = getClient();
  const { data } = await supabase
    .from("branches")
    .select("name")
    .eq("tenant_id", tenantId)
    .eq("id", branchId)
    .maybeSingle();
  return data?.name ?? null;
}

async function sumLoyaltyEarned(invoiceId: string, tenantId: string): Promise<number> {
  try {
    const supabase = getClient();
    const { data } = await supabase
      .from("loyalty_transactions")
      .select("points")
      .eq("tenant_id", tenantId)
      .eq("reference_id", invoiceId)
      .gt("points", 0);
    return (data ?? []).reduce((s, r) => s + Number((r as { points?: number }).points ?? 0), 0);
  } catch {
    return 0;
  }
}

async function countPendingShipping(invoiceId: string, tenantId: string): Promise<number> {
  try {
    const supabase = getClient();
    const { count } = await supabase
      .from("shipping_orders")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("invoice_id", invoiceId)
      .eq("status", "pending");
    return count ?? 0;
  } catch {
    return 0;
  }
}

/* ================================================================== */
/*  PHIẾU NHẬP — hủy = hoàn nhập (đảo tồn + đòi lại NCC + xóa nợ NCC)   */
/* ================================================================== */

/**
 * Tác động khi hủy/hoàn nhập 1 PHIẾU NHẬP.
 * - Chưa nhận hàng (draft/ordered): hasSideEffects=false → chỉ gỡ phiếu.
 * - Đã nhận (partial/completed): trừ lại tồn (cảnh báo nếu đã bán bớt →
 *   tồn âm), NCC hoàn tiền đã trả, xóa nợ NCC.
 */
export async function getPurchaseCancelImpact(
  purchaseOrderId: string,
): Promise<CancelImpact> {
  const supabase = getClient();
  const ctx = await getCurrentContext();

  const { data: po, error } = await supabase
    .from("purchase_orders")
    .select("id, code, status, total, paid, debt, branch_id, supplier_name")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", purchaseOrderId)
    .single();
  if (error) handleError(error, "getPurchaseCancelImpact.fetch");
  if (!po) throw new Error("Không tìm thấy phiếu nhập");

  // Đã nhận hàng = có tác động kho/tiền/nợ để đảo.
  const received = ["partial", "completed", "ordered"].includes(po.status) && Number(po.paid ?? 0) >= 0;
  const hasReceivedStock = po.status === "partial" || po.status === "completed";
  const paid = Number(po.paid ?? 0);
  const debt = Number(po.debt ?? 0);

  const base: CancelImpact = {
    docType: "purchase",
    code: po.code,
    status: po.status,
    hasSideEffects: hasReceivedStock,
    counterpartyName: po.supplier_name ?? null,
    total: Number(po.total ?? 0),
    stockLineCount: 0,
    branchName: null,
    negativeStock: [],
    cashDirection: null,
    cashAmount: 0,
    suggestedMethod: "cash",
    debtAmount: 0,
    counterpartyDebtBefore: null,
    loyaltyPoints: 0,
    pendingShippingCount: 0,
  };

  if (!hasReceivedStock) {
    void received; // chưa nhận → chỉ gỡ phiếu, không đảo gì
    return base;
  }

  const [items, branchName] = await Promise.all([
    fetchPurchaseItems(purchaseOrderId, ctx.tenantId),
    resolveBranchName(po.branch_id, ctx.tenantId),
  ]);

  base.branchName = branchName;
  base.stockLineCount = items.filter((i) => i.received > 0).length;

  // The server returns only shortage indicators for this authorized document.
  // Never infer zero from a hidden products_scoped balance.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: risks, error: riskError } = await (supabase as any).rpc("get_purchase_cancel_stock_risks", { p_order_id: purchaseOrderId });
  if (riskError) handleError(riskError, "getPurchaseCancelImpact.stock");
  if (!Array.isArray(risks)) throw new Error("Không xác định được cảnh báo tồn kho của phiếu nhập.");
  base.negativeStock = risks.map((risk: { product_name?: unknown; unit?: unknown; needed?: unknown }) => {
    const needed = Number(risk.needed);
    if (typeof risk.product_name !== "string" || risk.needed == null || !Number.isFinite(needed) || needed <= 0) {
      throw new Error("Cảnh báo tồn kho của phiếu nhập chưa hợp lệ.");
    }
    return { productName: risk.product_name, available: null, needed, unit: typeof risk.unit === "string" ? risk.unit : "" };
  });

  if (paid > 0) {
    base.cashDirection = "collect_from_supplier";
    base.cashAmount = paid;
  }
  if (debt > 0) {
    base.debtAmount = debt;
  }

  return base;
}

async function fetchPurchaseItems(
  purchaseOrderId: string,
  _tenantId: string,
): Promise<{ productId: string; productName: string; received: number; unit: string }[]> {
  // purchase_order_items KHÔNG có tenant_id — scope qua purchase_order_id.
  const supabase = getClient();
  const { data } = await supabase
    .from("purchase_order_items")
    .select("product_id, product_name, received_quantity, unit")
    .eq("purchase_order_id", purchaseOrderId);
  return (data ?? []).map((r) => ({
    productId: r.product_id as string,
    productName: (r.product_name as string) ?? "",
    received: Number((r as { received_quantity?: number }).received_quantity ?? 0),
    unit: (r.unit as string) ?? "",
  }));
}
