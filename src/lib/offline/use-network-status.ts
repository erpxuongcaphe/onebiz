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
import { replayQueue, getPendingCount } from "./sync-manager";

export interface NetworkStatus {
  isOnline: boolean;
  pendingCount: number;
  isSyncing: boolean;
}

export function useNetworkStatus(): NetworkStatus {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const wasOfflineRef = useRef(false);

  // Poll pending count
  const refreshPendingCount = useCallback(async () => {
    try {
      const count = await getPendingCount();
      setPendingCount(count);
    } catch {
      // IndexedDB not available (SSR)
    }
  }, []);

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
        await refreshPendingCount();
      }
    }
  }, [refreshPendingCount]);

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

    // Poll pending count every 5 seconds
    refreshPendingCount();
    const interval = setInterval(refreshPendingCount, 5000);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(interval);
    };
  }, [handleOnline, handleOffline, refreshPendingCount]);

  // Listen for sync events to update count
  useEffect(() => {
    const handleSync = () => {
      refreshPendingCount();
    };
    window.addEventListener("fnb-sync-complete", handleSync);
    return () => window.removeEventListener("fnb-sync-complete", handleSync);
  }, [refreshPendingCount]);

  return { isOnline, pendingCount, isSyncing };
}
