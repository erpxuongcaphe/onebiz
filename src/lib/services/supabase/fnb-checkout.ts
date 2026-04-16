/**
 * F&B Checkout Service — 2-step flow (chuẩn KiotViet/Sapo)
 *
 * Bước 1: sendToKitchen()  — tạo kitchen_order + items, claim table, in ticket
 * Bước 2: fnbPayment()     — flatten items → posCheckout(source='fnb') → invoice + stock + cash
 *
 * Bổ sung: addItemsToExistingOrder() — gửi bếp bổ sung
 */

import { getClient, handleError } from "./base";
import {
  createKitchenOrder,
  getKitchenOrderById,
  addItemsToOrder,
  linkInvoiceToOrder,
  type CreateKitchenOrderInput,
} from "./kitchen-orders";
import { claimTable, releaseTable } from "./fnb-tables";
import {
  posCheckout,
  type PosCheckoutItem,
  type PaymentBreakdownItem,
} from "./pos-checkout";
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
 * Flatten kitchen_order items + toppings → invoice_items,
 * then call posCheckout(source='fnb') to create invoice + stock + cash.
 */
export async function fnbPayment(input: FnbPaymentInput): Promise<FnbPaymentResult> {
  // 1. Load kitchen order + items
  const order = await getKitchenOrderById(input.kitchenOrderId);

  if (order.status === "completed" || order.status === "cancelled") {
    throw new Error(`Đơn bếp đã ${order.status === "completed" ? "thanh toán" : "hủy"}. Không thể thanh toán lại.`);
  }

  // 2. Flatten to PosCheckoutItems: each drink + each topping = separate line
  const checkoutItems: PosCheckoutItem[] = [];

  for (const item of order.items) {
    // Main product line
    checkoutItems.push({
      productId: item.productId,
      productName: item.variantLabel
        ? `${item.productName} (${item.variantLabel})`
        : item.productName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discount: 0,
    });

    // Topping lines (each topping = separate invoice_item for stock tracking)
    if (item.toppings && item.toppings.length > 0) {
      for (const topping of item.toppings) {
        if (topping.quantity <= 0) continue; // skip zero-qty toppings
        checkoutItems.push({
          productId: topping.productId,
          productName: topping.name,
          quantity: topping.quantity * item.quantity,
          unitPrice: topping.price,
          discount: 0,
        });
      }
    }
  }

  // 3. Calculate totals (include order-level discount from kitchen order)
  const subtotal = checkoutItems.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice,
    0
  );
  const orderDiscount = order.discountAmount ?? 0;
  const inputDiscount = input.discountAmount ?? 0;
  const discountAmount = orderDiscount + inputDiscount;
  const deliveryFee = order.deliveryFee ?? 0;
  const total = subtotal - discountAmount + deliveryFee;

  // 4. Call posCheckout with source='fnb'
  const result = await posCheckout({
    tenantId: input.tenantId,
    branchId: input.branchId,
    createdBy: input.createdBy,
    customerId: input.customerId,
    customerName: input.customerName || "Khách lẻ",
    items: checkoutItems,
    paymentMethod: input.paymentMethod,
    paymentBreakdown: input.paymentBreakdown,
    subtotal,
    discountAmount,
    total,
    paid: input.paid,
    note: input.note ?? `F&B - ${order.orderNumber}`,
    source: "fnb",
  });

  // 5. Link invoice to kitchen order + mark completed
  await linkInvoiceToOrder(input.kitchenOrderId, result.invoiceId);

  // 6. Release table if dine_in
  if (order.tableId) {
    await releaseTable(order.tableId);
  }

  return {
    invoiceId: result.invoiceId,
    invoiceCode: result.invoiceCode,
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
}): Promise<void> {
  const supabase = getClient();

  // 1. Load invoice to verify it's completed
  const { data: invoice, error: invErr } = await supabase
    .from("invoices")
    .select("id, code, status, total, paid, source")
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
