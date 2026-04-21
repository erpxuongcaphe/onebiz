/**
 * Quota Manager — xử lý giới hạn dung lượng IndexedDB.
 *
 * Tại sao cần:
 *   Safari iOS cap ~50MB per origin; Chrome cap theo % ổ đĩa (thường 6% = vài GB
 *   trên desktop nhưng có thể 500MB trên mobile cũ). Khi offline lâu + pending_orders
 *   tích luỹ + menu_cache lớn → có thể vượt quota → `db.put` throw QuotaExceededError.
 *
 *   Nếu không handle, user sẽ thấy payment fail ở offline mode — đúng lúc cần nhất.
 *   Module này cung cấp:
 *     1. Predicate phát hiện quota error từ bất kỳ driver nào (idb, raw IDB, DOMException)
 *     2. Storage estimate + persistent storage request
 *     3. Emergency cleanup evict non-critical data (menu_cache + completed sync entries)
 *     4. Wrapper `withQuotaRecovery` để retry 1 lần sau cleanup
 */

import { getDb } from "./db";

/**
 * Phát hiện lỗi QuotaExceededError đa trình duyệt.
 *
 * Chrome / modern: error.name === "QuotaExceededError"
 * Firefox cũ: name === "NS_ERROR_DOM_QUOTA_REACHED"
 * Safari cũ: DOMException.code === 22
 * idb-wrapper đôi khi wrap error nên check cả `cause` và `message`.
 */
export function isQuotaExceededError(err: unknown): boolean {
  if (!err) return false;
  const e = err as { name?: string; code?: number; message?: string; cause?: unknown };
  if (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED") {
    return true;
  }
  // DOMException code 22 = QUOTA_EXCEEDED_ERR (legacy)
  if (typeof e.code === "number" && e.code === 22) return true;
  // Một số browser throw Error thay vì DOMException — check message
  if (typeof e.message === "string" && /quota/i.test(e.message)) return true;
  // idb wrapper có thể nhét lỗi gốc vào cause
  if (e.cause) return isQuotaExceededError(e.cause);
  return false;
}

export interface StorageEstimate {
  /** Bytes quota tối đa trình duyệt cấp cho origin này. */
  quota: number;
  /** Bytes đang sử dụng. */
  usage: number;
  /** % đã dùng (0-100). */
  percentUsed: number;
  /** Có support navigator.storage.estimate() hay không. */
  supported: boolean;
}

/**
 * Lấy estimate của Storage API. Trả `supported=false` trên trình duyệt cũ.
 */
export async function getStorageEstimate(): Promise<StorageEstimate> {
  if (
    typeof navigator === "undefined" ||
    !navigator.storage ||
    typeof navigator.storage.estimate !== "function"
  ) {
    return { quota: 0, usage: 0, percentUsed: 0, supported: false };
  }
  try {
    const est = await navigator.storage.estimate();
    const quota = est.quota ?? 0;
    const usage = est.usage ?? 0;
    const percentUsed = quota > 0 ? (usage / quota) * 100 : 0;
    return { quota, usage, percentUsed, supported: true };
  } catch {
    return { quota: 0, usage: 0, percentUsed: 0, supported: false };
  }
}

/**
 * Yêu cầu trình duyệt cấp persistent storage — sẽ không bị evict khi hết dung lượng.
 * Chrome / Edge: cần điều kiện (PWA installed, bookmarked, hoặc gran permission).
 * Safari / iOS: không support — luôn trả false.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (
    typeof navigator === "undefined" ||
    !navigator.storage ||
    typeof navigator.storage.persist !== "function"
  ) {
    return false;
  }
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export interface EmergencyCleanupResult {
  menuCacheCleared: boolean;
  completedSyncRemoved: number;
  /** Số byte giảm được sau cleanup (nếu đo được, 0 nếu không). */
  bytesFreed: number;
}

/**
 * Cleanup khẩn cấp khi gần hết quota. Xoá dữ liệu có thể tái tạo:
 *   - menu_cache (sẽ fetch lại từ server)
 *   - sync_queue entries đã completed (không còn cần replay)
 *
 * KHÔNG xoá pending_orders / sync_queue pending / failed — những cái đó là
 * dữ liệu chưa sync lên server, mất là mất luôn.
 */
export async function performEmergencyCleanup(): Promise<EmergencyCleanupResult> {
  const before = await getStorageEstimate();

  let menuCacheCleared = false;
  let completedSyncRemoved = 0;

  try {
    const db = await getDb();

    // 1. Clear menu_cache — có thể fetch lại từ server
    try {
      await db.clear("menu_cache");
      menuCacheCleared = true;
    } catch {
      // ignore — có thể store không exist
    }

    // 2. Xoá sync_queue entries đã completed
    try {
      const tx = db.transaction("sync_queue", "readwrite");
      const store = tx.objectStore("sync_queue");
      const completedKeys = await store.index("by_status").getAllKeys("completed");
      for (const key of completedKeys) {
        await store.delete(key);
      }
      await tx.done;
      completedSyncRemoved = completedKeys.length;
    } catch {
      // ignore
    }
  } catch {
    // getDb() fail — không làm gì được
  }

  const after = await getStorageEstimate();
  const bytesFreed = Math.max(0, before.usage - after.usage);

  return { menuCacheCleared, completedSyncRemoved, bytesFreed };
}

/**
 * Wrap một async operation — nếu throw QuotaExceededError thì
 * chạy emergency cleanup rồi retry đúng 1 lần. Lần 2 fail → propagate.
 *
 * Dùng cho writes quan trọng không-mất-được như `enqueue`, `pending_orders.put`.
 */
export async function withQuotaRecovery<T>(
  operation: () => Promise<T>,
  onCleanup?: (result: EmergencyCleanupResult) => void,
): Promise<T> {
  try {
    return await operation();
  } catch (err) {
    if (!isQuotaExceededError(err)) throw err;
    const cleanupResult = await performEmergencyCleanup();
    onCleanup?.(cleanupResult);
    // Retry — nếu vẫn fail, throw để caller xử lý
    return await operation();
  }
}

/**
 * Ngưỡng warning khi user cần biết quota sắp đầy.
 * 80% = recommend cleanup; 95% = phải cleanup ngay trước khi write lớn.
 */
export const QUOTA_WARN_PERCENT = 80;
export const QUOTA_CRITICAL_PERCENT = 95;

/**
 * Check preemptive — gọi trước khi prefetch menu lớn.
 * Nếu > CRITICAL → chạy cleanup luôn (trước khi fail).
 * Nếu > WARN → chỉ return flag để UI show warning.
 */
export interface QuotaHealthCheck {
  estimate: StorageEstimate;
  level: "ok" | "warn" | "critical";
  cleanupPerformed: EmergencyCleanupResult | null;
}

export async function checkQuotaHealth(
  autoCleanupOnCritical = true,
): Promise<QuotaHealthCheck> {
  const estimate = await getStorageEstimate();

  if (!estimate.supported || estimate.quota === 0) {
    return { estimate, level: "ok", cleanupPerformed: null };
  }

  let level: QuotaHealthCheck["level"] = "ok";
  let cleanupPerformed: EmergencyCleanupResult | null = null;

  if (estimate.percentUsed >= QUOTA_CRITICAL_PERCENT) {
    level = "critical";
    if (autoCleanupOnCritical) {
      cleanupPerformed = await performEmergencyCleanup();
    }
  } else if (estimate.percentUsed >= QUOTA_WARN_PERCENT) {
    level = "warn";
  }

  return { estimate, level, cleanupPerformed };
}

/**
 * Format bytes sang string đọc được (KB / MB / GB).
 * Dùng cho UI warning: `${formatBytes(estimate.usage)} / ${formatBytes(estimate.quota)}`.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
