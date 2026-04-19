"use client";

/**
 * ConnectionStatusBar — thin bar showing online/offline/syncing state.
 *
 * - Online: green flash, auto-hides after 3s
 * - Offline: red/orange bar stays visible + pending count
 * - Syncing: animated blue bar
 * - Failed: red outlined with click-to-retry hint
 *
 * Click vào bar → mở SyncQueueDrawer để xem chi tiết hàng đợi.
 */

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import type { NetworkStatus } from "@/lib/offline";
import { Icon } from "@/components/ui/icon";

interface ConnectionStatusBarProps {
  status: NetworkStatus;
  onClick?: () => void;
}

export function ConnectionStatusBar({ status, onClick }: ConnectionStatusBarProps) {
  const { isOnline, pendingCount, failedCount, isSyncing } = status;
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
        if (!isSyncing && pendingCount === 0 && failedCount === 0) {
          setVisible(false);
          setWasOffline(false);
        }
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [isOnline, isSyncing, pendingCount, failedCount, wasOffline]);

  // Always show if there are pending or failed items
  useEffect(() => {
    if (pendingCount > 0 || failedCount > 0) setVisible(true);
  }, [pendingCount, failedCount]);

  if (!visible && pendingCount === 0 && failedCount === 0) return null;

  const clickable = Boolean(onClick) && (pendingCount > 0 || failedCount > 0 || !isOnline);

  return (
    <button
      type="button"
      onClick={clickable ? onClick : undefined}
      disabled={!clickable}
      className={cn(
        "flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-medium transition-all shrink-0 w-full",
        clickable && "cursor-pointer hover:brightness-110",
        !clickable && "cursor-default",
        isSyncing
          ? "bg-primary text-white animate-pulse"
          : failedCount > 0
            ? "bg-status-error text-white"
            : isOnline
              ? pendingCount > 0
                ? "bg-status-warning text-white"
                : "bg-status-success text-white"
              : "bg-status-error text-white"
      )}
    >
      {isSyncing ? (
        <>
          <Icon name="progress_activity" size={14} className="animate-spin" />
          <span>Đang đồng bộ... ({pendingCount} đơn)</span>
        </>
      ) : failedCount > 0 ? (
        <>
          <Icon name="error" size={14} />
          <span>
            {failedCount} đơn lỗi · {pendingCount} chờ — chạm để xem
          </span>
        </>
      ) : isOnline ? (
        pendingCount > 0 ? (
          <>
            <Icon name="cloud_off" size={14} />
            <span>{pendingCount} đơn chờ đồng bộ — chạm để xem</span>
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
            {pendingCount > 0 && ` — ${pendingCount} đơn chờ`}
            {clickable && " (chạm để xem)"}
          </span>
        </>
      )}
    </button>
  );
}
