"use client";

/**
 * ConnectionStatusBar — thin bar showing online/offline/syncing state.
 *
 * - Online: green flash, auto-hides after 3s
 * - Offline: red/orange bar stays visible + pending count
 * - Syncing: animated blue bar
 */

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import type { NetworkStatus } from "@/lib/offline";
import { Icon } from "@/components/ui/icon";

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
          ? "bg-primary text-white animate-pulse"
          : isOnline
            ? pendingCount > 0
              ? "bg-amber-500 text-white"
              : "bg-green-500 text-white"
            : "bg-red-500 text-white"
      )}
    >
      {isSyncing ? (
        <>
          <Icon name="progress_activity" size={14} className="animate-spin" />
          <span>Đang đồng bộ... ({pendingCount} đơn)</span>
        </>
      ) : isOnline ? (
        pendingCount > 0 ? (
          <>
            <Icon name="cloud_off" size={14} />
            <span>{pendingCount} đơn chờ đồng bộ</span>
          </>
        ) : (
          <>
            <Icon name="wifi" size={14} />
            <span>Đã kết nối</span>
          </>
        )
      ) : (
        <>
          <Icon name="wifi_off" size={14} />
          <span>
            Ngoại tuyến
            {pendingCount > 0 && ` — ${pendingCount} đơn chờ đồng bộ`}
          </span>
        </>
      )}
    </div>
  );
}
