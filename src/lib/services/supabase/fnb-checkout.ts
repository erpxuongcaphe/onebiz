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
import {
  createKitchenOrder,
  getKitchenOrderById,
  addItemsToOrder,
  type CreateKitchenOrderInput,
} from "./kitchen-orders";
import { claimTable } from "./fnb-tables";
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
  platformCommission?: number;
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

  // 2. Create kitchen order + items
  const koInput: CreateKitchenOrderInput = {
    tenantId: input.tenantId,
    branchId: input.branchId,
    createdBy: input.createdBy,
    tableId: input.tableId,
    orderType: input.orderType,
    note: input.note,
    items: input.items,
  };

  const order = await createKitchenOrder(koInput, orderNumber);

  // 3. Claim table if dine_in
  if (input.orderType === "dine_in" && input.tableId) {
    await claimTable(input.tableId, order.id);
  }

  return {
    kitchenOrderId: order.id,
    orderNumber: order.orderNumber,
  };
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
}): Promise<void> {
  const supabase = getClient();

  // 1. Load invoice to verify it's completed
  const { data: invoice, error: invErr } = await supabase
    .from("invoices")
    .select("id, code, status, total, paid, source, shift_id")
    .eq("id", input.invoiceId)
    .single();

  if (invErr) handleError(invErr, "voidFnbInvoice:fetch");
  if (!invoice) throw new Error("Không tìm thấy hoá đơn");
  if (invoice.status === "cancelled") throw new Error("Hoá đơn đã huỷ trước đó.");

  // 2. Cancel the invoice
  const { error: cancelErr } = await supabase
    .from("invoices")
    .update({
      status: "cancelled" as const,
      void_reason: input.voidReason,
      voided_at: new Date().toISOString(),
      voided_by: input.voidedBy,
    })
    .eq("id", input.invoiceId);

  if (cancelErr) handleError(cancelErr, "voidFnbInvoice:cancel");

  // 3. Load invoice_items for stock reversal
  const { data: items, error: itemsErr } = await supabase
    .from("invoice_items")
    .select("product_id, product_name, quantity")
    .eq("invoice_id", input.invoiceId);

  if (itemsErr) handleError(itemsErr, "voidFnbInvoice:items");

  // 4. Reverse stock: create 'in' movements + increment stock
  if (items && items.length > 0) {
    const reverseMovements = items.map((item) => ({
      tenant_id: input.tenantId,
      branch_id: input.branchId,
      product_id: item.product_id,
      type: "in" as const,
      quantity: item.quantity,
      reference_type: "invoice_void" as const,
      reference_id: input.invoiceId,
      note: `Hoàn trả - huỷ HĐ ${invoice.code}: ${input.voidReason}`,
      created_by: input.voidedBy,
    }));

    const { error: mvErr } = await supabase
      .from("stock_movements")
      .insert(reverseMovements);
    if (mvErr) handleError(mvErr, "voidFnbInvoice:reverseStock");

    // Increment product stock + branch stock
    for (const item of items) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.rpc as any)("increment_product_stock", {
        p_product_id: item.product_id,
        p_delta: item.quantity, // positive = add back
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.rpc as any)("upsert_branch_stock", {
        p_tenant_id: input.tenantId,
        p_branch_id: input.branchId,
        p_product_id: item.product_id,
        p_delta: item.quantity,
      });
    }
  }

  // 5. Create reverse cash transaction (phiếu chi hoàn tiền)
  if (invoice.paid > 0) {
    const { data: code } = await supabase.rpc("next_code", {
      p_tenant_id: input.tenantId,
      p_entity_type: "cash_payment",
    });

    // Ưu tiên ca đang mở (input.shiftId), fallback về ca ban đầu của hoá đơn.
    const reverseShiftId = input.shiftId ?? invoice.shift_id ?? null;

    const { error: cashErr } = await supabase
      .from("cash_transactions")
      .insert({
        tenant_id: input.tenantId,
        branch_id: input.branchId,
        code: code ?? `PC${Date.now()}`,
        type: "payment" as const,
        category: "Hoàn trả",
        amount: invoice.paid,
        counterparty: "Khách hàng",
        payment_method: "cash" as const,
        reference_type: "invoice",
        reference_id: input.invoiceId,
        note: `Hoàn tiền HĐ ${invoice.code}: ${input.voidReason}`,
        created_by: input.voidedBy,
        shift_id: reverseShiftId,
      });
    if (cashErr) handleError(cashErr, "voidFnbInvoice:reverseCash");
  }

  // 6. Mark kitchen order as cancelled
  const { error: koErr } = await supabase
    .from("kitchen_orders")
    .update({ status: "cancelled" as const })
    .eq("id", input.kitchenOrderId);
  if (koErr) handleError(koErr, "voidFnbInvoice:cancelOrder");
}
