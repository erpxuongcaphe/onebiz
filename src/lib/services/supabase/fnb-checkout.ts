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
import { addItemsToOrder } from "./kitchen-orders";
import type { PaymentBreakdownItem } from "./pos-checkout";
import type {
  ToppingAttachment,
  DeliveryPlatform,
  ModifierSelectionPayload,
} from "@/lib/types/fnb";

/**
 * Cấp ngưỡng km áp dụng phí giao hàng (CEO 21/05/2026).
 * - near/mid/far: theo cấu hình `fnb_delivery_fee_tiers`
 * - custom: cashier nhập tay (legacy)
 */
export type DeliveryDistanceTier = "near" | "mid" | "far" | "custom";

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
  /**
   * Day 21/05/2026 (CEO): nhân viên QUÁN đi giao đơn delivery (khác cashier).
   * Optional — có thể gán sau qua `assignDeliveryStaff` ở danh sách đơn.
   */
  deliveryStaffId?: string | null;
  /**
   * Day 21/05/2026 (CEO): cấp ngưỡng km áp dụng cho phí giao.
   * Khi chọn near/mid/far → fee được lấy từ bảng `fnb_delivery_fee_tiers`.
   * Khi 'custom' → cashier tự nhập tay (legacy).
   */
  deliveryDistanceTier?: DeliveryDistanceTier | null;
  items: {
    productId: string;
    productName: string;
    variantId?: string;
    variantLabel?: string;
    quantity: number;
    unitPrice: number;
    note?: string;
    toppings?: ToppingAttachment[];
    /**
     * CEO 01/06/2026 — Sprint 2.3a: snapshot dynamic modifier choices.
     * RPC fnb_send_to_kitchen_atomic v2 (Sprint 2.3b migration 00122) sẽ
     * scale BOM ingredient theo scaleFactor + trừ tồn topping NVL theo
     * linkedProductId. v1 RPC ignore field này → backward compat OK.
     */
    modifierSelections?: ModifierSelectionPayload[];
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
  /** Thu ngân chủ động cho phép phần còn lại trở thành công nợ. */
  allowDebt?: boolean;
  paid: number;
  note?: string;
  /** ID ca đang mở — nếu có, gắn vào invoice + cash_transaction để báo cáo ca đúng. */
  shiftId?: string | null;
  /** Tiền tip khách cho nhân viên. Cộng vào total + lưu invoices.tip_amount. */
  tipAmount?: number;
  /** Giảm tay sau khi quản lý đã duyệt OTP. */
  manualDiscountAmount?: number;
  /** OTP đã được quản lý duyệt cho giảm giá thủ công; server xác minh lại. */
  manualDiscountOtpId?: string | null;
  /** Lý do đã xác nhận cùng OTP; bắt buộc khi có giảm giá thủ công. */
  manualDiscountReason?: string | null;
  /**
   * @deprecated Dành cho nháp/offline queue được tạo trước migration 00343.
   * Mã mới phải truyền manualDiscountAmount; khuyến mãi và coupon không được
   * đưa vào trường này.
   */
  discountAmount?: number;
  /** Chỉ là định danh; máy chủ tự tính điều kiện và số tiền. */
  promotionId?: string | null;
  /** Chỉ là định danh; máy chủ tự tính điều kiện và số tiền. */
  couponCode?: string | null;
}

export interface FnbPaymentResult {
  invoiceId: string;
  invoiceCode: string;
  /** Số tiền thực tế đã được server lưu trên hoá đơn. Undefined khi offline. */
  total?: number;
  paid?: number;
  debt?: number;
  /** Tiền khách thực đưa; khác `paid` khi thu tiền mặt có tiền thối. */
  tenderedAmount?: number;
  /** Tiền thối do máy chủ tính từ tổng đã chốt. */
  changeAmount?: number;
  discountAmount?: number;
  platformCommissionAmount?: number;
  /** Day 18/05/2026 (CEO): BOM consume break-down — dùng cho toast tiêu hao NVL */
  bomConsumeResults?: import("./pos-checkout").BomConsumeResult[];
}

const FNB_PAYMENT_ERROR_MESSAGES: ReadonlyArray<{
  codes: readonly string[];
  message: string;
}> = [
  {
    codes: ["AUTH_REQUIRED", "ACTIVE_PROFILE_REQUIRED", "FNB_PAYMENT_DENIED", "BRANCH_ACCESS_DENIED"],
    message: "Anh/chị không có quyền thanh toán đơn này.",
  },
  {
    codes: ["FNB_MANUAL_DISCOUNT_INVALID", "FNB_MANUAL_DISCOUNT_EXCEEDS_ORDER"],
    message: "Giảm giá thủ công không hợp lệ.",
  },
  {
    codes: ["FNB_MANUAL_DISCOUNT_OTP_REQUIRED", "FNB_MANUAL_DISCOUNT_APPROVER_DENIED", "OTP_"],
    message: "Giảm giá thủ công cần OTP hợp lệ của người có quyền duyệt.",
  },
  {
    codes: ["FNB_MANUAL_DISCOUNT_REASON_REQUIRED"],
    message: "Vui lòng nhập lý do giảm giá thủ công.",
  },
  {
    codes: ["FNB_PROMOTION_NOT_FOUND", "FNB_PROMOTION_NOT_AVAILABLE", "FNB_PROMOTION_TIME_CONFIG_INVALID", "FNB_PROMOTION_TIME_NOT_AVAILABLE", "FNB_PROMOTION_DAY_NOT_AVAILABLE", "FNB_PROMOTION_NOT_APPLICABLE", "FNB_PROMOTION_VALUE_INVALID", "FNB_PROMOTION_TYPE_NOT_SUPPORTED"],
    message: "Khuyến mãi không còn áp dụng cho đơn này. Vui lòng kiểm tra lại.",
  },
  {
    codes: ["FNB_COUPON_NOT_FOUND", "FNB_COUPON_NOT_AVAILABLE", "FNB_COUPON_PER_CUSTOMER_EXCEEDED", "FNB_COUPON_NOT_APPLICABLE", "FNB_COUPON_VALUE_INVALID", "FNB_COUPON_TYPE_INVALID"],
    message: "Mã giảm giá không còn áp dụng cho đơn này. Vui lòng kiểm tra lại.",
  },
  {
    codes: ["FNB_ORDER_TOTAL_INVALID", "FNB_TOTAL_DISCOUNT_EXCEEDS_ORDER"],
    message: "Tổng giảm giá không hợp lệ. Vui lòng kiểm tra lại đơn hàng.",
  },
  {
    codes: ["FNB_PAYMENT_AMOUNT_CHANGED"],
    message: "Tổng tiền đã thay đổi. Vui lòng kiểm tra lại ưu đãi trước khi thanh toán.",
  },
  {
    codes: ["FNB_DEBT_CONFIRMATION_REQUIRED"],
    message: "Số tiền khách đưa chưa đủ. Chọn Ghi nợ hoặc thu đủ tiền trước khi thanh toán.",
  },
  {
    codes: ["FNB_PAYMENT_AMOUNT_INVALID", "FNB_PAYMENT_METHOD_INVALID", "FNB_PAYMENT_BREAKDOWN_", "FNB_DEBT_METHOD_INVALID"],
    message: "Thông tin thanh toán không hợp lệ. Vui lòng kiểm tra lại.",
  },
  {
    codes: ["KITCHEN_ORDER_NOT_FOUND", "PAID_INVOICE_NOT_FOUND"],
    message: "Không tìm thấy đơn bếp. Vui lòng tải lại màn hình.",
  },
  {
    codes: ["CUSTOMER_NOT_FOUND", "SHIFT_NOT_OPEN_FOR_USER_BRANCH"],
    message: "Thông tin khách hàng hoặc ca làm việc không còn hợp lệ. Vui lòng tải lại.",
  },
];

export function getFnbPaymentErrorMessage(error: unknown): string | null {
  const rawMessage =
    typeof error === "string"
      ? error
      : error && typeof error === "object" && "message" in error
        ? String((error as { message?: unknown }).message ?? "")
        : "";

  return (
    FNB_PAYMENT_ERROR_MESSAGES.find((item) =>
      item.codes.some((code) => rawMessage.includes(code)),
    )?.message ?? null
  );
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

  // The server derives actor/tenant and rebuilds catalog snapshots. Delivery
  // metadata is included in the same transaction so a network interruption
  // cannot leave a partially configured kitchen order.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: atomicData, error: atomicError } = await (supabase.rpc as any)(
    "fnb_send_to_kitchen_atomic_v2",
    {
      p_branch_id: input.branchId,
      p_table_id: input.tableId ?? null,
      p_order_type: input.orderType,
      p_note: input.note ?? null,
      p_idempotency_key: input.idempotencyKey ?? null,
      p_items: input.items,
      p_delivery_platform: input.deliveryPlatform ?? null,
      p_delivery_fee: input.deliveryFee ?? 0,
      p_platform_commission_percent:
        input.platformCommissionPercent ?? input.platformCommission ?? null,
      p_delivery_staff_id: input.deliveryStaffId ?? null,
      p_delivery_distance_tier: input.deliveryDistanceTier ?? null,
    },
  );

  if (!atomicError && atomicData) {
    const result = atomicData as {
      kitchen_order_id?: string;
      order_number?: string;
    };
    if (result.kitchen_order_id && result.order_number) {
      return {
        kitchenOrderId: result.kitchen_order_id,
        orderNumber: result.order_number,
      };
    }
    throw new Error("Phản hồi gửi bếp thiếu thông tin đơn.");
  }

  if (atomicError) {
    if (isRpcUnavailable(atomicError)) {
      throw new Error(
        "Chưa có RPC fnb_send_to_kitchen_atomic_v2. Vui lòng chạy migration POS/FnB atomic trước khi gửi bếp.",
      );
    }
    handleError(atomicError, "sendToKitchen:atomic_rpc");
  }

  throw new Error("Server không trả kết quả gửi bếp hợp lệ.");
}

// ============================================================
// Bước 2: THANH TOÁN
// ============================================================

/**
 * Atomic F&B payment: gọi RPC `fnb_complete_payment_atomic_v3` bọc TOÀN BỘ
 * (invoice + invoice_items + stock_movements + cash + link kitchen_order
 * + release table) trong 1 transaction Postgres.
 *
 * Nếu bất kỳ bước nào fail (mạng drop, DB lỗi, constraint vi phạm) → rollback
 * toàn bộ. Đây là fix CRITICAL cho lỗ hổng mất dữ liệu khi mạng gián đoạn
 * giữa 4 round-trips của flow cũ.
 */
export async function fnbPayment(input: FnbPaymentInput): Promise<FnbPaymentResult> {
  const supabase = getClient();

  // Older offline payloads only carried one combined client-side discount.
  // It is unsafe to guess whether that amount was a manual discount, coupon,
  // or promotion. The cashier must reopen the order so V3 can calculate it.
  if (input.manualDiscountAmount === undefined && (input.discountAmount ?? 0) > 0) {
    throw new Error(
      "Đơn offline cũ có giảm giá. Vui lòng mở lại đơn khi có mạng để hệ thống tính lại ưu đãi.",
    );
  }
  if ((input.manualDiscountAmount ?? 0) > 0 && !input.manualDiscountOtpId) {
    throw new Error("Giảm giá thủ công cần OTP hợp lệ của quản lý.");
  }

  const manualDiscountAmount = input.manualDiscountAmount ?? 0;
  // OTP/reason only belong to a manual reduction. Never forward a stale
  // approval from a tab after its manual discount was removed.
  const manualDiscountOtpId = manualDiscountAmount > 0 ? input.manualDiscountOtpId ?? null : null;
  const manualDiscountReason = manualDiscountAmount > 0 ? input.manualDiscountReason ?? null : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("fnb_complete_payment_atomic_v3", {
    p_kitchen_order_id: input.kitchenOrderId,
    p_customer_id: input.customerId ?? null,
    p_customer_name: input.customerName || "Khách lẻ",
    p_payment_method: input.paymentMethod,
    p_payment_breakdown: input.paymentBreakdown ?? null,
    p_paid: input.paid,
    p_allow_debt: input.allowDebt === true,
    p_manual_discount_amount: manualDiscountAmount,
    p_manual_discount_otp_id: manualDiscountOtpId,
    p_manual_discount_reason: manualDiscountReason,
    p_note: input.note ?? null,
    p_shift_id: input.shiftId ?? null,
    p_tip_amount: input.tipAmount ?? 0,
    p_promotion_id: input.promotionId ?? null,
    p_coupon_code: input.couponCode ?? null,
  });

  if (error) {
    if (isRpcUnavailable(error)) {
      throw new Error(
        "Chưa có migration 00343. Không thể thanh toán FnB an toàn.",
      );
    }
    const friendlyMessage = getFnbPaymentErrorMessage(error);
    if (friendlyMessage) throw new Error(friendlyMessage);
    handleError(error, "fnbPayment:atomic_v3_rpc");
  }
  if (!data) throw new Error("Không nhận được phản hồi từ server khi thanh toán.");

  // RPC returns jsonb { invoice_id, invoice_code, total, paid, debt, bom_consume_results }
  const result = data as {
    invoice_id: string;
    invoice_code: string;
    total?: number;
    paid?: number;
    debt?: number;
    tendered_amount?: number;
    change_amount?: number;
    discount_amount?: number;
    platform_commission_amount?: number;
    bom_consume_results?: import("./pos-checkout").BomConsumeResult[];
  };
  if (!result.invoice_id || !result.invoice_code) {
    throw new Error("Phản hồi thanh toán thiếu thông tin hoá đơn.");
  }

  return {
    invoiceId: result.invoice_id,
    invoiceCode: result.invoice_code,
    total: result.total,
    paid: result.paid,
    debt: result.debt,
    tenderedAmount: result.tendered_amount,
    changeAmount: result.change_amount,
    discountAmount: result.discount_amount,
    platformCommissionAmount: result.platform_commission_amount,
    bomConsumeResults: result.bom_consume_results,
  };
}

// ============================================================
// Bổ sung món
// ============================================================

/**
 * Add more items to an existing kitchen order.
 * Wraps addItemsToOrder from kitchen-orders service.
 *
 * P0-8 fix 12/06/2026: forward batchId (UUID) cho idempotency replay-safe.
 */
export async function addItemsToExistingOrder(
  kitchenOrderId: string,
  items: SendToKitchenInput["items"],
  options?: { batchId?: string },
): Promise<void> {
  await addItemsToOrder(kitchenOrderId, items, options);
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
