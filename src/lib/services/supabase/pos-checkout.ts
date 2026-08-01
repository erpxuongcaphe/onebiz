/**
 * POS Checkout Service
 *
 * Atomically creates invoice + invoice_items + stock_movements + cash_transaction
 * for a completed POS sale.
 *
 * All invoice, stock and cash effects run inside hardened database RPCs.
 */

import { getClient, handleError } from "./base";
import { isRpcUnavailable } from "./rpc-utils";


// ============================================================
// Types
// ============================================================

export interface PosCheckoutItem {
  productId: string;
  productName: string;
  variantId?: string | null;
  unit?: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  vatRate?: number; // Thuế suất GTGT (%) — 0, 5, 8, 10
  /** CEO 19/07: ghi chú từng món — RPC 00208 ghi vào invoice_items.note. */
  note?: string;
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
  /** Chiết khấu cấp đơn, không gồm chiết khấu từng dòng. */
  orderDiscountAmount?: number;
  discountSource?:
    | "manual"
    | "customer_group"
    | "promotion"
    | "coupon"
    | "redeem"
    | "promotion_redeem"
    | null;
  couponCode?: string | null;
  loyaltyPoints?: number;
  discountOtpId?: string | null;
  discountReason?: string | null;
  shippingFee?: number;
  orderVatRate?: number;
  amountTendered?: number | null;
  /** Tiền thừa khách chọn giữ lại làm số dư, ghi atomically cùng hóa đơn. */
  customerCredit?: number;
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
  /** Explicit cashier confirmation for BOM shortage only. */
  allowBomShortage?: boolean;
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
  total?: number;
  paid?: number;
  debt?: number;
  taxAmount?: number;
  discountAmount?: number;
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
    "pos_complete_checkout_atomic_v3",
    {
      p_branch_id: input.branchId,
      p_customer_id: input.customerId ?? null,
      p_items: input.items,
      p_payment_method: input.paymentMethod,
      p_payment_breakdown: input.paymentBreakdown ?? null,
      p_paid: input.paid,
      p_note: input.note ?? null,
      p_source: input.source ?? "pos",
      p_shift_id: input.shiftId ?? null,
      p_promotion_id: input.promotionId ?? null,
      p_coupon_code: input.couponCode ?? null,
      p_loyalty_points: input.loyaltyPoints ?? 0,
      p_discount_source: input.discountSource ?? null,
      p_order_discount: input.orderDiscountAmount ?? 0,
      p_discount_otp_id: input.discountOtpId ?? null,
      p_discount_reason: input.discountReason ?? null,
      p_shipping_fee: input.shippingFee ?? 0,
      p_order_vat_rate: input.orderVatRate ?? 0,
      p_client_session_id: input.clientSessionId ?? null,
      p_allow_bom_shortage: input.allowBomShortage ?? false,
      p_amount_tendered: input.amountTendered ?? input.paid,
      p_customer_credit: input.customerCredit ?? 0,
    },
  );

  if (!atomicError && atomicData) {
    const result = atomicData as {
      invoice_id?: string;
      invoice_code?: string;
      bom_consume_results?: BomConsumeResult[];
      total?: number;
      paid?: number;
      debt?: number;
      tax_amount?: number;
      discount_amount?: number;
      customer_credit?: number;
    };
    if (result.invoice_id && result.invoice_code) {
      return {
        invoiceId: result.invoice_id,
        invoiceCode: result.invoice_code,
        bomConsumeResults: result.bom_consume_results,
        total: result.total,
        paid: result.paid,
        debt: result.debt,
        taxAmount: result.tax_amount,
        discountAmount: result.discount_amount,
      };
    }
    throw new Error("Phản hồi thanh toán thiếu thông tin hoá đơn.");
  }

  if (atomicError) {
    if (
      atomicError.message === "POS_PRICE_CHANGED" ||
      atomicError.message === "POS_DISCOUNT_CHANGED"
    ) {
      throw new Error(
        `${atomicError.message}|${atomicError.details ?? "{}"}`,
      );
    }
    if (isRpcUnavailable(atomicError)) {
      throw new Error("Chưa có migration 00253. Không thể thanh toán an toàn.");
    }
    handleError(atomicError, "posCheckout:atomic_v3_rpc");
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
