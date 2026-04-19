/**
 * Offline-aware checkout wrappers.
 *
 * When online: calls real Supabase services directly.
 * When offline: writes to IndexedDB + enqueues for later replay.
 */

import { getDb, getMeta, setMeta } from "./db";
import { enqueue } from "./sync-manager";
import {
  sendToKitchen,
  fnbPayment,
  addItemsToExistingOrder,
  type SendToKitchenInput,
  type SendToKitchenResult,
  type FnbPaymentInput,
  type FnbPaymentResult,
} from "@/lib/services/supabase/fnb-checkout";
import {
  posCheckout,
  type PosCheckoutInput,
  type PosCheckoutResult,
} from "@/lib/services/supabase/pos-checkout";

// ── Send to Kitchen (offline-aware) ──

export async function offlineSendToKitchen(
  input: SendToKitchenInput,
  isOnline: boolean
): Promise<SendToKitchenResult & { isOffline?: boolean }> {
  // Online → call real service
  if (isOnline) {
    return sendToKitchen(input);
  }

  // Offline → write to IndexedDB
  const localId = `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const localOrderNumber = await getNextLocalOrderNumber();

  // Store in pending_orders
  const db = await getDb();
  await db.put("pending_orders", {
    localId,
    tenantId: input.tenantId,
    branchId: input.branchId,
    localOrderNumber,
    orderType: input.orderType,
    tableId: input.tableId,
    items: input.items,
    note: input.note,
    status: "pending_kitchen",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Enqueue for replay
  await enqueue({
    action: "sendToKitchen",
    payload: input,
    localId,
    createdAt: new Date().toISOString(),
  });

  return {
    kitchenOrderId: localId,
    orderNumber: localOrderNumber,
    isOffline: true,
  };
}

// ── FnB Payment (offline-aware) ──

export async function offlineFnbPayment(
  input: FnbPaymentInput,
  isOnline: boolean
): Promise<FnbPaymentResult & { isOffline?: boolean }> {
  // Online → call real service
  if (isOnline) {
    return fnbPayment(input);
  }

  // Offline → update pending order + enqueue
  const localId = input.kitchenOrderId; // may be a local ID
  const localInvoiceCode = await getNextLocalInvoiceNumber();

  const db = await getDb();
  const existingOrder = await db.get("pending_orders", localId);

  if (existingOrder) {
    await db.put("pending_orders", {
      ...existingOrder,
      status: "pending_payment",
      paymentData: input,
      updatedAt: new Date().toISOString(),
    });
  } else {
    // Payment for an order that was created online but paying offline
    await db.put("pending_orders", {
      localId,
      tenantId: input.tenantId,
      branchId: input.branchId,
      localOrderNumber: "ONLINE",
      orderType: "dine_in",
      items: [],
      status: "pending_payment",
      paymentData: input,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  // Enqueue for replay
  await enqueue({
    action: "fnbPayment",
    payload: input,
    localId,
    createdAt: new Date().toISOString(),
  });

  return {
    invoiceId: localId,
    invoiceCode: localInvoiceCode,
    isOffline: true,
  };
}

// ── Add Items to Existing Order (offline-aware) ──

export async function offlineAddItemsToExistingOrder(
  kitchenOrderId: string,
  items: SendToKitchenInput["items"],
  isOnline: boolean
): Promise<{ isOffline?: boolean }> {
  // Online → call real service directly
  if (isOnline) {
    await addItemsToExistingOrder(kitchenOrderId, items);
    return {};
  }

  // Offline → update pending order + enqueue replay
  const db = await getDb();
  const existingOrder = await db.get("pending_orders", kitchenOrderId);

  if (existingOrder) {
    // Append items to the offline order so UI can reflect new lines
    const mergedItems = Array.isArray(existingOrder.items)
      ? [...(existingOrder.items as unknown[]), ...items]
      : [...items];

    await db.put("pending_orders", {
      ...existingOrder,
      items: mergedItems,
      updatedAt: new Date().toISOString(),
    });
  }

  await enqueue({
    action: "addItems",
    payload: { kitchenOrderId, items },
    localId: kitchenOrderId,
    createdAt: new Date().toISOString(),
  });

  return { isOffline: true };
}

// ── Retail POS Checkout (offline-aware) ──

/**
 * Offline-aware wrapper for Retail POS checkout (bán lẻ).
 *
 * Online → call real `posCheckout`.
 * Offline → write to IndexedDB `pending_orders` with status=`pending_retail_checkout`
 *           + enqueue in sync_queue.
 *
 * Difference from FnB: Retail has no kitchen step — checkout is atomic
 * (invoice + stock + cash in one shot). So we store the FULL PosCheckoutInput
 * as the payload and replay it as a single action on reconnect.
 */
export async function offlinePosCheckout(
  input: PosCheckoutInput,
  isOnline: boolean
): Promise<PosCheckoutResult & { isOffline?: boolean }> {
  if (isOnline) {
    return posCheckout(input);
  }

  const localId = `local_retail_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const localInvoiceCode = await getNextLocalRetailInvoiceNumber();

  const db = await getDb();
  await db.put("pending_orders", {
    localId,
    tenantId: input.tenantId,
    branchId: input.branchId,
    localOrderNumber: localInvoiceCode,
    orderType: "retail",
    items: input.items,
    note: input.note,
    status: "pending_retail_checkout",
    paymentData: input,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  await enqueue({
    action: "posCheckout",
    payload: input,
    localId,
    createdAt: new Date().toISOString(),
  });

  return {
    invoiceId: localId,
    invoiceCode: localInvoiceCode,
    isOffline: true,
  };
}

// ── Local counters ──

async function getNextLocalOrderNumber(): Promise<string> {
  const current = (await getMeta<number>("local_order_counter")) ?? 0;
  const next = current + 1;
  await setMeta("local_order_counter", next);
  return `LOCAL-${String(next).padStart(3, "0")}`;
}

async function getNextLocalInvoiceNumber(): Promise<string> {
  const current = (await getMeta<number>("local_invoice_counter")) ?? 0;
  const next = current + 1;
  await setMeta("local_invoice_counter", next);
  return `LOCAL-PAY-${String(next).padStart(3, "0")}`;
}

async function getNextLocalRetailInvoiceNumber(): Promise<string> {
  const current = (await getMeta<number>("local_retail_invoice_counter")) ?? 0;
  const next = current + 1;
  await setMeta("local_retail_invoice_counter", next);
  return `LOCAL-HD-${String(next).padStart(3, "0")}`;
}
