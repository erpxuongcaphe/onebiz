/**
 * useNetworkStatus — React hook for online/offline detection.
 *
 * Tracks:
 *   - isOnline: navigator.onLine + event listeners
 *   - pendingCount: number of queued offline mutations
 *   - isSyncing: whether replay is in progress
 *
 * Auto-triggers queue replay when transitioning offline → online.
 */

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  replayQueue,
  getPendingCount,
  getFailedCount,
  clearCompleted,
} from "./sync-manager";

export interface NetworkStatus {
  isOnline: boolean;
  pendingCount: number;
  failedCount: number;
  isSyncing: boolean;
  /** Manually trigger a replay — useful for user-initiated "Đồng bộ lại" button */
  syncNow: () => Promise<void>;
}

export function useNetworkStatus(): NetworkStatus {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [pendingCount, setPendingCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const wasOfflineRef = useRef(false);

  // Poll pending + failed counts
  const refreshCounts = useCallback(async () => {
    try {
      const [pending, failed] = await Promise.all([
        getPendingCount(),
        getFailedCount(),
      ]);
      setPendingCount(pending);
      setFailedCount(failed);
    } catch {
      // IndexedDB not available (SSR)
    }
  }, []);

  // Manual sync trigger (exposed for user action)
  const syncNow = useCallback(async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      await replayQueue();
    } catch {
      // Errors handled per-entry inside replayQueue
    } finally {
      setIsSyncing(false);
      await refreshCounts();
    }
  }, [isSyncing, refreshCounts]);

  // Replay queue when coming back online
  const handleOnline = useCallback(async () => {
    setIsOnline(true);

    if (wasOfflineRef.current) {
      wasOfflineRef.current = false;

      // Auto-replay queue
      setIsSyncing(true);
      try {
        await replayQueue();
      } catch {
        // Errors handled per-entry inside replayQueue
      } finally {
        setIsSyncing(false);
        await refreshCounts();
      }
    }
  }, [refreshCounts]);

  const handleOffline = useCallback(() => {
    setIsOnline(false);
    wasOfflineRef.current = true;
  }, []);

  useEffect(() => {
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Initial state
    if (!navigator.onLine) {
      wasOfflineRef.current = true;
    }

    // Auto-clear completed entries on mount — keeps IndexedDB tidy
    clearCompleted().catch(() => {});

    // Poll counts every 5 seconds
    refreshCounts();
    const interval = setInterval(refreshCounts, 5000);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(interval);
    };
  }, [handleOnline, handleOffline, refreshCounts]);

  // Listen for sync events to update counts
  useEffect(() => {
    const handleSync = () => {
      refreshCounts();
    };
    window.addEventListener("fnb-sync-complete", handleSync);
    window.addEventListener("fnb-sync-queue-updated", handleSync);
    return () => {
      window.removeEventListener("fnb-sync-complete", handleSync);
      window.removeEventListener("fnb-sync-queue-updated", handleSync);
    };
  }, [refreshCounts]);

  return { isOnline, pendingCount, failedCount, isSyncing, syncNow };
}
