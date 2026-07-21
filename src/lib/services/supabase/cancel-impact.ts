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

export type CancelDocType = "invoice" | "purchase";
export type RefundMethod = "cash" | "transfer" | "card";

export interface NegativeStockRow {
  productName: string;
  available: number;
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

  // ─── Công nợ (sẽ xóa — chỉ điều chỉnh sổ, không cần làm tay) ───
  debtAmount: number;
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
      "id, code, status, total, paid, debt, payment_method, branch_id, customer_id, customer_name",
    )
    .eq("tenant_id", ctx.tenantId)
    .eq("id", invoiceId)
    .single();
  if (error) handleError(error, "getInvoiceCancelImpact.fetch");
  if (!inv) throw new Error("Không tìm thấy hóa đơn");

  const hasSideEffects = inv.status === "completed";
  const paid = Number(inv.paid ?? 0);
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
  const [itemCount, branchName, loyalty, pendingShipping, custDebt] =
    await Promise.all([
      countInvoiceItems(invoiceId, ctx.tenantId),
      resolveBranchName(inv.branch_id, ctx.tenantId),
      sumLoyaltyEarned(invoiceId, ctx.tenantId),
      countPendingShipping(invoiceId, ctx.tenantId),
      inv.customer_id ? fetchCustomerDebt(inv.customer_id, ctx.tenantId) : Promise.resolve(null),
    ]);

  base.stockLineCount = itemCount;
  base.branchName = branchName;
  base.loyaltyPoints = loyalty;
  base.pendingShippingCount = pendingShipping;

  if (paid > 0) {
    base.cashDirection = "refund_to_customer";
    base.cashAmount = paid;
  }
  if (debt > 0) {
    base.debtAmount = debt;
    base.counterpartyDebtBefore = custDebt;
  }

  return base;
}

/* ------------------------------------------------------------------ */
/*  Helpers (mỗi hàm 1 truy vấn nhỏ, defensive — lỗi phụ không chặn)   */
/* ------------------------------------------------------------------ */

async function countInvoiceItems(invoiceId: string, _tenantId: string): Promise<number> {
  // invoice_items KHÔNG có cột tenant_id — đã scope qua invoice_id (thuộc tenant).
  const supabase = getClient();
  const { count } = await supabase
    .from("invoice_items")
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

async function fetchCustomerDebt(customerId: string, tenantId: string): Promise<number | null> {
  const supabase = getClient();
  const { data } = await supabase
    .from("customers")
    .select("debt")
    .eq("tenant_id", tenantId)
    .eq("id", customerId)
    .maybeSingle();
  return data ? Number(data.debt ?? 0) : null;
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
    .select("id, code, status, total, paid, debt, branch_id, supplier_id, supplier_name")
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

  const [items, branchName, suppDebt] = await Promise.all([
    fetchPurchaseItems(purchaseOrderId, ctx.tenantId),
    resolveBranchName(po.branch_id, ctx.tenantId),
    po.supplier_id ? fetchSupplierDebt(po.supplier_id, ctx.tenantId) : Promise.resolve(null),
  ]);

  base.branchName = branchName;
  base.stockLineCount = items.filter((i) => i.received > 0).length;

  // Cảnh báo tồn âm: mirror guard RPC — products.stock < received_quantity
  // (đã bán/dùng bớt → hoàn nhập sẽ đẩy tồn âm). Cảnh báo nhưng vẫn cho hủy.
  const stockMap = await fetchProductStocks(
    items.map((i) => i.productId),
    ctx.tenantId,
  );
  for (const it of items) {
    if (it.received <= 0) continue;
    const onHand = stockMap.get(it.productId) ?? 0;
    if (onHand < it.received) {
      base.negativeStock.push({
        productName: it.productName,
        available: onHand,
        needed: it.received,
        unit: it.unit,
      });
    }
  }

  if (paid > 0) {
    base.cashDirection = "collect_from_supplier";
    base.cashAmount = paid;
  }
  if (debt > 0) {
    base.debtAmount = debt;
    base.counterpartyDebtBefore = suppDebt;
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

async function fetchProductStocks(
  productIds: string[],
  tenantId: string,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const ids = productIds.filter(Boolean);
  if (ids.length === 0) return map;
  const supabase = getClient();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase
      .from("products")
      .select("id, stock")
      .eq("tenant_id", tenantId)
      .in("id", ids.slice(i, i + 200));
    for (const r of data ?? []) map.set(r.id as string, Number((r as { stock?: number }).stock ?? 0));
  }
  return map;
}

async function fetchSupplierDebt(supplierId: string, tenantId: string): Promise<number | null> {
  const supabase = getClient();
  const { data } = await supabase
    .from("suppliers")
    .select("debt")
    .eq("tenant_id", tenantId)
    .eq("id", supplierId)
    .maybeSingle();
  return data ? Number(data.debt ?? 0) : null;
}
