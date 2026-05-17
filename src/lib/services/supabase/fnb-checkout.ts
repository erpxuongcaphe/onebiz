/**
 * F&B Checkout Service — 2-step flow (chuẩn KiotViet/Sapo)
 *
 * Bước 1: sendToKitchen()  — tạo kitchen_order + items, claim table, in ticket
 * Bước 2: fnbPayment()     — gọi RPC `fnb_complete_payment_atomic` bọc toàn bộ
 *                             invoice + items + stock + cash + link + release table
 *                             trong 1 transaction Postgres (all-or-nothing).
 *
 * Bổ sung: addItemsToExistingOrder() — gửi bếp bổ sung
 */

import { getClient, handleError } from "./base";
import { isRpcUnavailable } from "./rpc-utils";
import {
  addItemsToOrder,
  setDeliveryPlatform,
} from "./kitchen-orders";
import type { PaymentBreakdownItem } from "./pos-checkout";
import type { ToppingAttachment, DeliveryPlatform } from "@/lib/types/fnb";

// ============================================================
// Types
// ============================================================

export interface SendToKitchenInput {
  tenantId: string;
  branchId: string;
  createdBy: string;
  tableId?: string;
  orderType: "dine_in" | "takeaway" | "delivery";
  note?: string;
  /** Delivery platform (Shopee Food, Grab, etc.) */
  deliveryPlatform?: DeliveryPlatform;
  deliveryFee?: number;
  /**
   * @deprecated Migration 00070 — dùng `platformCommissionPercent`.
   */
  platformCommission?: number;
  /**
   * Migration 00070: % phí sàn (vd 25 = 25%). Persist xuống
   * `kitchen_orders.platform_commission_percent` ngay sau khi tạo
   * đơn để RPC fnb_complete_payment_atomic đọc khi thanh toán.
   */
  platformCommissionPercent?: number;
  /**
   * Idempotency key — Sprint FIX-1 (CEO 07/05). Pass localId từ offline queue
   * để server dedup khi retry → không tạo đơn trùng.
   */
  idempotencyKey?: string;
  items: {
    productId: string;
    productName: string;
    variantId?: string;
    variantLabel?: string;
    quantity: number;
    unitPrice: number;
    note?: string;
    toppings?: ToppingAttachment[];
  }[];
}

export interface SendToKitchenResult {
  kitchenOrderId: string;
  orderNumber: string;
}

export interface FnbPaymentInput {
  kitchenOrderId: string;
  tenantId: string;
  branchId: string;
  createdBy: string;
  customerId?: string | null;
  customerName: string;
  paymentMethod: "cash" | "transfer" | "card" | "mixed";
  paymentBreakdown?: PaymentBreakdownItem[];
  paid: number;
  discountAmount?: number;
  note?: string;
  /** ID ca đang mở — nếu có, gắn vào invoice + cash_transaction để báo cáo ca đúng. */
  shiftId?: string | null;
  /** Tiền tip khách cho nhân viên. Cộng vào total + lưu invoices.tip_amount. */
  tipAmount?: number;
}

export interface FnbPaymentResult {
  invoiceId: string;
  invoiceCode: string;
}

// ============================================================
// Bước 1: GỬI BẾP
// ============================================================

/**
 * Tạo kitchen_order + items. Nếu dine_in, claim table.
 * KHÔNG tạo invoice, KHÔNG trừ kho, KHÔNG thu tiền.
 */
export async function sendToKitchen(input: SendToKitchenInput): Promise<SendToKitchenResult> {
  const supabase = getClient();

  // 1. Generate order number via RPC
  const { data: code, error: codeErr } = await supabase.rpc("next_code", {
    p_tenant_id: input.tenantId,
    p_entity_type: "kitchen_order",
  });
  if (codeErr) handleError(codeErr, "sendToKitchen:next_code");
  const orderNumber = code ?? `KB${Date.now()}`;

  // Server-side transaction only. Sending to kitchen must fail closed if this
  // RPC is missing; the old client flow can leave table/order state divergent.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: atomicData, error: atomicError } = await (supabase.rpc as any)(
    "fnb_send_to_kitchen_atomic",
    {
      p_tenant_id: input.tenantId,
      p_branch_id: input.branchId,
      p_created_by: input.createdBy,
      p_table_id: input.tableId ?? null,
      p_order_type: input.orderType,
      p_note: input.note ?? null,
      p_idempotency_key: input.idempotencyKey ?? null,
      p_order_number: orderNumber,
      p_items: input.items,
    },
  );

  if (!atomicError && atomicData) {
    const result = atomicData as {
      kitchen_order_id?: string;
      order_number?: string;
    };
    if (result.kitchen_order_id && result.order_number) {
      // Migration 00070 (CEO 13/05): RPC fnb_send_to_kitchen_atomic không
      // nhận platform/fee/commission → cần update riêng sau khi tạo đơn.
      // Nếu là đơn delivery với platform != "direct", persist xuống DB
      // để RPC thanh toán đọc khi tính commission_amount.
      const platform = input.deliveryPlatform;
      const percent = input.platformCommissionPercent ?? input.platformCommission ?? 0;
      const fee = input.deliveryFee ?? 0;
      if (
        input.orderType === "delivery" &&
        platform &&
        platform !== "direct" &&
        (percent > 0 || fee > 0)
      ) {
        try {
          await setDeliveryPlatform(result.kitchen_order_id, platform, fee, percent);
        } catch (err) {
          // Không rollback đơn — đơn đã gửi bếp thành công. Log để debug.
          // User có thể chỉnh platform sau qua cart (handler page.tsx).
          console.error("sendToKitchen:setDeliveryPlatform persist failed", err);
        }
      }
      return {
        kitchenOrderId: result.kitchen_order_id,
        orderNumber: result.order_number,
      };
    }
    throw new Error("Phản hồi gửi bếp thiếu thông tin đơn.");
  }

  if (atomicError) {
    if (isRpcUnavailable(atomicError)) {
      throw new Error("Chưa có RPC fnb_send_to_kitchen_atomic. Vui lòng chạy migration POS/FnB atomic trước khi gửi bếp.");
    }
    handleError(atomicError, "sendToKitchen:atomic_rpc");
  }

  throw new Error("Server không trả kết quả gửi bếp hợp lệ.");
}

// ============================================================
// Bước 2: THANH TOÁN
// ============================================================

/**
 * Atomic F&B payment: gọi RPC `fnb_complete_payment_atomic` bọc TOÀN BỘ
 * (invoice + invoice_items + stock_movements + cash + link kitchen_order
 * + release table) trong 1 transaction Postgres.
 *
 * Nếu bất kỳ bước nào fail (mạng drop, DB lỗi, constraint vi phạm) → rollback
 * toàn bộ. Đây là fix CRITICAL cho lỗ hổng mất dữ liệu khi mạng gián đoạn
 * giữa 4 round-trips của flow cũ.
 */
export async function fnbPayment(input: FnbPaymentInput): Promise<FnbPaymentResult> {
  const supabase = getClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("fnb_complete_payment_atomic", {
    p_kitchen_order_id: input.kitchenOrderId,
    p_customer_id: input.customerId ?? null,
    p_customer_name: input.customerName || "Khách lẻ",
    p_payment_method: input.paymentMethod,
    p_payment_breakdown: input.paymentBreakdown ?? null,
    p_paid: input.paid,
    p_discount_amount: input.discountAmount ?? 0,
    p_note: input.note ?? null,
    p_created_by: input.createdBy,
    p_shift_id: input.shiftId ?? null,
    p_tip_amount: input.tipAmount ?? 0,
  });

  if (error) handleError(error, "fnbPayment:atomic_rpc");
  if (!data) throw new Error("Không nhận được phản hồi từ server khi thanh toán.");

  // RPC returns jsonb { invoice_id, invoice_code, total, paid, debt }
  const result = data as { invoice_id: string; invoice_code: string };
  if (!result.invoice_id || !result.invoice_code) {
    throw new Error("Phản hồi thanh toán thiếu thông tin hoá đơn.");
  }

  return {
    invoiceId: result.invoice_id,
    invoiceCode: result.invoice_code,
  };
}

// ============================================================
// Bổ sung món
// ============================================================

/**
 * Add more items to an existing kitchen order.
 * Wraps addItemsToOrder from kitchen-orders service.
 */
export async function addItemsToExistingOrder(
  kitchenOrderId: string,
  items: SendToKitchenInput["items"]
): Promise<void> {
  await addItemsToOrder(kitchenOrderId, items);
}

// ============================================================
// Hoàn trả / Void (after payment)
// ============================================================

/**
 * Void a completed F&B invoice.
 * - Marks invoice as cancelled + stores void reason
 * - Reverses stock_movements (creates 'in' movements)
 * - Creates reverse cash_transaction (phiếu chi hoàn tiền)
 * - Re-opens kitchen order (status → cancelled)
 */
export async function voidFnbInvoice(input: {
  invoiceId: string;
  kitchenOrderId: string;
  voidReason: string;
  voidedBy: string;
  tenantId: string;
  branchId: string;
  /** Nếu hoá đơn void trong 1 ca đang mở → gắn phiếu chi hoàn tiền vào ca đó */
  shiftId?: string | null;
  /** Day 17/05/2026: OTP duyệt — server verify trong RPC fnb_void_invoice_atomic.
   *  Null = cashier có quyền pos_fnb.void_paid_bill / pos_fnb.void. */
  otpId?: string | null;
}): Promise<void> {
  const supabase = getClient();

  // Prefer transactional void when migration 00055 is available.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: atomicData, error: atomicError } = await (supabase.rpc as any)(
    "fnb_void_invoice_atomic",
    {
      p_invoice_id: input.invoiceId,
      p_kitchen_order_id: input.kitchenOrderId,
      p_void_reason: input.voidReason,
      p_voided_by: input.voidedBy,
      p_tenant_id: input.tenantId,
      p_branch_id: input.branchId,
      p_shift_id: input.shiftId ?? null,
      p_otp_id: input.otpId ?? null,
    },
  );

  if (!atomicError && (atomicData as { success?: boolean } | null)?.success) {
    return;
  }
  if (atomicError) {
    if (isRpcUnavailable(atomicError)) {
      throw new Error("Chưa có RPC fnb_void_invoice_atomic. Vui lòng chạy migration POS/FnB atomic trước khi huỷ hoá đơn.");
    }
    handleError(atomicError, "voidFnbInvoice:atomic_rpc");
  }

  throw new Error("Server không trả kết quả huỷ hoá đơn hợp lệ.");
}
