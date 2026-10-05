/**
 * Sync Manager — FIFO replay queue for offline mutations.
 *
 * When the device goes offline, mutations (sendToKitchen, fnbPayment, etc.)
 * are queued in IndexedDB. When online again, this manager replays them
 * in order with exponential backoff retry.
 */

import { getDb, type SyncQueueEntry, type SyncAction } from "./db";
import { withQuotaRecovery, isQuotaExceededError } from "./quota-manager";
import { sendToKitchen, fnbPayment, addItemsToExistingOrder } from "@/lib/services/supabase/fnb-checkout";
import type { SendToKitchenInput, FnbPaymentInput } from "@/lib/services/supabase/fnb-checkout";
import { posCheckout } from "@/lib/services/supabase/pos-checkout";
import type { PosCheckoutInput } from "@/lib/services/supabase/pos-checkout";

// ── Constants ──

const MAX_ATTEMPTS = 10;
const MAX_BACKOFF_MS = 30_000;
const STUCK_SYNC_TIMEOUT_MS = 2 * 60_000;
// Cleanup threshold, not an eviction limit for unsynced business data.
const QUEUE_CLEANUP_THRESHOLD = 500;

// ── Types ──

export interface SyncResult {
  entryId: number;
  action: SyncAction;
  localId: string;
  success: boolean;
  serverData?: unknown;
  error?: string;
}

// ── Enqueue ──

export async function enqueue(
  entry: Omit<SyncQueueEntry, "id" | "status" | "attempts" | "lastAttempt" | "error">
): Promise<number> {
  // Preemptive prune — tránh queue phình lớn trước khi kiểm tra quota.
  await pruneIfOversized();

  // withQuotaRecovery: nếu QuotaExceededError → cleanup menu_cache + completed
  // entries rồi retry. Lần 2 fail sẽ throw — caller của enqueue (offlineCheckout)
  // cần surface lỗi cho user: "Hết dung lượng lưu trữ, hãy sync trước khi
  // tạo thêm đơn offline".
  return withQuotaRecovery(async () => {
    const db = await getDb();
    const id = await db.add("sync_queue", {
      ...entry,
      status: "pending",
      attempts: 0,
      lastAttempt: null,
      error: null,
    } as SyncQueueEntry);
    return id as number;
  });
}

/**
 * Only completed entries can be pruned. Failed entries may still contain an
 * unsaved payment/order; exhausting retries does not make them disposable.
 */
async function pruneIfOversized(): Promise<void> {
  try {
    const db = await getDb();
    const count = await db.count("sync_queue");
    if (count < QUEUE_CLEANUP_THRESHOLD) return;

    const tx = db.transaction("sync_queue", "readwrite");
    const store = tx.objectStore("sync_queue");

    // 1. Xoá hết completed
    const completedKeys = await store.index("by_status").getAllKeys("completed");
    for (const key of completedKeys) {
      await store.delete(key);
    }

    await tx.done;
  } catch (err) {
    // Prune best-effort — không throw để không block enqueue. Nếu vẫn quota exceeded
    // thì withQuotaRecovery sẽ catch ở vòng sau.
    if (!isQuotaExceededError(err)) {
      // log chỉ khi không phải quota (quota đã có cleanup riêng)
       
      console.warn("[sync-manager] prune failed:", err);
    }
  }
}

// ── Replay Queue ──

export function isPosStockConflict(message: string): boolean {
  return /POS_STOCK_SHORTAGE|NVL_INSUFFICIENT|INSUFFICIENT_STOCK/i.test(message);
}

export function shouldRecoverSyncEntry(
  entry: Pick<SyncQueueEntry, "status" | "lastAttempt">,
  nowMs: number = Date.now(),
): boolean {
  if (entry.status !== "syncing") return false;
  if (!entry.lastAttempt) return true;
  const attemptedAt = Date.parse(entry.lastAttempt);
  return !Number.isFinite(attemptedAt) ||
    nowMs - attemptedAt >= STUCK_SYNC_TIMEOUT_MS;
}

async function recoverStuckSyncEntries(): Promise<number> {
  const db = await getDb();
  const syncing = await db
    .transaction("sync_queue")
    .objectStore("sync_queue")
    .index("by_status")
    .getAll("syncing");
  const recoverable = syncing.filter((entry) => shouldRecoverSyncEntry(entry));
  if (recoverable.length === 0) return 0;

  const tx = db.transaction("sync_queue", "readwrite");
  for (const entry of recoverable) {
    await tx.store.put({
      ...entry,
      status: "pending",
      error: "Lần đồng bộ trước bị gián đoạn. Hệ thống đang thử lại.",
    });
  }
  await tx.done;
  return recoverable.length;
}

let activeReplay: Promise<SyncResult[]> | null = null;

export function replayQueue(): Promise<SyncResult[]> {
  // Online events and manual sync can overlap across mounted POS consumers.
  // Share the run before its first IndexedDB await, then release on any outcome.
  if (activeReplay) return activeReplay;
  activeReplay = replayWithBrowserLock().finally(() => {
    activeReplay = null;
  });
  return activeReplay;
}

async function replayWithBrowserLock(): Promise<SyncResult[]> {
  // IndexedDB is shared by same-origin tabs; claim the whole FIFO run before
  // reading pending entries. Backend idempotency still protects other devices.
  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    return navigator.locks.request(
      "onebiz-offline-queue-replay",
      { mode: "exclusive" },
      replayQueueOnce,
    );
  }
  return replayQueueOnce();
}

async function replayQueueOnce(): Promise<SyncResult[]> {
  await recoverStuckSyncEntries();
  const db = await getDb();
  const allEntries = await db
    .transaction("sync_queue")
    .objectStore("sync_queue")
    .index("by_status")
    .getAll("pending");

  // Sort by id (FIFO)
  allEntries.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));

  const results: SyncResult[] = [];

  for (const entry of allEntries) {
    if (!entry.id) continue;

    // Mark as syncing
    await db.put("sync_queue", {
      ...entry,
      status: "syncing",
      lastAttempt: new Date().toISOString(),
    });

    try {
      const payload = await resolveKitchenOrderPayload(entry);
      if (payload === undefined) {
        const error = "Thao tác trước của bill chưa đồng bộ xong. Giữ thao tác này để thử lại sau.";
        await db.put("sync_queue", { ...entry, status: "pending", error });
        results.push({ entryId: entry.id, action: entry.action,
          localId: entry.localId, success: false, error });
        continue;
      }
      const serverData = await executeAction(entry.action, payload, entry.createdAt);

      const checkpointFirst = entry.action === "sendToKitchen" || entry.action === "fnbPayment";
      // Never persist completion before the F&B server identity: a reload in
      // between would leave dependent actions without a recoverable mapping.
      if (checkpointFirst) {
        await updatePendingOrder(entry.localId, entry.action, serverData);
      }

      // Success — mark completed
      await db.put("sync_queue", {
        ...entry,
        status: "completed",
        error: null,
        lastAttempt: new Date().toISOString(),
      });

      // Update pending order with server data
      if (!checkpointFirst) {
        await updatePendingOrder(entry.localId, entry.action, serverData);
      }

      results.push({
        entryId: entry.id,
        action: entry.action,
        localId: entry.localId,
        success: true,
        serverData,
      });

      // Notify UI
      dispatchSyncEvent(entry.localId, entry.action, serverData);
    } catch (err) {
      const attempts = entry.attempts + 1;
      const errorMsg = err instanceof Error ? err.message : String(err);

      const stockConflict =
        entry.action === "posCheckout" && isPosStockConflict(errorMsg);
      const permanentlyFailed = stockConflict || attempts >= MAX_ATTEMPTS;
      await db.put("sync_queue", {
        ...entry,
        status: permanentlyFailed ? "failed" : "pending",
        attempts,
        lastAttempt: new Date().toISOString(),
        error: errorMsg,
      });
      if (stockConflict) {
        await markPendingOrderFailed(entry.localId, errorMsg);
      }

      results.push({
        entryId: entry.id,
        action: entry.action,
        localId: entry.localId,
        success: false,
        error: errorMsg,
      });

      // Exponential backoff before next entry
      if (!stockConflict) {
        const delay = Math.min(1000 * Math.pow(2, attempts), MAX_BACKOFF_MS);
        await sleep(delay);
      }
    }
  }

  return results;
}

// ── Helpers ──

async function resolveKitchenOrderPayload(entry: SyncQueueEntry): Promise<unknown> {
  if (entry.action !== "fnbPayment" && entry.action !== "addItems") return entry.payload;
  const db = await getDb();
  // A lost response is not proof that a supplement was rejected. Wait for its
  // stable batch replay before paying or adding the next dependent batch.
  for (const status of ["pending", "syncing", "failed"] as const) {
    const predecessors = await db.transaction("sync_queue").objectStore("sync_queue")
      .index("by_status").getAll(status);
    if (predecessors.some(previous => previous.localId === entry.localId &&
        (previous.id ?? 0) < (entry.id ?? 0) &&
        (previous.action === "sendToKitchen" || previous.action === "addItems" || previous.action === "fnbPayment"))) {
      return undefined;
    }
  }
  const payload = entry.payload as { kitchenOrderId: string; tenantId?: string; branchId?: string };
  if (!payload.kitchenOrderId.startsWith("local_")) return entry.payload;
  const order = await db.get("pending_orders", payload.kitchenOrderId);
  // Resolve dependencies at replay time, including after an interrupted sync.
  if (!order?.serverOrderId || order.serverOrderId.startsWith("local_") ||
      entry.localId !== order.localId ||
      (entry.action === "fnbPayment" &&
        (payload.tenantId !== order.tenantId || payload.branchId !== order.branchId))) {
    return undefined;
  }
  return { ...payload, kitchenOrderId: order.serverOrderId };
}

async function executeAction(
  action: SyncAction,
  payload: unknown,
  queuedAt?: string,
): Promise<unknown> {
  switch (action) {
    case "sendToKitchen":
      return sendToKitchen(payload as SendToKitchenInput);
    case "fnbPayment":
      return fnbPayment({ ...(payload as FnbPaymentInput), occurredAt: (payload as FnbPaymentInput).occurredAt ?? queuedAt });
    case "addItems": {
      // P0-8 fix 12/06/2026: forward batchId từ payload — DB UNIQUE INDEX
      // (kitchen_order_id, batch_id) chặn nếu queue replay 2 lần cùng batch.
      const p = payload as { kitchenOrderId: string; items: SendToKitchenInput["items"]; batchId?: string };
      await addItemsToExistingOrder(p.kitchenOrderId, p.items, { batchId: p.batchId });
      return { success: true };
    }
    case "posCheckout":
      return posCheckout(payload as PosCheckoutInput);
    default:
      throw new Error(`Unknown sync action: ${action}`);
  }
}

async function markPendingOrderFailed(
  localId: string,
  error: string,
): Promise<void> {
  const db = await getDb();
  const order = await db.get("pending_orders", localId);
  if (!order) return;
  await db.put("pending_orders", {
    ...order,
    status: "failed",
    updatedAt: new Date().toISOString(),
    syncError: error,
  });
}

async function updatePendingOrder(
  localId: string,
  action: SyncAction,
  serverData: unknown
): Promise<void> {
  const db = await getDb();
  const order = await db.get("pending_orders", localId);
  if (!order) return;

  if (action === "sendToKitchen") {
    const data = serverData as { kitchenOrderId: string; orderNumber: string };
    await db.put("pending_orders", {
      ...order,
      status: order.status === "pending_payment" ? "pending_payment" : "synced",
      serverOrderId: data.kitchenOrderId,
      serverOrderNumber: data.orderNumber,
      updatedAt: new Date().toISOString(),
    });
  } else if (action === "fnbPayment") {
    const data = serverData as { invoiceId: string; invoiceCode: string };
    await db.put("pending_orders", {
      ...order,
      status: "synced",
      serverInvoiceId: data.invoiceId,
      serverInvoiceCode: data.invoiceCode,
      updatedAt: new Date().toISOString(),
    });
  } else if (action === "posCheckout") {
    const data = serverData as { invoiceId: string; invoiceCode: string };
    await db.put("pending_orders", {
      ...order,
      status: "synced",
      serverInvoiceId: data.invoiceId,
      serverInvoiceCode: data.invoiceCode,
      updatedAt: new Date().toISOString(),
    });
  }
}

function dispatchSyncEvent(
  localId: string,
  action: SyncAction,
  serverData: unknown
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("fnb-sync-complete", {
      detail: { localId, action, serverData },
    })
  );
}

export async function getPendingCount(): Promise<number> {
  const db = await getDb();
  const pending = await db
    .transaction("sync_queue")
    .objectStore("sync_queue")
    .index("by_status")
    .getAllKeys("pending");
  const syncing = await db
    .transaction("sync_queue")
    .objectStore("sync_queue")
    .index("by_status")
    .getAllKeys("syncing");
  return pending.length + syncing.length;
}

export async function getFailedCount(): Promise<number> {
  const db = await getDb();
  const failed = await db
    .transaction("sync_queue")
    .objectStore("sync_queue")
    .index("by_status")
    .getAllKeys("failed");
  return failed.length;
}

export async function getQueueEntries(): Promise<SyncQueueEntry[]> {
  const db = await getDb();
  const all = await db.transaction("sync_queue").objectStore("sync_queue").getAll();
  // Sort FIFO
  return all.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
}

/**
 * Manually retry failed entries — reset their status to pending so next replayQueue picks them up.
 */
export async function retryFailedEntries(): Promise<number> {
  const db = await getDb();
  const failed = await db
    .transaction("sync_queue")
    .objectStore("sync_queue")
    .index("by_status")
    .getAll("failed");

  const tx = db.transaction("sync_queue", "readwrite");
  for (const entry of failed) {
    await tx.store.put({ ...entry, status: "pending", attempts: 0, error: null });
  }
  await tx.done;
  return failed.length;
}

/**
 * Delete a single queue entry (user-initiated abandonment).
 */
export async function deleteQueueEntry(id: number): Promise<void> {
  const db = await getDb();
  const entry = await db.get("sync_queue", id);
  if (!entry) return;
  if (entry.status !== "completed") {
    throw new Error("Không thể xoá đơn offline chưa đồng bộ xong.");
  }
  await db.delete("sync_queue", id);
}

/**
 * Retry a single queue entry — reset its status to pending so next replayQueue picks it up.
 * Returns true if the entry was reset, false if it wasn't in a retry-eligible state.
 */
export async function retryQueueEntry(id: number): Promise<boolean> {
  const db = await getDb();
  const entry = await db.get("sync_queue", id);
  if (!entry) return false;
  // Only allow retry from failed/pending (syncing is in-flight — don't reset)
  if (entry.status !== "failed" && entry.status !== "pending") return false;
  await db.put("sync_queue", {
    ...entry,
    status: "pending",
    attempts: 0,
    error: null,
  });
  return true;
}

export async function clearCompleted(): Promise<void> {
  const db = await getDb();
  const completed = await db
    .transaction("sync_queue")
    .objectStore("sync_queue")
    .index("by_status")
    .getAllKeys("completed");

  const tx = db.transaction("sync_queue", "readwrite");
  for (const key of completed) {
    await tx.store.delete(key);
  }
  await tx.done;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
