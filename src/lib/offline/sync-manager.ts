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
// Cap kích thước queue để tránh growth vô hạn nếu thiết bị offline lâu + sync fail.
// Khi vượt ngưỡng, force-clear completed + oldest failed (giữ pending/syncing).
const MAX_QUEUE_SIZE = 500;

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
 * Nếu sync_queue vượt MAX_QUEUE_SIZE, xoá completed (đã sync xong, không cần replay)
 * và oldest failed (đã retry đủ số lần, user chắc chắn biết qua UI). Giữ pending
 * và syncing — đó là data chưa được ghi lên server.
 */
async function pruneIfOversized(): Promise<void> {
  try {
    const db = await getDb();
    const count = await db.count("sync_queue");
    if (count < MAX_QUEUE_SIZE) return;

    const tx = db.transaction("sync_queue", "readwrite");
    const store = tx.objectStore("sync_queue");

    // 1. Xoá hết completed
    const completedKeys = await store.index("by_status").getAllKeys("completed");
    for (const key of completedKeys) {
      await store.delete(key);
    }

    // 2. Nếu vẫn oversized, xoá failed cũ nhất cho đến khi size < MAX
    const remaining = count - completedKeys.length;
    if (remaining >= MAX_QUEUE_SIZE) {
      const failed = await store.index("by_status").getAll("failed");
      failed.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
      const toRemove = remaining - MAX_QUEUE_SIZE + 1;
      for (let i = 0; i < toRemove && i < failed.length; i++) {
        const id = failed[i].id;
        if (id != null) await store.delete(id);
      }
    }
    await tx.done;
  } catch (err) {
    // Prune best-effort — không throw để không block enqueue. Nếu vẫn quota exceeded
    // thì withQuotaRecovery sẽ catch ở vòng sau.
    if (!isQuotaExceededError(err)) {
      // log chỉ khi không phải quota (quota đã có cleanup riêng)
      // eslint-disable-next-line no-console
      console.warn("[sync-manager] prune failed:", err);
    }
  }
}

// ── Replay Queue ──

export async function replayQueue(): Promise<SyncResult[]> {
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
    await db.put("sync_queue", { ...entry, status: "syncing" });

    try {
      const serverData = await executeAction(entry.action, entry.payload);

      // Success — mark completed
      await db.put("sync_queue", {
        ...entry,
        status: "completed",
        lastAttempt: new Date().toISOString(),
      });

      // Update pending order with server data
      await updatePendingOrder(entry.localId, entry.action, serverData);

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

      if (attempts >= MAX_ATTEMPTS) {
        // Max attempts reached — mark failed
        await db.put("sync_queue", {
          ...entry,
          status: "failed",
          attempts,
          lastAttempt: new Date().toISOString(),
          error: errorMsg,
        });
      } else {
        // Back to pending with incremented attempts
        await db.put("sync_queue", {
          ...entry,
          status: "pending",
          attempts,
          lastAttempt: new Date().toISOString(),
          error: errorMsg,
        });
      }

      results.push({
        entryId: entry.id,
        action: entry.action,
        localId: entry.localId,
        success: false,
        error: errorMsg,
      });

      // Exponential backoff before next entry
      const delay = Math.min(1000 * Math.pow(2, attempts), MAX_BACKOFF_MS);
      await sleep(delay);
    }
  }

  return results;
}

// ── Helpers ──

async function executeAction(
  action: SyncAction,
  payload: unknown
): Promise<unknown> {
  switch (action) {
    case "sendToKitchen":
      return sendToKitchen(payload as SendToKitchenInput);
    case "fnbPayment":
      return fnbPayment(payload as FnbPaymentInput);
    case "addItems": {
      const p = payload as { kitchenOrderId: string; items: SendToKitchenInput["items"] };
      await addItemsToExistingOrder(p.kitchenOrderId, p.items);
      return { success: true };
    }
    case "posCheckout":
      return posCheckout(payload as PosCheckoutInput);
    default:
      throw new Error(`Unknown sync action: ${action}`);
  }
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
      status: "synced",
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
