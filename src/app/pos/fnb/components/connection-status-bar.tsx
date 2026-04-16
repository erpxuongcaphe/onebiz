"use client";

/**
 * ConnectionStatusBar — thin bar showing online/offline/syncing state.
 *
 * - Online: green flash, auto-hides after 3s
 * - Offline: red/orange bar stays visible + pending count
 * - Syncing: animated blue bar
 */

import { useState, useEffect } from "react";
import { Wifi, WifiOff, Loader2, CloudOff } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NetworkStatus } from "@/lib/offline";

interface ConnectionStatusBarProps {
  status: NetworkStatus;
}

export function ConnectionStatusBar({ status }: ConnectionStatusBarProps) {
  const { isOnline, pendingCount, isSyncing } = status;
  const [visible, setVisible] = useState(!isOnline);
  const [wasOffline, setWasOffline] = useState(false);

  useEffect(() => {
    if (!isOnline) {
      setVisible(true);
      setWasOffline(true);
    } else if (wasOffline || isSyncing) {
      // Show briefly when coming back online
      setVisible(true);
      const timer = setTimeout(() => {
        if (!isSyncing && pendingCount === 0) {
          setVisible(false);
          setWasOffline(false);
        }
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [isOnline, isSyncing, pendingCount, wasOffline]);

  // Always show if there are pending items
  useEffect(() => {
    if (pendingCount > 0) setVisible(true);
  }, [pendingCount]);

  if (!visible && pendingCount === 0) return null;

  return (
    <div
      className={cn(
        "flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-medium transition-all shrink-0",
        isSyncing
          ? "bg-blue-500 text-white animate-pulse"
          : isOnline
            ? pendingCount > 0
              ? "bg-amber-500 text-white"
              : "bg-green-500 text-white"
            : "bg-red-500 text-white"
      )}
    >
      {isSyncing ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>Đang đồng bộ... ({pendingCount} đơn)</span>
        </>
      ) : isOnline ? (
        pendingCount > 0 ? (
          <>
            <CloudOff className="h-3.5 w-3.5" />
            <span>{pendingCount} đơn chờ đồng bộ</span>
          </>
        ) : (
          <>
            <Wifi className="h-3.5 w-3.5" />
            <span>Đã kết nối</span>
          </>
        )
      ) : (
        <>
          <WifiOff className="h-3.5 w-3.5" />
          <span>
            Ngoại tuyến
            {pendingCount > 0 && ` — ${pendingCount} đơn chờ đồng bộ`}
          </span>
        </>
      )}
    </div>
  );
}
