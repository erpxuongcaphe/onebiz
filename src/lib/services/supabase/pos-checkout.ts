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
import { isRpcUnavailable } from "./rpc-utils";

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
  vatRate?: number; // Thuế suất GTGT (%) — 0, 5, 8, 10
}

/** Một dòng trong bảng tách thanh toán hỗn hợp */
export interface PaymentBreakdownItem {
  method: "cash" | "transfer" | "card";
  amount: number;
}

export interface PosCheckoutInput {
  tenantId: string;
  branchId: string;
  createdBy: string;
  customerId?: string | null;
  customerName: string;
  items: PosCheckoutItem[];
  paymentMethod: "cash" | "transfer" | "card" | "mixed";
  /** Khi paymentMethod="mixed", tách chi tiết từng phương thức */
  paymentBreakdown?: PaymentBreakdownItem[];
  subtotal: number;
  discountAmount: number;
  total: number;
  paid: number;
  note?: string;
  /** Nguồn: 'pos' (mặc định), 'fnb', 'online' */
  source?: "pos" | "fnb" | "online";
  /**
   * ID ca đang mở tại quầy. Nếu có → invoice + cash_transaction sẽ gắn
   * `shift_id` để báo cáo X/Z của ca tính đúng (không trộn với ca khác).
   */
  shiftId?: string | null;
  /** KM-4: promotion áp dụng cho hoá đơn — null = không có KM. */
  promotionId?: string | null;
  /** KM-4: số tiền giảm bởi KM (đã loại line + manual order discount). */
  promotionDiscount?: number;
  /** KM-4: trị giá hàng tặng kèm (sum freeItems × unitPrice). */
  promotionFreeValue?: number;
  /**
   * CEO 04/05/2026 — Idempotency key chống duplicate invoice.
   * Generate UUID per form session (khi cashier "Tạo đơn mới" hoặc "Tiếp tục
   * đơn"). Nếu user ấn Thanh toán 2 lần (network slow + retry) → server
   * detect trùng session_id → return existing invoice thay vì tạo mới.
   */
  clientSessionId?: string | null;
}

/**
 * Day 18/05/2026 (CEO): mỗi SKU có BOM được expand thành 1 BomConsumeResult
 * sau khi RPC `pos_complete_checkout_atomic` / `fnb_complete_payment_atomic`
 * trừ NVL theo công thức. UI dùng để hiển thị toast tiêu hao + warning âm tồn.
 */
export interface BomConsumedMaterial {
  material_id: string;
  material_code?: string;
  material_name?: string;
  qty: number;
  unit?: string;
}

export interface BomConsumeWarning {
  material_id?: string;
  material_code?: string;
  material_name?: string;
  available?: number;
  required?: number;
  reason: string;
}

export interface BomConsumeResult {
  product_id: string;
  product_name?: string;
  sale_qty: number;
  topping?: boolean;
  result: {
    success: boolean;
    bom_id: string | null;
    bom_name?: string;
    consumed: BomConsumedMaterial[];
    warnings: BomConsumeWarning[];
    allow_negative?: boolean;
  };
}

export interface PosCheckoutResult {
  invoiceId: string;
  invoiceCode: string;
  /** Day 18/05/2026 (CEO): BOM consume break-down — dùng cho toast */
  bomConsumeResults?: BomConsumeResult[];
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
 *
 * CEO 29/05/2026: tôn trọng quy tắc "SKU có BOM không giữ tồn".
 * - SP có `has_bom = true` (SKU ghép từ NVL) → KHÔNG trừ tồn SKU; gọi
 *   `consume_bom_for_sale` để trừ NVL theo công thức (RPC tự ghi
 *   stock_movements type='bom_consume' cho NVL).
 * - SP thường (`has_bom = false`) → ghi 1 stock_movement 'out' + trừ tồn
 *   chính nó (atomic SQL increment) như cũ.
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
  // CEO 29/05/2026: phân loại SP theo has_bom (1 query) để quyết định trừ NVL
  // hay trừ tồn chính nó.
  const productIds = [...new Set(items.map((i) => i.productId))];
  const hasBomMap = new Map<string, boolean>();
  if (productIds.length > 0) {
    const { data: prodRows, error: prodErr } = await supabase
      .from("products")
      .select("id, has_bom")
      .in("id", productIds);
    if (prodErr) handleError(prodErr, "applyStockDecrement:has_bom");
    for (const p of prodRows ?? []) {
      hasBomMap.set(p.id as string, Boolean((p as { has_bom?: boolean }).has_bom));
    }
  }

  // Convention: `quantity` is ALWAYS positive (magnitude). `type` carries the
  // direction — 'in' adds, 'out' subtracts.
  //
  // Stock CAN go negative — represents "owe to warehouse" / oversold state.
  // Frontend warns the cashier; backend records the truth so the ledger
  // (stock_movements) and both snapshot tables stay in sync.
  for (const item of items) {
    // ─── SKU có BOM → chỉ trừ NVL theo công thức, KHÔNG trừ tồn SKU ───
    if (hasBomMap.get(item.productId)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: bomErr } = await (supabase.rpc as any)("consume_bom_for_sale", {
        p_tenant_id: ctx.tenantId,
        p_branch_id: ctx.branchId,
        p_sku_id: item.productId,
        p_qty: item.quantity,
        p_invoice_id: invoiceId,
        p_created_by: ctx.createdBy,
        p_invoice_code: ctx.invoiceCode,
      });
      if (bomErr) handleError(bomErr, "applyStockDecrement:consume_bom");
      continue;
    }

    // ─── SP thường → ghi stock_movement 'out' + trừ tồn chính nó ───
    const { error: mvErr } = await supabase.from("stock_movements").insert({
      tenant_id: ctx.tenantId,
      branch_id: ctx.branchId,
      product_id: item.productId,
      type: "out" as const,
      quantity: item.quantity,
      reference_type: "invoice",
      reference_id: invoiceId,
      note: `POS bán hàng - ${ctx.invoiceCode}`,
      created_by: ctx.createdBy,
    } satisfies StockMovementInsert);
    if (mvErr) handleError(mvErr, "applyStockDecrement:movements");

    const delta = -item.quantity; // POS sale always decrements

    // products.stock — atomic SQL increment
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updErr } = await (supabase.rpc as any)("increment_product_stock", {
      p_product_id: item.productId,
      p_delta: delta,
    });
    if (updErr) handleError(updErr, "applyStockDecrement:product_update");

    // branch_stock — atomic upsert
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: bsErr } = await (supabase.rpc as any)("upsert_branch_stock", {
      p_tenant_id: ctx.tenantId,
      p_branch_id: ctx.branchId,
      p_product_id: item.productId,
      p_delta: delta,
    });
    if (bsErr) handleError(bsErr, "applyStockDecrement:branch_stock");

    // FIFO lot allocation — consume from earliest-expiry lots first.
    // Best-effort: if no lots exist for this product (non-lot-tracked item),
    // the RPC returns shortage = full qty and we continue silently.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.rpc as any)("allocate_lots_fifo", {
        p_tenant_id: ctx.tenantId,
        p_product_id: item.productId,
        p_branch_id: ctx.branchId,
        p_quantity: item.quantity,
        p_source_type: "invoice",
        p_source_id: invoiceId,
      });
    } catch {
      // Silent — product may not have lots
    }
  }
}

// ============================================================
// Private: auto-create cash_transaction (phiếu thu)
// ============================================================

/**
 * Create "phiếu thu" (income cash transaction) tied to the invoice.
 * Called whenever a sale actually receives money (paid > 0).
 *
 * Keeps sổ quỹ automatically in sync with doanh thu POS.
 *
 * **Thanh toán hỗn hợp:** Khi paymentMethod="mixed" VÀ có paymentBreakdown,
 * tạo N phiếu thu riêng biệt — mỗi phiếu ghi đúng phương thức và số tiền.
 * Nếu không có breakdown (legacy), fallback về 1 phiếu "cash" như cũ.
 */
export async function createAutoCashReceipt(
  supabase: SupabaseClient<Database>,
  invoiceId: string,
  invoiceCode: string,
  amount: number,
  paymentMethod: "cash" | "transfer" | "card" | "mixed",
  ctx: {
    tenantId: string;
    branchId: string;
    createdBy: string;
    customerName: string;
    shiftId?: string | null;
  },
  paymentBreakdown?: PaymentBreakdownItem[]
): Promise<void> {
  if (amount <= 0) return; // Nợ 100% — chưa thu tiền

  const shiftId = ctx.shiftId ?? null;

  // Mixed + có breakdown → tạo N phiếu thu riêng
  if (paymentMethod === "mixed" && paymentBreakdown && paymentBreakdown.length > 0) {
    const validItems = paymentBreakdown.filter((b) => b.amount > 0);
    if (validItems.length === 0) return;

    const METHOD_LABELS: Record<string, string> = {
      cash: "tiền mặt",
      transfer: "chuyển khoản",
      card: "thẻ",
    };

    for (const item of validItems) {
      const { data: code, error: codeErr } = await supabase.rpc("next_code", {
        p_tenant_id: ctx.tenantId,
        p_entity_type: "cash_receipt",
      });
      if (codeErr) handleError(codeErr, "createAutoCashReceipt:next_code:mixed");
      const cashCode = code ?? `PT${Date.now()}`;

      const cashData: CashTransactionInsert = {
        tenant_id: ctx.tenantId,
        branch_id: ctx.branchId,
        code: cashCode,
        type: "receipt",
        category: "Bán hàng",
        amount: item.amount,
        counterparty: ctx.customerName,
        payment_method: item.method,
        reference_type: "invoice",
        reference_id: invoiceId,
        note: `Thu tiền hoá đơn ${invoiceCode} (${METHOD_LABELS[item.method] ?? item.method})`,
        created_by: ctx.createdBy,
        shift_id: shiftId,
      };

      const { error: cashErr } = await supabase
        .from("cash_transactions")
        .insert(cashData);
      if (cashErr) handleError(cashErr, "createAutoCashReceipt:insert:mixed");
    }
    return;
  }

  // Single method (cash / transfer / card) hoặc mixed legacy fallback
  const { data: code, error: codeErr } = await supabase.rpc("next_code", {
    p_tenant_id: ctx.tenantId,
    p_entity_type: "cash_receipt",
  });
  if (codeErr) handleError(codeErr, "createAutoCashReceipt:next_code");
  const cashCode = code ?? `PT${Date.now()}`;

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
    shift_id: shiftId,
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

  // Server-side transaction only. POS checkout must fail closed if the RPC is
  // missing; falling back to the legacy multi-step client flow can create drift.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: atomicData, error: atomicError } = await (supabase.rpc as any)(
    "pos_complete_checkout_atomic",
    {
      p_tenant_id: input.tenantId,
      p_branch_id: input.branchId,
      p_created_by: input.createdBy,
      p_customer_id: input.customerId ?? null,
      p_customer_name: input.customerName || "Khách lẻ",
      p_items: input.items,
      p_payment_method: input.paymentMethod,
      p_payment_breakdown: input.paymentBreakdown ?? null,
      p_subtotal: input.subtotal,
      p_discount_amount: input.discountAmount,
      p_total: input.total,
      p_paid: input.paid,
      p_note: input.note ?? null,
      p_source: input.source ?? "pos",
      p_shift_id: input.shiftId ?? null,
      p_promotion_id: input.promotionId ?? null,
      p_promotion_discount: input.promotionDiscount ?? 0,
      p_promotion_free_value: input.promotionFreeValue ?? 0,
      p_client_session_id: input.clientSessionId ?? null,
    },
  );

  if (!atomicError && atomicData) {
    const result = atomicData as {
      invoice_id?: string;
      invoice_code?: string;
      bom_consume_results?: BomConsumeResult[];
    };
    if (result.invoice_id && result.invoice_code) {
      return {
        invoiceId: result.invoice_id,
        invoiceCode: result.invoice_code,
        bomConsumeResults: result.bom_consume_results,
      };
    }
    throw new Error("Phản hồi thanh toán thiếu thông tin hoá đơn.");
  }

  if (atomicError) {
    if (isRpcUnavailable(atomicError)) {
      throw new Error("Chưa có RPC pos_complete_checkout_atomic. Vui lòng chạy migration POS/FnB atomic trước khi thanh toán.");
    }
    handleError(atomicError, "posCheckout:atomic_rpc");
  }

  throw new Error("Server không trả kết quả thanh toán POS hợp lệ.");
}

// ============================================================
// Day 3 16/05/2026: record_discount_audit — ghi audit log discount manual
//
// Gọi sau khi posCheckout trả invoice_id và discount_amount > 0 (manual giảm
// giá đã qua OTP duyệt). RPC ghi audit_log.action='discount_applied' kèm:
//   - invoice_code, invoice_total, discount_amount, discount_percent
//   - reason (lý do từ OTP), otp_id (link manager_otps), applied_at
//
// Best-effort: nếu RPC fail thì log warn, không throw — không block checkout.
// ============================================================

export interface RecordDiscountAuditInput {
  invoiceId: string;
  invoiceCode: string;
  invoiceTotal: number;
  discountAmount: number;
  /** % giảm (vd 10 cho 10%). 0 nếu là discount kiểu số tiền cố định. */
  discountPercent?: number;
  reason: string;
  otpId?: string | null;
}

// Day 17/05/2026 P2.B: persistent retry queue trong localStorage.
// Nếu RPC fail (mạng, RPC unavailable, server down) → lưu vào queue → retry
// tự động khi mount app + mỗi 60s. Không miss audit nữa.
const AUDIT_QUEUE_KEY = "onebiz-discount-audit-queue-v1";

interface QueuedAudit extends RecordDiscountAuditInput {
  queuedAt: string;
  attempts: number;
}

function loadQueue(): QueuedAudit[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(AUDIT_QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedAudit[]) : [];
  } catch {
    return [];
  }
}

function saveQueue(queue: QueuedAudit[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(AUDIT_QUEUE_KEY, JSON.stringify(queue));
  } catch {
    /* quota exceeded — skip */
  }
}

function enqueueFailedAudit(input: RecordDiscountAuditInput): void {
  const queue = loadQueue();
  queue.push({ ...input, queuedAt: new Date().toISOString(), attempts: 1 });
  saveQueue(queue);
}

async function postAuditOnce(input: RecordDiscountAuditInput): Promise<boolean> {
  const supabase = getClient();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.rpc as any)("record_discount_audit", {
      p_invoice_id: input.invoiceId,
      p_invoice_code: input.invoiceCode,
      p_invoice_total: input.invoiceTotal,
      p_discount_amount: input.discountAmount,
      p_discount_percent: input.discountPercent ?? 0,
      p_reason: input.reason,
      p_otp_id: input.otpId ?? null,
    });
    if (error) {
      if (isRpcUnavailable(error)) {
        console.warn("[recordDiscountAudit] RPC chưa có — queue lại.");
      } else {
        console.warn("[recordDiscountAudit] RPC lỗi:", error.message);
      }
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[recordDiscountAudit] exception:", err);
    return false;
  }
}

export async function recordDiscountAudit(
  input: RecordDiscountAuditInput,
): Promise<void> {
  if (input.discountAmount <= 0) return;
  const ok = await postAuditOnce(input);
  if (!ok) {
    enqueueFailedAudit(input);
  }
}

/**
 * Retry queue audit còn pending. Gọi khi app mount + sau khi mạng online lại.
 * Tự skip item có attempts > 20 (coi như mất hẳn — admin xử lý thủ công).
 */
export async function retryFailedDiscountAudits(): Promise<{
  succeeded: number;
  remaining: number;
}> {
  const queue = loadQueue();
  if (queue.length === 0) return { succeeded: 0, remaining: 0 };
  const remaining: QueuedAudit[] = [];
  let succeeded = 0;
  for (const item of queue) {
    if (item.attempts >= 20) {
      // Drop sau 20 lần fail
      console.warn(
        `[recordDiscountAudit] drop sau 20 lần fail cho ${item.invoiceCode}`,
      );
      continue;
    }
    const ok = await postAuditOnce(item);
    if (ok) {
      succeeded += 1;
    } else {
      remaining.push({ ...item, attempts: item.attempts + 1 });
    }
  }
  saveQueue(remaining);
  return { succeeded, remaining: remaining.length };
}

export function getFailedDiscountAuditCount(): number {
  return loadQueue().length;
}
