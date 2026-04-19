/**
 * Sync Manager — FIFO replay queue for offline mutations.
 *
 * When the device goes offline, mutations (sendToKitchen, fnbPayment, etc.)
 * are queued in IndexedDB. When online again, this manager replays them
 * in order with exponential backoff retry.
 */

import { getDb, type SyncQueueEntry, type SyncAction } from "./db";
import { sendToKitchen, fnbPayment, addItemsToExistingOrder } from "@/lib/services/supabase/fnb-checkout";
import type { SendToKitchenInput, FnbPaymentInput } from "@/lib/services/supabase/fnb-checkout";
import { posCheckout } from "@/lib/services/supabase/pos-checkout";
import type { PosCheckoutInput } from "@/lib/services/supabase/pos-checkout";

// ── Constants ──

const MAX_ATTEMPTS = 10;
const MAX_BACKOFF_MS = 30_000;

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
  const db = await getDb();
  const id = await db.add("sync_queue", {
    ...entry,
    status: "pending",
    attempts: 0,
    lastAttempt: null,
    error: null,
  } as SyncQueueEntry);
  return id as number;
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
